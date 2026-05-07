"""作業者マスタの管理。StorageBackend 経由で読み書きする。"""
import datetime
import uuid
from backend.storage import factory


def _new_worker_id() -> str:
    return f"wkr_{uuid.uuid4().hex[:8]}"


def list_workers(active_only: bool = True) -> list[dict]:
    return factory.get_backend().list_workers(active_only=active_only)


def get_worker(worker_id: str) -> dict | None:
    return factory.get_backend().get_worker(worker_id)


def create_worker(name: str, code: str | None = None) -> dict:
    now = datetime.datetime.now().isoformat(timespec="seconds")
    worker = {
        "id": _new_worker_id(),
        "name": name.strip(),
        "code": (code.strip() if code else None) or None,
        "active": True,
        "created_at": now,
        "updated_at": now,
    }
    return factory.get_backend().save_worker(worker)


def update_worker(worker_id: str, name: str | None = None,
                  code: str | None = None, active: bool | None = None) -> dict | None:
    backend = factory.get_backend()
    existing = backend.get_worker(worker_id)
    if not existing:
        return None
    if name is not None:
        existing["name"] = name.strip()
    if code is not None:
        existing["code"] = code.strip() or None
    if active is not None:
        existing["active"] = bool(active)
    return backend.save_worker(existing)


def delete_worker(worker_id: str) -> bool:
    return factory.get_backend().delete_worker(worker_id)
