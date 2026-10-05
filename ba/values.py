"""最終値の整合チェック：パラメータシートの期待値・作業入力（①）・実測値（③）・手順実行の入力値をキーで集約する。

- 同じキーの値はすべて同じ judge()（ba/compare.py。画面の Rules.judge と同一ロジック）で期待値と照合する
- 同じキーで入力元によって値が違う場合は「食い違い」として検出する
- 最終値 = 入力日時が最も新しい値（日時が無い古いデータは 手順実行 > 実測値 > 作業入力 の順で優先）
古い JSON（日時なし、キーなし）もそのまま扱える。
"""
import datetime
import re

from . import compare as cmpmod
from . import rules

SRC_PRIORITY = {"input": 1, "compare": 2, "runner": 3}
STATUS_LABEL = dict(cmpmod.STATUS_LABEL, invalid="書式エラー", ok="入力済み")
_DATE = re.compile(r"^\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$")


def norm_time(v):
    """各種の日時文字列 → ローカル時刻 'YYYY-MM-DD HH:MM:SS'（比較・表示用）。解釈できなければ ''。

    - ブラウザの toISOString()（UTC, 末尾 Z）→ ローカル時刻に変換
    - サーバの 'YYYY-MM-DDTHH:MM:SS'、画面の 'YYYY-MM-DD HH:MM:SS'（sv-SE 形式）はそのまま
    """
    if not v or not isinstance(v, str):
        return ""
    s = v.strip()
    try:
        if s.endswith("Z") or re.search(r"[+-]\d{2}:\d{2}$", s):
            s2 = s[:-1] + "+00:00" if s.endswith("Z") else s
            s2 = re.sub(r"\.\d+", "", s2)
            d = datetime.datetime.strptime(s2[:19] + s2[19:].replace(":", ""), "%Y-%m-%dT%H:%M:%S%z")
            return d.astimezone().replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
        m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?", s)
        if m:
            return "%s %s%s" % (m.group(1), m.group(2), m.group(3) or ":00")
    except ValueError:
        return ""
    return ""


def as_date(v):
    m = _DATE.match(rules.norm(v))
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hh = (int(m.group(4)), int(m.group(5))) if m.group(4) else None
    return (y, mo, d, hh)


def same_value(a, b):
    """2 つの入力値が同じとみなせるか（judge と同じ正規化 + 日付の表記ゆれ 2026/10/03 = 2026-10-03）。"""
    if cmpmod.judge(a, b) == "match":
        return True
    da, db = as_date(a), as_date(b)
    if da and db:
        return da[:3] == db[:3] and (da[3] is None or db[3] is None or da[3] == db[3])
    return False


def _text(v):
    if v is True:
        return "完了"
    if v is False or v is None:
        return ""
    return str(v)


def collect(params, server, template, job, session):
    """→ {group_key: {"label", "key", "expected", "has_expected", "item", "entries": [...]}}（挿入順を保持）"""
    groups = {}

    def group(gk, label, key=None):
        g = groups.get(gk)
        if g is None:
            g = groups[gk] = {"gk": gk, "key": key, "label": label, "expected": "", "has_expected": False, "item": None, "entries": []}
        return g

    for p in params or []:
        g = group(p["key"], p.get("label") or p["key"], p["key"])
        g["expected"] = p.get("values", {}).get(server, "")
        g["has_expected"] = True

    inputs, inputs_at = job.get("inputs") or {}, job.get("inputs_at") or {}
    for it in (template or {}).get("items", []):
        src = it.get("source") or {"kind": "input"}
        if src.get("kind", "input") != "input":
            continue
        key = (it.get("key") or "").strip() or None
        g = group(key or "item:" + it["id"], it.get("label") or it["id"], key)
        if g["item"] is None:
            g["item"] = it
        if not g["has_expected"] and g["label"] == g["key"]:
            g["label"] = it.get("label") or g["label"]
        v = inputs.get(it["id"])
        if _text(v).strip():
            g["entries"].append({"type": "input", "source": "① 入力チェック（%s）" % it.get("cell", it["id"]), "value": _text(v),
                                 "at": norm_time(inputs_at.get(it["id"]))})

    for key, stt in (job.get("compare") or {}).items():
        if not isinstance(stt, dict) or not _text(stt.get("actual")).strip():
            continue
        g = group(key, key, key)
        g["entries"].append({"type": "compare", "source": "③ パラメータ比較（実測値）", "value": _text(stt.get("actual")),
                             "at": norm_time(stt.get("actual_at")) or norm_time(stt.get("judged_at"))})

    if session:
        results = session.get("results") or {}
        for no, st in enumerate(session.get("steps") or [], 1):
            r = results.get(st.get("id")) or {}
            vals, vat = r.get("values") or {}, r.get("valuesAt") or {}
            for inp in st.get("inputs") or []:
                v = _text(vals.get(inp.get("id")))
                key = (inp.get("key") or "").strip() or None
                if not v.strip() and not key:
                    continue
                label = inp.get("label") or "入力"
                g = group(key or "sop:%s:%s" % (st.get("id"), inp.get("id")), label if key else "%s（手順 %d）" % (label, no), key)
                if v.strip():
                    g["entries"].append({"type": "runner", "source": "手順 %d：%s" % (no, st.get("title") or ""), "value": v + (" " + inp["unit"] if inp.get("unit") and inp.get("type") == "number" else ""),
                                         "raw": v, "at": norm_time(vat.get(inp.get("id"))) or norm_time(r.get("confirmedAt"))})
    return groups


