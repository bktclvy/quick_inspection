"""FastAPIアプリケーションファクトリ。"""
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from backend.routes.ws import router as ws_router
from backend.routes.api import router as api_router
from backend.routes.stream import router as stream_router
from backend.camera import camera

app = FastAPI(title="Quick Inspection")

# ルーター登録
app.include_router(ws_router)
app.include_router(stream_router)
app.include_router(api_router, prefix="/api")

# フロントエンド静的ファイルのマウント（キャッチオールのため最後に配置）
# Vite ビルド成果物 (dist/) を優先、なければ旧 frontend/ からサーブ
_base = os.path.dirname(os.path.dirname(__file__))
_dist_dir = os.path.join(_base, "dist")
_frontend_dir = os.path.join(_base, "frontend")
frontend_dir = _dist_dir if os.path.isdir(_dist_dir) else _frontend_dir
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


@app.on_event("startup")
async def startup():
    camera.open()


@app.on_event("shutdown")
async def shutdown():
    # 学習スレッドを安全に停止してからカメラを閉じる
    from backend.training import trainer
    if trainer.is_running():
        trainer.stop(timeout=5.0)
    camera.close()
