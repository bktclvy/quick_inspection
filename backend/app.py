"""FastAPIアプリケーションファクトリ。"""
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from backend.routes.ws import router as ws_router
from backend.routes.api import router as api_router
from backend.routes.stream import router as stream_router
from backend.routes.scale import router as scale_router
from backend.routes.workers import router as workers_router
from backend.routes.events import router as events_router
from backend.routes.sync import router as sync_router
from backend.routes.stats import router as stats_router
from backend.camera import camera
from backend.scale import scale
from backend import scale_config
from backend.db import init_db

app = FastAPI(title="Quick Inspection")

# ルーター登録
app.include_router(ws_router)
app.include_router(stream_router)
app.include_router(api_router, prefix="/api")
app.include_router(scale_router)
app.include_router(workers_router, prefix="/api")
app.include_router(events_router, prefix="/api")
app.include_router(sync_router, prefix="/api")
app.include_router(stats_router, prefix="/api")

# フロントエンド静的ファイルのマウント（キャッチオールのため最後に配置）
# Vite ビルド成果物 (dist/) を優先、なければ旧 frontend/ からサーブ
_base = os.path.dirname(os.path.dirname(__file__))
_dist_dir = os.path.join(_base, "dist")
_frontend_dir = os.path.join(_base, "frontend")
frontend_dir = _dist_dir if os.path.isdir(_dist_dir) else _frontend_dir
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


@app.on_event("startup")
async def startup():
    init_db()
    camera.open()
    cfg = scale_config.load()
    if cfg.get("enabled") and cfg.get("port"):
        scale.open(**cfg)


@app.on_event("shutdown")
async def shutdown():
    from backend.training import trainer
    if trainer.is_running():
        trainer.stop(timeout=5.0)
    camera.close()
    scale.close()
