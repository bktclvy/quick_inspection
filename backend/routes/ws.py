"""WebSocketエンドポイント: 検査結果と学習進捗の配信。"""
import asyncio
import logging
import json
import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.camera import camera
from backend.product import product_manager
import config

log = logging.getLogger("ws")
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
            except WebSocketDisconnect:
                disconnected.append(ws)
            except Exception:
                log.warning("broadcast送信エラー", exc_info=True)
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws)


inspection_mgr = ConnectionManager()
training_mgr = ConnectionManager()

# 検査状態（_inspection_lock で保護）
_inspection_lock = asyncio.Lock()
_active_product_id: str | None = None
_inspection_active = False
_model_manager = None
_state_machine = None


async def start_inspection(product_id: str, model_manager, state_machine):
    global _active_product_id, _inspection_active, _model_manager, _state_machine
    async with _inspection_lock:
        _active_product_id = product_id
        _inspection_active = True
        _model_manager = model_manager
        _state_machine = state_machine


async def stop_inspection():
    global _active_product_id, _inspection_active
    async with _inspection_lock:
        _active_product_id = None
        _inspection_active = False
        camera.unfreeze_frame()


def get_inspection_status() -> dict:
    return {
        "active": _inspection_active,
        "product_id": _active_product_id,
    }


@router.websocket("/ws/inspection")
async def inspection_stream(websocket: WebSocket):
    """検査用WebSocket: 状態更新の送信、手動トリガーの受信。"""
    await inspection_mgr.connect(websocket)

    manual_trigger_event = asyncio.Event()
    confirm_event = asyncio.Event()

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
                elif msg.get("action") == "confirm":
                    confirm_event.set()
        except WebSocketDisconnect:
            pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("WS receive_loop エラー", exc_info=True)

    recv_task = asyncio.create_task(receive_loop())
    prev_gray = None
    last_processed_frame_id = -1

    try:
        while True:
            if not _inspection_active or not _model_manager or not _state_machine or not _active_product_id:
                await asyncio.sleep(0.5)
                continue

            loop = asyncio.get_running_loop()

            # ストリームが読んだ最新フレームを再利用（カメラ二重読み取り防止）
            frame, frame_id = camera.get_latest_frame()
            if frame is None:
                frame = await loop.run_in_executor(None, camera.read_frame)
                frame_id = -1
            if frame is None:
                await asyncio.sleep(0.1)
                continue
            # 同じフレームを二度処理しない
            if frame_id == last_processed_frame_id and frame_id >= 0:
                await asyncio.sleep(0.005)  # 5ms待ってリトライ
                continue
            last_processed_frame_id = frame_id

            product = product_manager.get(_active_product_id)
            if not product or not product.rois:
                await asyncio.sleep(0.5)
                continue

            rois = product.rois
            roi_dicts = [r.to_dict() for r in rois]
            from backend.state_machine import InspectionState

            # ── 確認アクション ──
            if confirm_event.is_set():
                confirm_event.clear()
                if _state_machine.state == InspectionState.WAITING_CONFIRM:
                    result = _state_machine.confirm()
                    camera.unfreeze_frame()
                    msg = {"type": "state_update", **result}
                    await websocket.send_json(msg)
                    await asyncio.sleep(0)
                    continue

            # ── 手動トリガー処理 ──
            if manual_trigger_event.is_set():
                manual_trigger_event.clear()
                roi_results = await loop.run_in_executor(
                    None, _model_manager.predict_rois, frame, roi_dicts)
                result = _state_machine.manual_trigger(roi_results)
                msg = {"type": "state_update", **result}
                await websocket.send_json(msg)
                await asyncio.sleep(0)
                continue

            # ── 統一モード: トリガー検知 + 背景マッチ + 安定検知 ──

            # フレーム間差分（安定検知用、軽いのでメイン実行）
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if prev_gray is None:
                frame_diff = 0.0
            else:
                fd = cv2.absdiff(gray, prev_gray)
                frame_diff = float(fd.mean())
            prev_gray = gray

            # トリガーマッチ + 背景マッチを並列実行
            margin = getattr(_state_machine, 'match_margin', 0.10)
            trigger_future = loop.run_in_executor(
                None, product_manager.trigger_match_score,
                _active_product_id, frame, margin)
            bg_future = loop.run_in_executor(
                None, product_manager.background_match_score,
                _active_product_id, frame)

            trigger_score, bg_match = await asyncio.gather(trigger_future, bg_future)
            # トリガーテンプレートのスコア。キー名はステートマシン内で区別不要（全て閾値比較）。
            match_scores: dict[str, float | None] = {"trigger": trigger_score}

            # モデル推論（INSPECTING時のみ）
            roi_results = None
            if _state_machine.state == InspectionState.INSPECTING:
                roi_results = await loop.run_in_executor(
                    None, _model_manager.predict_rois, frame, roi_dicts)
                # 検査時のフレームをフリーズ（取出しまで表示し続ける）
                camera.freeze_frame(frame)

            prev_state = _state_machine.state

            # ステートマシン処理
            result = _state_machine.process_frame_unified(
                match_scores, bg_match, frame_diff, roi_results)

            # JUDGED遷移時に検査ログ保存
            if result.get("state") == "judged" and prev_state == InspectionState.INSPECTING:
                await loop.run_in_executor(
                    None, product_manager.save_inspection_log,
                    _active_product_id, frame, result)

            # IDLEに戻ったらフリーズ解除
            if result.get("state") == "idle" and prev_state != InspectionState.IDLE:
                camera.unfreeze_frame()

            msg = {"type": "state_update", **result}
            await websocket.send_json(msg)

            await asyncio.sleep(0.03)

    except WebSocketDisconnect:
        pass
    except Exception:
        log.warning("WS inspection_stream エラー", exc_info=True)
    finally:
        recv_task.cancel()
        try:
            await recv_task
        except (asyncio.CancelledError, Exception):
            pass
        inspection_mgr.disconnect(websocket)


@router.websocket("/ws/training")
async def training_stream(websocket: WebSocket):
    await training_mgr.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        log.warning("WS training_stream エラー", exc_info=True)
    finally:
        training_mgr.disconnect(websocket)
