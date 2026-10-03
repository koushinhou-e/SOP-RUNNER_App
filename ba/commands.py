"""確認コマンド生成：{{param}} テンプレート → 具体的なコマンド（テキスト生成のみ。実行は一切しない）。

安全上の約束（lint でチェック）:
  * aws コマンドには --no-cli-pager と --output を必須とする（ページャ・対話を防ぐ）
  * ssh には -o BatchMode=yes を必須とする（パスワード入力待ちにせず、失敗したら即終了）
  * リソースを変更しうる aws サブコマンド、対話型ツール、破壊的コマンドを検出 → 警告
  * パラメータ値にシェルの特殊文字が含まれる場合、出力先（sh / ps1）に合わせてシングルクォートでエスケープ
"""
import datetime
import re

PH = re.compile(r"\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}")
SAFE_VALUE = re.compile(r"^[A-Za-z0-9._:/@,=+%-]*$")

AWS = re.compile(r"(^|[\s;|&(])aws\s")
SSH = re.compile(r"(^|[\s;|&(])ssh\s")
AWS_MUTATING = re.compile(r"(^|[\s;|&(])aws\s+(?:--\S+\s+(?:\S+\s+)?)*[a-z0-9-]+\s+(create|delete|terminate|stop|start|reboot|run|modify|put|attach|detach|associate|disassociate|update|remove|authorize|revoke|import|copy|register|deregister|reset|replace|cancel|enable|disable|send|invoke|apply|restore|release|allocate)-")
INTERACTIVE = re.compile(r"(^|[\s;|&'\"(])(less|more|vi|vim|nano|top|htop|passwd|mysql|psql|sqlplus|telnet|ftp)(?=$|[\s'\";|)])")
SUDO_NO_N = re.compile(r"(^|[\s;|&'\"(])sudo(?!\s+-n)\b")
DESTRUCTIVE = re.compile(r"(^|[\s;|&'\"(])(rm\s+-|shutdown|reboot|halt|poweroff|mkfs|dd\s+if=|systemctl\s+(stop|restart|disable)|kill\s|>\s*/)")


def quote(value, target):
    v = str(value)
    if SAFE_VALUE.match(v):
        return v
    if target == "ps1":
        return "'" + v.replace("'", "''") + "'"
    return "'" + v.replace("'", "'\"'\"'") + "'"


def render(template, ctx, target="sh"):
    missing, quoted = [], []

    def rep(m):
        k = m.group(1)
        v = ctx.get(k)
        if v is None or str(v).strip() == "":
            missing.append(k)
            return m.group(0)
        q = quote(str(v).strip(), target)
        if q != str(v).strip():
            quoted.append(k)
        return q
    return PH.sub(rep, template), sorted(set(missing)), sorted(set(quoted))


def lint(cmd):
    w = []
    if AWS.search(cmd):
        if "--no-cli-pager" not in cmd:
            w.append("aws コマンドに --no-cli-pager がありません（ページャで止まる可能性）")
        if not re.search(r"--output(\s|=)", cmd):
            w.append("aws コマンドに --output がありません（出力形式が不定）")
        if AWS_MUTATING.search(cmd):
            w.append("リソースを変更する可能性のある aws サブコマンドです（参照系ではありません）")
    if SSH.search(cmd) and "BatchMode=yes" not in cmd:
        w.append("ssh に -o BatchMode=yes がありません（パスワード・確認入力待ちになる可能性）")
    if INTERACTIVE.search(cmd):
        w.append("対話型プログラム（less/vi/top など）を含みます。非対話セッションでは止まります")
    if SUDO_NO_N.search(cmd):
        w.append("sudo に -n がありません（パスワード入力待ちになる可能性）")
    if DESTRUCTIVE.search(cmd):
        w.append("破壊的・変更系のコマンドを含みます")
    return w


def placeholders(template):
    return sorted(set(PH.findall(template or "")))


def generate(templates, ctx):
    out = []
    for i, t in enumerate(templates):
        sh, missing, quoted = render(t.get("template", ""), ctx, "sh")
        ps1, _, _ = render(t.get("template", ""), ctx, "ps1")
        out.append({
            "id": t.get("id") or "c%d" % (i + 1), "title": t.get("title", ""), "kind": t.get("kind", ""), "checks": t.get("checks", ""),
            "sh": sh, "ps1": ps1, "missing": missing, "quoted": quoted, "warnings": lint(t.get("template", "")),
        })
    return out


def to_script(generated, target, meta):
    now = meta.get("now") or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    head = [
        "構築作業アシスタント v2 で生成した確認コマンド",
        "作業: %s / サーバ: %s / 生成日時: %s" % (meta.get("job_name", ""), meta.get("server", ""), now),
        "このスクリプトは自動実行されません。内容を確認してから手動で実行してください。",
    ]
    lines = []
    if target == "ps1":
        lines += ["# " + h for h in head]
        lines += ["$ErrorActionPreference = 'Continue'", "$env:AWS_PAGER = ''", ""]
    else:
        lines += ["#!/usr/bin/env bash"] + ["# " + h for h in head]
        lines += ["set -u", "export AWS_PAGER=''", ""]
    for n, g in enumerate(generated, 1):
        title = "[%d] %s" % (n, g["title"])
        if g["checks"]:
            title += " (check: %s)" % g["checks"]
        lines.append("# " + "-" * 60)
        for w in g["warnings"]:
            lines.append("# WARNING: " + w)
        if g["missing"]:
            lines.append("# MISSING: " + ", ".join(g["missing"]) + "  (未解決のプレースホルダ)")
        if target == "ps1":
            lines.append("Write-Host '### %s'" % title.replace("'", "''"))
            cmd = g["ps1"]
        else:
            lines.append("echo '### %s'" % title.replace("'", "'\"'\"'"))
            cmd = g["sh"]
        lines.append(("# " + cmd) if g["missing"] else cmd)
        lines.append("")
    return "\n".join(lines) + "\n"
