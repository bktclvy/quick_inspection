"""イベントログの REST エンドポイント。

Phase 1:
- POST /events           : 単発イベント受信（マスタ役 PC 用、Phase 2 で活用）
- POST /events/batch     : バッチ受信（マスタ役 PC 用、Phase 2 で活用）
- GET  /events/health    : マスタ生死確認（軽量）
- GET  /events           : デバッグ用一覧
- GET  /boxes            : デバッグ用一覧
"""
from fastapi import APIRouter
from pydantic import BaseModel
from backend import event_log

router = APIRouter()


class EventBatch(BaseModel):
    events: list[dict] = []
    boxes: list[dict] = []


@router.get("/events/health")
async def health():
    return {"ok": True}


@router.post("/events")
async def post_event(event: dict):
    ok = event_log.record_event(event)
    return {"ok": ok}


@router.post("/events/batch")
async def post_events_batch(data: EventBatch):
    ev_ok = sum(1 for e in data.events if event_log.record_event(e))
    bx_ok = sum(1 for b in data.boxes if event_log.record_box(b))
    return {"events_ok": ev_ok, "boxes_ok": bx_ok}


@router.get("/events")
async def list_events(
    from_: str | None = None,
    to: str | None = None,
    worker_id: str | None = None,
    product_id: str | None = None,
    pc_id: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    filters = {
        "from": from_,
        "to": to,
        "worker_id": worker_id,
        "product_id": product_id,
        "pc_id": pc_id,
    }
    return {"events": event_log.query_events(filters, limit=limit, offset=offset)}


@router.get("/boxes")
async def list_boxes(
    from_: str | None = None,
    to: str | None = None,
    worker_id: str | None = None,
    product_id: str | None = None,
    pc_id: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    filters = {
        "from": from_,
        "to": to,
        "worker_id": worker_id,
        "product_id": product_id,
        "pc_id": pc_id,
    }
    return {"boxes": event_log.query_boxes(filters, limit=limit, offset=offset)}
