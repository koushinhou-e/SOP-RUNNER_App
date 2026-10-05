"""最小 HTTP 服务（标准库 http.server），只绑定 127.0.0.1。

安全措施：
  * 只监听 127.0.0.1（不对局域网开放）
  * 校验 Host 头（防 DNS rebinding）
  * 每次启动生成随机 token，所有 /api 调用必须带 X-Token 头（或下载链接里的 ?t=），防止其他网页跨站调用
  * 静态文件只从 web/ 目录提供，禁止路径穿越
  * 响应带 CSP：只允许加载本机自身资源
"""
import json
import mimetypes
import os
import posixpath
import re
import secrets
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

from .service import APP_DIR, Service

WEB_DIR = os.path.join(APP_DIR, "web")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
MAX_UPLOAD = 50 * 1024 * 1024
MAX_IMAGE = 20 * 1024 * 1024
MAX_DRAIN = 8 * 1024 * 1024     # エラー応答の前に読み捨てる本体の上限（これより大きければ接続を閉じる）


class _Server(ThreadingHTTPServer):
    # Windows 上 SO_REUSEADDR 允许重复绑定已占用端口，必须关闭
    allow_reuse_address = os.name != "nt"
    daemon_threads = True


LOOPBACK_HOSTS = ("127.0.0.1",)


def _disposition(name):
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, quote(name))


class App:
    def __init__(self, data_dir, port=8765, host="127.0.0.1"):
        if host not in LOOPBACK_HOSTS:   # LAN へ公開しない（呼び出し側の指定ミスも拒否）
            raise ValueError("127.0.0.1 以外では待ち受けできません: %r" % host)
        self.service = Service(data_dir)
        self.token = secrets.token_urlsafe(24)
        self.host = host
        self.httpd = None
        for p in ([port] + list(range(port + 1, port + 20)) if port else [0]):
            try:
                self.httpd = _Server((host, p), self._handler())
                break
            except OSError:
                continue
        if self.httpd is None:
            self.httpd = _Server((host, 0), self._handler())
        self.port = self.httpd.server_address[1]

    @property
    def url(self):
        return "http://%s:%d/" % (self.host, self.port)

    def serve_forever(self):
        self.httpd.serve_forever()

    def start_background(self):
        t = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        t.start()
        return t

    def shutdown(self):
        threading.Thread(target=self.httpd.shutdown, daemon=True).start()

    def _handler(self):
        app = self

        class H(Handler):
            pass
        H.app = app
        return H


class HttpError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


