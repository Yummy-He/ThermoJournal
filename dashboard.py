"""Local dashboard, also the entry point for the portable Windows executable."""
import argparse
import asyncio
import csv
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread, Timer
from urllib.parse import parse_qs, quote, urlsplit
import webbrowser

from app import storage
from app.sensor import discover, export

ASSETS = Path(__file__).resolve().parent / "app" / "web"
TASK_LOCK = Lock()
TASK = {"busy": False, "message": "", "revision": 0}


def update(**changes):
    with TASK_LOCK:
        TASK.update(changes)


def start_task(kind, address):
    known = storage.devices()
    if kind == "sync" and address not in known:
        raise ValueError("请先添加设备")
    with TASK_LOCK:
        if TASK["busy"]:
            raise ValueError("已有蓝牙任务正在运行")
        TASK.update(busy=True, kind=kind, address=address, found=[], error=False,
                    message="正在扫描附近设备…" if kind == "scan" else "正在连接设备…")

    def run():
        try:
            if kind == "scan":
                found = asyncio.run(discover())
                update(found=found, message=f"找到 {len(found)} 台匹配设备。" if found else "未发现设备。请退出米家设备页并将设备靠近电脑。")
            elif kind == "merge":
                added, count = storage.merge()
                update(message=f"合并完成，总表共 {count:,} 条。")
            else:
                added, count = asyncio.run(export(address, known[address], lambda msg: update(message=msg)))
                update(message=f"刷新完成，新增 {added:,} 条，总表共 {count:,} 条。")
        except PermissionError:
            update(error=True, message="请关闭 Excel 中打开的 CSV，再点击「重新合并」。")
        except Exception as exc:
            update(error=True, message=f"操作未完成。{str(exc) or type(exc).__name__}")
        finally:
            with TASK_LOCK:
                TASK.update(busy=False, revision=TASK["revision"] + 1)
    Thread(target=run, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, content, mime="application/json; charset=utf-8", status=200, filename=None):
        if not isinstance(content, bytes):
            content = json.dumps(content, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
        if filename:
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename))
        self.end_headers()
        self.wfile.write(content)

    def handle_api(self, method):
        host = self.headers.get("Host")
        if host != f"127.0.0.1:{self.server.server_port}":
            return self.send({"error":"无效主机"}, status=403)
        url = urlsplit(self.path)
        try:
            if method == "POST":
                if self.headers.get("Origin") != "http://" + host or self.headers.get_content_type() != "application/json":
                    return self.send({"error":"请求来源无效"}, status=403)
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 2048:
                    raise ValueError("请求长度无效")
                body = json.loads(self.rfile.read(size))
                if url.path == "/api/devices":
                    storage.register(body["address"], body["name"])
                elif url.path == "/api/devices/rename":
                    storage.rename_device(body["address"], body["name"])
                elif url.path in ("/api/scan", "/api/sync", "/api/merge"):
                    address = storage.mac(body["address"]) if url.path == "/api/sync" else ""
                    start_task(url.path[5:], address)
                else:
                    return self.send({}, status=404)
                return self.send({"ok":True})
            if url.path in ("/", "/ui.css", "/ui.js"):
                filename, mime = {"/":("index.html","text/html"), "/ui.css":("ui.css","text/css"),
                                  "/ui.js":("ui.js","text/javascript")}[url.path]
                return self.send((ASSETS / filename).read_bytes(), mime + "; charset=utf-8")
            if url.path == "/api/state":
                with TASK_LOCK:
                    task = TASK.copy()
                return self.send({"devices":storage.devices(), "task":task})
            if url.path in ("/api/records", "/download"):
                address = parse_qs(url.query).get("address", [""])[0]
                if address:
                    address = storage.mac(address)
                    if address not in storage.devices():
                        raise ValueError("未知设备")
                    path = storage.folder(address) / storage.HISTORY
                elif url.path == "/download":
                    path = storage.DATA / storage.MASTER
                else:
                    raise ValueError("请先选择设备")
                if url.path == "/download":
                    if not path.is_file():
                        return self.send({"error":"暂无记录"}, status=404)
                    return self.send(path.read_bytes(), "text/csv; charset=utf-8",
                                     filename=(address.replace(":","") + "_历史.csv") if address else "温湿度总表.csv")
                records = []
                if path.exists():
                    with path.open(encoding="utf-8-sig", newline="") as stream:
                        reader = csv.reader(stream)
                        next(reader)
                        records = [[r[3], *map(float, r[4:8])] for r in reader]
                return self.send(records)
            return self.send({}, status=404)
        except (KeyError, ValueError, TypeError, OSError) as exc:
            return self.send({"error": str(exc)}, status=400)

    def do_GET(self):
        self.handle_api("GET")

    def do_POST(self):
        self.handle_api("POST")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    storage.migrate_legacy()
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(url, flush=True)
        print("温湿度手记已启动。使用期间请保持此窗口打开，按 Ctrl+C 退出。", flush=True)
        if not args.no_browser:
            Timer(0.5, webbrowser.open, args=(url,)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

