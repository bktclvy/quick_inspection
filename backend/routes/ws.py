"""WebSocketエンドポイント: 検査結果と学習進捗の配信。"""
import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.camera import camera
from backend.product import product_manager
import config

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        disconnected = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws)


inspection_mgr = ConnectionManager()
training_mgr = ConnectionManager()

# 検査状態
_active_product_id: str | None = None
_inspection_active = False
_model_manager = None
_state_machine = None


def start_inspection(product_id: str, model_manager, state_machine):
    global _active_product_id, _inspection_active, _model_manager, _state_machine
    _active_product_id = product_id
    _inspection_active = True
    _model_manager = model_manager
    _state_machine = state_machine


def stop_inspection():
    global _active_product_id, _inspection_active
    _active_product_id = None
    _inspection_active = False


def get_inspection_status() -> dict:
    return {
        "active": _inspection_active,
        "product_id": _active_product_id,
    }


@router.websocket("/ws/inspection")
async def inspection_stream(websocket: WebSocket):
    """検査用WebSocket: 状態更新の送信、手動トリガーの受信。"""
    await inspection_mgr.connect(websocket)
    frame_interval = 1.0 / config.STREAM_FPS

    manual_trigger_event = asyncio.Event()

    async def receive_loop():
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                if msg.get("action") == "manual_trigger":
                    manual_trigger_event.set()
        except (WebSocketDisconnect, Exception):
            pass

    recv_task = asyncio.create_task(receive_loop())

    try:
        while True:
            if not _inspection_active or not _model_manager or not _state_machine or not _active_product_id:
                await asyncio.sleep(0.5)
                continue

            loop = asyncio.get_event_loop()
            frame = await loop.run_in_executor(None, camera.read_frame)

            if frame is None:
                await asyncio.sleep(0.5)
                continue

            product = product_manager.get(_active_product_id)
            if not product or not product.rois:
                await asyncio.sleep(0.5)
                continue

            rois = product.rois
            roi_dicts = [r.to_dict() for r in rois]
            from backend.state_machine import InspectionState

            # ── 手動トリガー処理 ──
            if manual_trigger_event.is_set():
                manual_trigger_event.clear()
                if _state_machine.trigger_mode == "manual":
                    roi_results = await loop.run_in_executor(
                        None, _model_manager.predict_rois, frame, roi_dicts)
                    result = _state_machine.manual_trigger(roi_results)
                    msg = {"type": "state_update", **result}
                    await websocket.send_json(msg)
                    await asyncio.sleep(frame_interval)
                    continue

            # ── テンプレートマッチスコア算出 ──
            match_scores = {}
            for roi in rois:
                score = await loop.run_in_executor(
                    None, product_manager.match_score, _active_product_id, roi.id, frame)
                match_scores[roi.id] = score

            # ── ステートマシンでフレーム処理 ──
            roi_results = None
            if _state_machine.state == InspectionState.INSPECTING:
                roi_results = await loop.run_in_executor(
                    None, _model_manager.predict_rois, frame, roi_dicts)

            result = await loop.run_in_executor(
                None, _state_machine.process_frame, match_scores, roi_results)

            msg = {"type": "state_update", **result}
            await websocket.send_json(msg)

            await asyncio.sleep(frame_interval)

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        recv_task.cancel()
        inspection_mgr.disconnect(websocket)


@router.websocket("/ws/training")
async def training_stream(websocket: WebSocket):
    await training_mgr.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        training_mgr.disconnect(websocket)
    except Exception:
        training_mgr.disconnect(websocket)
