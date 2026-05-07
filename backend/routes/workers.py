"""作業者マスタ REST エンドポイント。"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend import worker_manager

router = APIRouter()


class CreateWorker(BaseModel):
    name: str
    code: str | None = None


class UpdateWorker(BaseModel):
    name: str | None = None
    code: str | None = None
    active: bool | None = None


@router.get("/workers")
async def list_workers(active_only: bool = True):
    return {"workers": worker_manager.list_workers(active_only=active_only)}


@router.post("/workers")
async def create_worker(data: CreateWorker):
    if not data.name or not data.name.strip():
        raise HTTPException(400, "氏名を入力してください")
    return worker_manager.create_worker(data.name, data.code)


@router.get("/workers/{worker_id}")
async def get_worker(worker_id: str):
    w = worker_manager.get_worker(worker_id)
    if not w:
        raise HTTPException(404, "作業者が見つかりません")
    return w


@router.put("/workers/{worker_id}")
async def update_worker(worker_id: str, data: UpdateWorker):
    if data.name is not None and not data.name.strip():
        raise HTTPException(400, "氏名を空にできません")
    w = worker_manager.update_worker(
        worker_id,
        name=data.name,
        code=data.code,
        active=data.active,
    )
    if not w:
        raise HTTPException(404, "作業者が見つかりません")
    return w


@router.delete("/workers/{worker_id}")
async def delete_worker(worker_id: str):
    if not worker_manager.delete_worker(worker_id):
        raise HTTPException(404, "作業者が見つかりません")
    return {"message": "作業者を削除しました"}
