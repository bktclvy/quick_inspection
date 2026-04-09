"""Application entry point — opens as a desktop window via pywebview."""
import sys
import threading
import uvicorn
import config


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
        uvicorn.run(
            "backend.app:app",
            host="127.0.0.1",
            port=config.PORT,
            reload=True,
        )
    else:
        import webview

        threading.Thread(target=start_server, daemon=True).start()
        webview.create_window(
            "Quick Inspection",
            f"http://127.0.0.1:{config.PORT}",
            width=1440,
            height=850,
            min_size=(1024, 600),
        )
        webview.start()
