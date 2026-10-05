"""本地数据存储：data/ 下的 JSON + 复制的文件。无数据库、无网络。"""
import datetime
import hashlib
import json
import os
import re
import secrets
import shutil
import threading

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{4,63}$")
IMG_RE = re.compile(r"^img-\d{14}-[0-9a-f]{8}$")
TYPES = {"excel_template": ".xlsx", "param_sheet": ".xlsx", "procedure": ".docx", "command_set": None}
_lock = threading.RLock()


def now():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def new_id(prefix):
    return "%s-%s-%s" % (prefix, datetime.datetime.now().strftime("%Y%m%d%H%M%S"), secrets.token_hex(3))


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def safe_name(name):
    name = os.path.basename(str(name or "").replace("\\", "/"))
    name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "_", name).strip(" .")
    return name[:120] or "file"


class Store:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        for d in ("library", "jobs", "sop_sessions", "sop_images", "exports"):
            os.makedirs(os.path.join(self.root, d), exist_ok=True)

    # ---------- library ----------
    def _lib_dir(self, item_id):
        if not ID_RE.match(item_id or ""):
            raise KeyError("bad id")
        return os.path.join(self.root, "library", item_id)

    def lib_list(self, typ=None):
        out = []
        base = os.path.join(self.root, "library")
        for d in sorted(os.listdir(base)):
            m = read_json(os.path.join(base, d, "meta.json"))
            if m and (not typ or m.get("type") == typ):
                out.append(m)
        return sorted(out, key=lambda m: m.get("updated", ""), reverse=True)

    def lib_get(self, item_id):
        m = read_json(os.path.join(self._lib_dir(item_id), "meta.json"))
        if not m:
            raise KeyError(item_id)
        return m

    def lib_create(self, typ, name, data=None, filename=None, extra=None):
        if typ not in TYPES:
            raise ValueError("unknown type")
        with _lock:
            item_id = new_id({"excel_template": "xt", "param_sheet": "ps", "procedure": "pr", "command_set": "cs"}[typ])
            d = self._lib_dir(item_id)
            os.makedirs(d)
            meta = {"id": item_id, "type": typ, "name": name, "created": now(), "updated": now()}
            if data is not None:
                fn = "file" + TYPES[typ]
                with open(os.path.join(d, fn), "wb") as f:
                    f.write(data)
                meta["file"] = fn
                meta["original_name"] = safe_name(filename)
                meta["sha1"] = hashlib.sha1(data).hexdigest()
                meta["size"] = len(data)
            meta.update(extra or {})
            write_json(os.path.join(d, "meta.json"), meta)
            return meta

    def lib_update(self, item_id, patch):
        with _lock:
            m = self.lib_get(item_id)
            for k, v in patch.items():
                if k in ("id", "type", "file", "created", "sha1", "size"):
                    continue
                m[k] = v
            m["updated"] = now()
            write_json(os.path.join(self._lib_dir(item_id), "meta.json"), m)
            return m

    def lib_delete(self, item_id):
        with _lock:
            d = self._lib_dir(item_id)
            if not os.path.isdir(d):
                raise KeyError(item_id)
            shutil.rmtree(d)

    def lib_file(self, item_id):
        m = self.lib_get(item_id)
        if not m.get("file"):
            raise KeyError("no file")
        return os.path.join(self._lib_dir(item_id), m["file"]), m

    # ---------- jobs ----------
    def _job_path(self, job_id):
        if not ID_RE.match(job_id or ""):
            raise KeyError("bad id")
        return os.path.join(self.root, "jobs", job_id + ".json")

    def job_list(self):
        base = os.path.join(self.root, "jobs")
        out = [read_json(os.path.join(base, f)) for f in os.listdir(base) if f.endswith(".json")]
        return sorted([j for j in out if j], key=lambda j: j.get("updated", ""), reverse=True)

    def job_get(self, job_id):
        j = read_json(self._job_path(job_id))
        if not j:
            raise KeyError(job_id)
        return j

    def job_save(self, job):
        with _lock:
            if not job.get("id"):
                job["id"] = new_id("job")
                job["created"] = now()
            job["updated"] = now()
            write_json(self._job_path(job["id"]), job)
            return job

    def job_delete(self, job_id):
        with _lock:
            os.remove(self._job_path(job_id))

    # ---------- SOP runner sessions (v1 state objects) ----------
    def _sop_path(self, key):
        h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
        return os.path.join(self.root, "sop_sessions", h + ".json")

    def sop_list(self):
        base = os.path.join(self.root, "sop_sessions")
        out = [read_json(os.path.join(base, f)) for f in os.listdir(base) if f.endswith(".json")]
        return [s for s in out if s and s.get("key")]

    def sop_put(self, key, state):
        with _lock:
            state = dict(state)
            state["key"] = key
            write_json(self._sop_path(key), state)

    def sop_delete(self, key):
        with _lock:
            p = self._sop_path(key)
            if os.path.exists(p):
                os.remove(p)

    # ---------- 証跡画像（手順実行） ----------
    def image_save(self, data):
        """PNG/JPEG を data/sop_images/ に保存し、メタデータを返す。"""
        from .images import sniff
        fmt, w, h = sniff(data)
        img_id = "img-%s-%s" % (datetime.datetime.now().strftime("%Y%m%d%H%M%S"), secrets.token_hex(4))
        ext = "png" if fmt == "png" else "jpg"
        with open(os.path.join(self.root, "sop_images", img_id + "." + ext), "wb") as f:
            f.write(data)
        return {"id": img_id, "ext": ext, "mime": "image/" + fmt, "w": w, "h": h, "size": len(data)}

    def image_path(self, img_id):
        if not IMG_RE.match(img_id or ""):
            raise KeyError("bad image id")
        for ext in ("png", "jpg"):
            p = os.path.join(self.root, "sop_images", img_id + "." + ext)
            if os.path.exists(p):
                return p
        raise KeyError(img_id)

    def image_delete(self, img_id):
        try:
            os.remove(self.image_path(img_id))
        except KeyError:
            pass

    def sop_get(self, key):
        return read_json(self._sop_path(key))

    def export_path(self, name):
        return os.path.join(self.root, "exports", safe_name(name))

    def export_file(self, name):
        """exports/ 内の既存ファイル（名前の検証つき）。"""
        if not name or safe_name(name) != name:
            raise KeyError("bad export name")
        p = self.export_path(name)
        if not os.path.isfile(p):
            raise KeyError(name)
        return p