def evaluate(groups):
    rows = []
    for g in groups.values():
        ents = g["entries"]
        for e in ents:
            e["judge"] = cmpmod.judge(g["expected"], e.get("raw", e["value"])) if g["has_expected"] else ""
        final = None
        if ents:
            final = max(ents, key=lambda e: (e["at"] or "", SRC_PRIORITY[e["type"]]))
        fv = final.get("raw", final["value"]) if final else ""
        conflict = any(not same_value(fv, e.get("raw", e["value"])) for e in ents) if final else False
        for e in ents:
            e["differs"] = bool(final) and not same_value(fv, e.get("raw", e["value"]))
        # 書式チェックは ① の入力値（成果物 Excel に書き込まれる値）に対して行う。
        # 手順実行の値（例：「現在時刻」ボタンの日時）はテンプレートの書式ルールの対象外。
        inp = [e for e in ents if e["type"] == "input"]
        errors = rules.validate(g["item"], inp[-1].get("raw", inp[-1]["value"])) if g["item"] is not None and inp else []
        if g["has_expected"]:
            status = cmpmod.judge(g["expected"], fv)
        elif not final:
            status = "missing"
        elif errors:
            status = "invalid"
        else:
            status = "ok"
        rows.append({
            "key": g["key"], "id": g["gk"], "label": g["label"], "expected": g["expected"], "has_expected": g["has_expected"],
            "final": final["value"] if final else "", "final_raw": fv, "final_source": final["source"] if final else "", "final_at": final["at"] if final else "",
            "status": status, "status_label": STATUS_LABEL[status], "conflict": conflict, "errors": errors, "entries": ents,
            "problem": status == "mismatch" or conflict,
        })
    return rows


def _latest(entries):
    return max(entries, key=lambda e: (e["at"] or "", SRC_PRIORITY[e["type"]])) if entries else None


def key_rows(rows):
    """「主要値一覧」用：パラメータシートの項目ごとに 要求値 / 入力値 / 出力値 だけを 1 行にまとめる。

    入力値 = 作業者が入力した値（① 作業入力・手順実行の入力値）の最新、出力値 = ③ の実測値（コマンド結果）の最新。
    判定は出力値（無ければ入力値）を要求値と照合する。入力値も出力値も無い項目は含めない。
    """
    out = []
    for r in rows:
        if not r["has_expected"]:
            continue
        i = _latest([e for e in r["entries"] if e["type"] in ("input", "runner")])
        o = _latest([e for e in r["entries"] if e["type"] == "compare"])
        if not i and not o:
            continue
        iv = i.get("raw", i["value"]) if i else ""
        ov = o.get("raw", o["value"]) if o else ""
        status = cmpmod.judge(r["expected"], ov or iv)
        out.append({
            "key": r["key"], "label": r["label"], "expected": r["expected"],
            "input": i["value"] if i else "", "input_source": i["source"] if i else "",
            "output": o["value"] if o else "",
            "status": status, "status_label": STATUS_LABEL[status],
            "io_differs": bool(i and o and not same_value(iv, ov)),
        })
    return out


def key_summary(krows):
    s = {"total": len(krows), "match": 0, "mismatch": 0, "missing": 0, "no_expected": 0, "io_differs": 0}
    for r in krows:
        s[r["status"]] += 1
        s["io_differs"] += 1 if r["io_differs"] else 0
    return s


def summary(rows):
    s = {"total": len(rows), "entered": 0, "match": 0, "mismatch": 0, "conflict": 0, "missing": 0, "no_expected": 0, "invalid": 0, "ok": 0, "problems": 0}
    for r in rows:
        s[r["status"]] += 1
        s["entered"] += 1 if r["entries"] else 0
        s["conflict"] += 1 if r["conflict"] else 0
        s["problems"] += 1 if r["problem"] else 0
    return s
