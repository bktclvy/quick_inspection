"""同期設定 REST エンドポイント。

Phase 1: 設定の読み書きのみ。
Phase 2: マスタ接続テスト、作業者リストの強制再同期 を追加予定。
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend import app_config
from backend.storage import factory as storage_factory

router = APIRouter()


class UpdateAppConfig(BaseModel):
    mode: str | None = None
    pc_label: str | None = None
    master_url: str | None = None
    shared_path: str | None = None
    cloud_sync_path: str | None = None
    flush_interval_sec: int | None = None
    health_timeout_sec: int | None = None


@router.get("/sync/config")
async def get_config():
    return app_config.load()


@router.put("/sync/config")
async def put_config(data: UpdateAppConfig):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "mode" in updates and updates["mode"] not in app_config.VALID_MODES:
        raise HTTPException(400, f"無効なモードです: {updates['mode']}")
    cfg = app_config.update(updates)
    # ストレージを再生成
    storage_factory.reset()
    return cfg


@router.post("/sync/test-connection")
async def test_connection():
    """Phase 2 でマスタ役/共有先の接続テストを実装する。
    Phase 1 はスタンドアロンなので常に成功を返す。"""
    cfg = app_config.load()
    mode = cfg.get("mode")
    if mode == app_config.MODE_STANDALONE:
        return {"ok": True, "message": "スタンドアロンモードです"}
    return {"ok": True, "message": f"モード '{mode}' は Phase 2 で実装予定です"}
