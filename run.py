"""Application entry point — opens as a desktop window via pywebview."""
import os
import sys
import time
import threading
import urllib.request
import uvicorn
import config

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_PORT_FILE = os.path.join(_BASE_DIR, ".dev-port")


def _write_port_file():
    """開発時に Vite proxy が参照するポートファイルを書き出す。"""
    with open(_PORT_FILE, "w") as f:
        f.write(str(config.PORT))


def _cleanup_port_file():
    """ポートファイルを削除する。"""
    try:
        os.remove(_PORT_FILE)
    except FileNotFoundError:
        pass


def start_server():
    uvicorn.run(
        "backend.app:app",
        host="127.0.0.1",
        port=config.PORT,
        log_level="warning",
    )


if __name__ == "__main__":
    # --dev flag for browser-based development with hot reload
    if "--dev" in sys.argv:
        _write_port_file()
        print(f"Backend: http://127.0.0.1:{config.PORT}")
        print(f"Port written to {_PORT_FILE}")
        try:
            uvicorn.run(
                "backend.app:app",
                host="127.0.0.1",
                port=config.PORT,
                reload=True,
            )
        finally:
            _cleanup_port_file()
    else:
        import webview

        threading.Thread(target=start_server, daemon=True).start()

        # サーバー起動を待機（遅いPCでwebviewが先に開いてエラーになるのを防ぐ）
        url = f"http://127.0.0.1:{config.PORT}"
        for _ in range(50):  # 最大10秒
            try:
                urllib.request.urlopen(url, timeout=1)
                break
            except Exception:
                time.sleep(0.2)

        webview.create_window(
            "Quick Inspection",
            f"http://127.0.0.1:{config.PORT}",
            width=1440,
            height=850,
            min_size=(1024, 600),
        )
        webview.start()