class Handler(BaseHTTPRequestHandler):
    app = None
    server_version = "BuildAssistant/2"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 安静模式
        pass

    # ---------- helpers ----------
    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if not getattr(self, "_body_read", True) and not self._drain():
            # 読み捨てられない本体（大きすぎる・長さ不正）は、次のリクエストとして解釈されないよう接続を閉じる
            self.close_connection = True
            if not any(k.lower() == "connection" for k in (headers or {})):
                self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _file(self, path, download_name=None, ctype=None):
        with open(path, "rb") as f:
            data = f.read()
        ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        headers = {"Content-Disposition": _disposition(download_name)} if download_name else None
        self._send(200, data, ctype, headers)

    def _body(self, limit=MAX_UPLOAD, too_large="ファイルが大きすぎます"):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise HttpError(400, "Content-Length が不正です")
        if n < 0:   # 負の値だと rfile.read(-1) が接続終了まで待ち続ける
            raise HttpError(400, "Content-Length が不正です")
        if n > limit:   # 読み込む前に拒否する（大きな本体をメモリに載せない）
            raise HttpError(413, too_large)
        self._body_read = True
        return self.rfile.read(n) if n else b""

    def _drain(self):
        """読まれなかった本体を読み捨てる。読み捨てられれば True。

        未読のデータを残したままソケットを閉じると OS が RST を送り、ブラウザはエラー応答を受け取れずに
        「Failed to fetch」になる（例：トークン不一致の PUT）。小さな本体は読み捨ててから応答する。
        """
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return False
        if n == 0:
            return True
        if n < 0 or n > MAX_DRAIN:
            return False
        while n > 0:
            chunk = self.rfile.read(min(n, 65536))
            if not chunk:
                return False
            n -= len(chunk)
        self._body_read = True
        return True

    def _json(self):
        b = self._body()
        try:
            obj = json.loads(b.decode("utf-8")) if b else {}
        except ValueError:
            raise HttpError(400, "JSON の形式が不正です")
        if not isinstance(obj, dict):
            raise HttpError(400, "JSON はオブジェクトである必要があります")
        return obj

    def _check_host(self):
        host = (self.headers.get("Host") or "").lower()
        ok = {"127.0.0.1:%d" % self.app.port, "localhost:%d" % self.app.port}
        if host not in ok:
            raise HttpError(403, "forbidden host")

    def _check_token(self, qs):
        t = self.headers.get("X-Token") or (qs.get("t") or [""])[0]
        if not secrets.compare_digest(t, self.app.token):
            raise HttpError(403, "invalid token")

    # ---------- dispatch ----------
    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        self._body_read = False
        try:
            self._check_host()
            u = urlparse(self.path)
            qs = parse_qs(u.query)
            if u.path.startswith("/api/"):
                self._check_token(qs)
                # 区切りで分割してから各部分をデコードする（キーに含まれる %2F や % を二重にデコードしない）
                return self._api(method, [unquote(p) for p in u.path[5:].strip("/").split("/")], qs)
            if method != "GET":
                raise HttpError(405, "method not allowed")
            return self._static(unquote(u.path))
        except HttpError as e:
            # 本体を読まずに拒否した場合は _send() が読み捨てる（できなければ接続を閉じる）
            self._send(e.code, {"error": str(e)})
        except KeyError as e:
            self._send(404, {"error": "not found: %s" % e})
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # pragma: no cover
            traceback.print_exc()
            self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})

    def _static(self, path):
        if path in ("/", "/index.html"):
            with open(os.path.join(WEB_DIR, "index.html"), encoding="utf-8") as f:
                html = f.read().replace("__TOKEN__", self.app.token)
            return self._send(200, html, "text/html; charset=utf-8")
        rel = posixpath.normpath(path).lstrip("/")
        if rel.startswith("..") or "\x00" in rel:
            raise HttpError(404, "not found")
        full = os.path.realpath(os.path.join(WEB_DIR, *rel.split("/")))
        if not full.startswith(os.path.realpath(WEB_DIR) + os.sep) or not os.path.isfile(full):
            raise HttpError(404, "not found")
        self._file(full)

    # ---------- API ----------
    def _api(self, method, parts, qs):
        S = self.app.service
        st = S.store
        p0 = parts[0] if parts else ""
        n = len(parts)
        if p0 == "ping":
            return self._send(200, {"ok": True})
        if p0 == "presets":
            from .rules import PRESETS, MESSAGES
            return self._send(200, {"presets": PRESETS, "messages": MESSAGES})
        if p0 == "shutdown" and method == "POST":
            self._send(200, {"ok": True})
            return self.app.shutdown()
        if p0 == "samples" and method == "POST":
            return self._send(200, {"items": S.load_samples()})
        # ----- library -----
        if p0 == "library":
            if n == 1 and method == "GET":
                return self._send(200, {"items": st.lib_list((qs.get("type") or [None])[0])})
            if n == 2 and parts[1] == "upload" and method == "POST":
                typ = (qs.get("type") or [""])[0]
                fn = unquote(self.headers.get("X-Filename") or "upload")
                return self._send(200, S.upload(typ, fn, self._body()))
            if n == 2 and parts[1] == "command_set" and method == "POST":
                b = self._json()
                return self._send(200, S.create_command_set(b.get("name") or "コマンドテンプレート集", b.get("templates") or []))
            if n == 2 and parts[1] == "commands_preview" and method == "POST":
                b = self._json()
                return self._send(200, {"commands": S.preview_commands(b.get("templates") or [], b.get("param_sheet_id"), b.get("server"), b.get("globals"))})
            if n == 2 and parts[1] == "procedure_template" and method == "POST":
                b = self._json()
                return self._send(200, S.save_procedure_template(b.get("name"), b.get("steps"), b.get("doc_title"), b.get("seq"), b.get("param_ref")))
            if n == 3 and parts[2] == "steps" and method == "POST":
                b = self._json()
                return self._send(200, S.save_procedure_template(b.get("name"), b.get("steps"), b.get("doc_title"), b.get("seq"), b.get("param_ref"), item_id=parts[1]))
            if n >= 2:
                iid = parts[1]
                if n == 2 and method == "GET":
                    return self._send(200, st.lib_get(iid))
                if n == 2 and method == "PUT":
                    return self._send(200, st.lib_update(iid, self._json()))
                if n == 2 and method == "DELETE":
                    st.lib_delete(iid)
                    return self._send(200, {"ok": True})
                if n == 3 and parts[2] == "file" and method == "GET":
                    path, m = st.lib_file(iid)
                    return self._file(path, m.get("original_name") or os.path.basename(path))
                if n == 3 and parts[2] == "redetect" and method == "POST":
                    return self._send(200, S.redetect(iid))
                if n == 3 and parts[2] == "automap" and method == "POST":
                    m, cnt = S.auto_map(iid, self._json().get("param_sheet_id"))
                    return self._send(200, {"item": m, "mapped": cnt})
                if n == 3 and parts[2] == "preview" and method == "GET":
                    return self._send(200, {"sheets": S.preview(iid)})
        # ----- jobs -----
        if p0 == "jobs":
            if n == 1 and method == "GET":
                return self._send(200, {"items": st.job_list()})
            if n == 1 and method == "POST":
                b = self._json()
                job = {k: b.get(k) for k in ("name", "template_id", "param_sheet_id", "server", "command_set_id", "procedure_id", "sop_key")}
                job.update({"inputs": {}, "compare": {}, "globals": b.get("globals") or {}})
                return self._send(200, st.job_save(job))
            if n == 1:
                raise HttpError(405, "method not allowed")
            jid = parts[1]
            if n == 2 and method == "GET":
                return self._send(200, S.job_view(jid))
            if n == 2 and method == "PUT":
                S.update_job(jid, self._json())
                return self._send(200, S.job_view(jid))
            if n == 2 and method == "DELETE":
                st.job_delete(jid)
                return self._send(200, {"ok": True})
            job = st.job_get(jid)
            if n == 3 and parts[2] == "commands":
                return self._send(200, {"commands": S.commands(job), "context": S.context(job)})
            if n == 3 and parts[2] in ("commands.sh", "commands.ps1"):
                tgt = parts[2].split(".")[1]
                body = S.script(job, tgt)
                if tgt == "ps1":
                    data = b"\xef\xbb\xbf" + body.replace("\n", "\r\n").encode("utf-8")  # PowerShell 5 需要 BOM 才能正确识别 UTF-8
                else:
                    data = body.encode("utf-8")
                name = "%s_%s_check.%s" % (job.get("name", "job"), job.get("server", ""), tgt)
                return self._send(200, data, "text/plain; charset=utf-8", {"Content-Disposition": _disposition(name)})
            if n == 3 and parts[2] == "compare":
                rows, summ = S.compare_rows(job)
                return self._send(200, {"rows": rows, "summary": summ})
            if n == 3 and parts[2] == "compare.xlsx":
                out = S.export_compare(job)
                return self._file(out, os.path.basename(out))
            if n == 3 and parts[2] == "values" and method == "GET":
                return self._send(200, S.all_values(job))
            if n == 3 and parts[2] == "values.html" and method == "GET":
                return self._send(200, S.values_html(job, for_browser=True), "text/html; charset=utf-8")
            if n == 3 and parts[2] == "keyvalues.html" and method == "GET":
                return self._send(200, S.keyvalues_html(job, for_browser=True), "text/html; charset=utf-8")
            if n == 3 and parts[2] == "keyvalues.pdf" and method == "POST":
                self._json()
                return self._send(200, S.export_values_pdf(job, kind="keyvalues"))
            if n == 3 and parts[2] == "values.pdf" and method == "POST":
                self._json()
                return self._send(200, S.export_values_pdf(job))
            if n == 3 and parts[2] == "report" and method == "GET":
                return self._send(200, S.report_preview(job, (qs.get("sop") or [None])[0]))
            if n == 3 and parts[2] == "deliverable.xlsx":
                out, _ = S.export_deliverable(job, (qs.get("sop") or [None])[0])
                return self._file(out, os.path.basename(out))
        # ----- 出力済みファイル（作業入力値一覧 PDF など）-----
        if p0 == "exports" and n == 2 and method == "GET":
            p = st.export_file(parts[1])
            return self._file(p, parts[1])
        # ----- SOP runner sessions -----
        if p0 == "sop":
            if n == 2 and parts[1] == "images" and method == "POST":
                data = self._body(MAX_IMAGE, "画像が大きすぎます（上限 %d MB）" % (MAX_IMAGE // 1024 // 1024))
                try:
                    return self._send(200, st.image_save(data))
                except ValueError as e:
                    raise HttpError(400, str(e))
            if n == 3 and parts[1] == "images" and method in ("GET", "HEAD"):
                try:
                    p = st.image_path(parts[2])
                except KeyError:
                    raise HttpError(404, "画像が見つかりません")
                return self._file(p, ctype="image/png" if p.endswith(".png") else "image/jpeg")
            if n == 3 and parts[1] == "images" and method == "DELETE":
                st.image_delete(parts[2])
                return self._send(200, {"ok": True})
            if n == 2 and parts[1] == "sessions" and method == "GET":
                return self._send(200, {"items": st.sop_list()})
            if n == 3 and parts[1] == "sessions" and method == "PUT":
                b = self._json()
                st.sop_put(parts[2], b)
                return self._send(200, {"ok": True})
            if n == 3 and parts[1] == "sessions" and method == "DELETE":
                st.sop_delete(parts[2])
                return self._send(200, {"ok": True})
        raise HttpError(404, "unknown api")
