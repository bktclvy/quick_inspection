"""検査イベント記録ヘルパー。

state_machine と ws.py から呼ばれ、StorageBackend 経由で SQLite に記録する。
冪等性のため UUID を生成、PC ID と作業者情報を補完する。
"""
import datetime
import logging
import uuid
from backend import app_config
from backend.storage import factory

log = logging.getLogger("event_log")


def _now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="milliseconds")


def _enrich(payload: dict) -> dict:
    """payload に id / pc_id / pc_label を補完する。"""
    cfg = app_config.load()
    payload = dict(payload)
    payload.setdefault("id", uuid.uuid4().hex)
    payload.setdefault("pc_id", cfg["pc_id"])
    payload.setdefault("pc_label", cfg.get("pc_label") or "")
    return payload


def record_event(payload: dict) -> bool:
    """検査イベント 1 件を記録。
    必須キー: ts, product_id, result。
    任意: worker_id, worker_name, product_name, confidence, cycle_ms, inspection_ms, box_seq, box_id, pieces_per_box。"""
    try:
        enriched = _enrich(payload)
        if "ts" not in enriched:
            enriched["ts"] = _now_iso()
        return factory.get_backend().record_event(enriched)
    except Exception:
        log.warning("record_event failed", exc_info=True)
        return False


def record_box(payload: dict) -> bool:
    """箱完成 1 件を記録。
    必須キー: started_at, completed_at, product_id, pieces_per_box, box_duration_ms。"""
    try:
        enriched = _enrich(payload)
        return factory.get_backend().record_box(enriched)
    except Exception:
        log.warning("record_box failed", exc_info=True)
        return False


def query_events(filters: dict, limit: int = 1000, offset: int = 0) -> list[dict]:
    return factory.get_backend().query_events(filters, limit=limit, offset=offset)


def query_boxes(filters: dict, limit: int = 1000, offset: int = 0) -> list[dict]:
    return factory.get_backend().query_boxes(filters, limit=limit, offset=offset)


def new_id() -> str:
    return uuid.uuid4().hex


def now_iso() -> str:
    return _now_iso()
