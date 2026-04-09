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
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


@app.on_event("startup")
async def startup():
    camera.open()


@app.on_event("shutdown")
async def shutdown():
    camera.close()
