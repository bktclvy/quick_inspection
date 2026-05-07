"""WebSocketエンドポイント: 検査結果と学習進捗の配信。"""
import asyncio
import logging
import json
import os
import time
import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.camera import camera
from backend.product import product_manager
from backend.scale import scale
from backend.box_log import append_box_log
from backend import event_log, worker_manager
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
_active_worker_id: str | None = None
_active_worker_name: str | None = None
_active_product_name: str | None = None
_inspection_active = False
_model_manager = None
_state_machine = None


async def start_inspection(product_id: str, worker_id: str, model_manager, state_machine):
    global _active_product_id, _active_worker_id, _active_worker_name, _active_product_name
    global _inspection_active, _model_manager, _state_machine
    async with _inspection_lock:
        _active_product_id = product_id
        _active_worker_id = worker_id
        # 作業者名と製品名は denormalize 用にキャッシュ
        try:
            w = worker_manager.get_worker(worker_id) if worker_id else None
            _active_worker_name = w["name"] if w else None
        except Exception:
            _active_worker_name = None
        try:
            p = product_manager.get(product_id)
            _active_product_name = p.name if p else None
        except Exception:
            _active_product_name = None
        _inspection_active = True
        _model_manager = model_manager
        _state_machine = state_machine


async def stop_inspection():
    global _active_product_id, _active_worker_id, _active_worker_name, _active_product_name
    global _inspection_active
    async with _inspection_lock:
        _active_product_id = None
        _active_worker_id = None
        _active_worker_name = None
        _active_product_name = None
        _inspection_active = False
        camera.unfreeze_frame()


def get_inspection_status() -> dict:
    return {
        "active": _inspection_active,
        "product_id": _active_product_id,
        "worker_id": _active_worker_id,
    }


def _record_state_events(result: dict) -> None:
    """state_machine の result dict に含まれる _event / _box_event を SQLite に記録する。
    検査本体を止めないよう例外は飲み込む。"""
    try:
        ev = result.pop("_event", None)
        if ev:
            payload = {
                **ev,
                "worker_id": _active_worker_id,
                "worker_name": _active_worker_name,
                "product_id": _active_product_id,
                "product_name": _active_product_name,
            }
            event_log.record_event(payload)
        bx = result.pop("_box_event", None)
        if bx:
            payload = {
                **bx,
                "worker_id": _active_worker_id,
                "worker_name": _active_worker_name,
                "product_id": _active_product_id,
                "product_name": _active_product_name,
            }
            event_log.record_box(payload)
    except Exception:
        log.warning("event_log 記録失敗", exc_info=True)


def _inject_scale(msg: dict) -> None:
    """state_update メッセージに秤のライブ値を付加する。
    port_open: シリアルポートが開いているか
    live: 直近 2 秒以内にデータを受信しているか
    """
    r = scale.get_latest()
    port_open = scale.is_connected()
    if not (r or port_open):
        return
    data_age_ms: int | None = None
    if r:
        data_age_ms = int((time.monotonic() - r.received_at) * 1000)
    live = port_open and r is not None and data_age_ms is not None and data_age_ms <= 2000
    msg["scale"] = {
        "port_open": port_open,
        "live": live,
        "data_age_ms": data_age_ms,
        "value_g": r.value_g if r else None,
        "stable": r.stable if r else False,
        "overload": r.overload if r else False,
    }


@router.websocket("/ws/inspection")
async def inspection_stream(websocket: WebSocket):
    """検査用WebSocket: 状態更新の送信、手動トリガーの受信。"""
    await inspection_mgr.connect(websocket)

    manual_trigger_event = asyncio.Event()
    confirm_event = asyncio.Event()
    # confirm アクションに添付された箱ログデータ (receive_loop → メインループ)
    _confirm_box_result: list[dict | None] = [None]

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
                    _confirm_box_result[0] = msg.get("box_result")
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
            if not product:
                await asyncio.sleep(0.5)
                continue

            # ROI が無い場合は「全体 = 仮想 ROI __full_frame__」で推論する
            # (predict-once API と同じロジック)
            if not product.rois:
                models = product_manager.list_models(_active_product_id)
                if not models:
                    await asyncio.sleep(0.5)
                    continue
                first_model = models[0]["model_name"]
                # モデルが未ロードならロード
                if first_model not in _model_manager.get_loaded_models():
                    models_dir = product_manager.models_dir(_active_product_id)
                    await loop.run_in_executor(
                        None, _model_manager.load,
                        first_model,
                        os.path.join(models_dir, f"{first_model}.keras"),
                        os.path.join(models_dir, f"{first_model}_meta.json"),
                    )
                rois = []
                roi_dicts = [{
                    "id": "__full_frame__",
                    "name": "全体",
                    "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0,
                    "model_name": first_model,
                    "color": "#6366f1",
                }]
            else:
                rois = product.rois
                roi_dicts = [r.to_dict() for r in rois]

            from backend.state_machine import InspectionState

            # ── 確認アクション ──
            if confirm_event.is_set():
                confirm_event.clear()
                box_result = _confirm_box_result[0]
                _confirm_box_result[0] = None
                if _state_machine.state == InspectionState.WAITING_CONFIRM:
                    result = _state_machine.confirm()
                    _record_state_events(result)
                    # 箱ログ書き込み（秤モード時のみ box_result が送られてくる）
                    if box_result and _active_product_id:
                        await loop.run_in_executor(
                            None, append_box_log, _active_product_id, box_result)
                    camera.unfreeze_frame()
                    msg = {"type": "state_update", **result}
                    _inject_scale(msg)
                    await websocket.send_json(msg)
                    await asyncio.sleep(0)
                    continue

            # ── 手動トリガー処理 ──
            if manual_trigger_event.is_set():
                manual_trigger_event.clear()
                roi_results = await loop.run_in_executor(
                    None, _model_manager.predict_rois, frame, roi_dicts)
                result = _state_machine.manual_trigger(roi_results)
                camera.freeze_frame(frame)
                # ログ保存
                if result.get("state") == "judged":
                    await loop.run_in_executor(
                        None, product_manager.save_inspection_log,
                        _active_product_id, frame, result)
                _record_state_events(result)
                msg = {"type": "state_update", **result}
                _inject_scale(msg)
                await websocket.send_json(msg)
                await asyncio.sleep(0)
                continue

            # ── 手動モード: 背景差分取出し検知をスキップ ──
            # JUDGED/WAITING_* からは confirm アクション（スペース押下）で IDLE に戻る。
            # 背景未登録でも動作可能。
            if getattr(_state_machine, 'trigger_mode', 'auto') == 'manual':
                counters = _state_machine.get_counters()
                msg: dict = {
                    "type": "state_update",
                    "state": _state_machine.state.value,
                    "trigger_mode": "manual",
                    "counters": counters,
                }
                # JUDGED 時は判定情報を付加して UI が結果を表示し続ける
                if _state_machine.state == InspectionState.JUDGED and _state_machine.last_judgment:
                    msg.update(_state_machine.last_judgment)
                _inject_scale(msg)
                await websocket.send_json(msg)
                await asyncio.sleep(0.05)
                continue

            # ── AI トリガーモード ──
            if getattr(_state_machine, 'trigger_mode', 'auto') == 'ai':
                t_frame_ai = time.monotonic()
                raw_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                if prev_gray is None:
                    frame_diff_ai = 0.0
                else:
                    frame_diff_ai = float(cv2.absdiff(raw_gray, prev_gray).mean())
                prev_gray = raw_gray

                bg_match = await loop.run_in_executor(
                    None, product_manager.background_match_score_gray,
                    _active_product_id, raw_gray)

                roi_results_ai: list[dict] = []
                t_infer_ms: int | None = None
                if _state_machine.state == InspectionState.IDLE:
                    t0 = time.monotonic()
                    roi_results_ai = await loop.run_in_executor(
                        None, _model_manager.predict_rois, frame, roi_dicts)
                    t_infer_ms = int((time.monotonic() - t0) * 1000)

                prev_state = _state_machine.state
                result = _state_machine.process_frame_ai_trigger(roi_results_ai, bg_match, frame_diff_ai)

                if result.get("state") == "judged" and prev_state != InspectionState.JUDGED:
                    camera.freeze_frame(frame)
                    await loop.run_in_executor(
                        None, product_manager.save_inspection_log,
                        _active_product_id, frame, result)
                if result.get("state") == "idle" and prev_state != InspectionState.IDLE:
                    camera.unfreeze_frame()

                _record_state_events(result)
                t_total_ai = int((time.monotonic() - t_frame_ai) * 1000)
                msg = {"type": "state_update", **result,
                       "_timings": {"match_ms": 0, "infer_ms": t_infer_ms, "total_ms": t_total_ai}}
                _inject_scale(msg)
                await websocket.send_json(msg)
                await asyncio.sleep(0.03)
                continue

            # ── 自動モード: トリガー検知 + 背景MAD + 安定検知 ──
            t_frame = time.monotonic()

            # cvtColor は1回だけ（frame_diff / trigger / bg MAD で共有）
            raw_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if prev_gray is None:
                frame_diff = 0.0
            else:
                frame_diff = float(cv2.absdiff(raw_gray, prev_gray).mean())
            prev_gray = raw_gray

            # トリガーマッチ + 背景MADを並列実行
            margin = getattr(_state_machine, 'match_margin', 0.10)
            trigger_future = loop.run_in_executor(
                None, product_manager.trigger_match_score_gray,
                _active_product_id, raw_gray, margin)
            bg_future = loop.run_in_executor(
                None, product_manager.background_match_score_gray,
                _active_product_id, raw_gray)

            t0 = time.monotonic()
            trigger_score, bg_match = await asyncio.gather(trigger_future, bg_future)
            t_match_ms = int((time.monotonic() - t0) * 1000)

            match_scores: dict[str, float | None] = {"trigger": trigger_score}

            # モデル推論（INSPECTING時のみ）
            t_infer_ms: int | None = None
            roi_results = None
            if _state_machine.state == InspectionState.INSPECTING:
                t0 = time.monotonic()
                roi_results = await loop.run_in_executor(
                    None, _model_manager.predict_rois, frame, roi_dicts)
                t_infer_ms = int((time.monotonic() - t0) * 1000)
                camera.freeze_frame(frame)

            prev_state = _state_machine.state

            # ステートマシン処理
            result = _state_machine.process_frame_unified(
                match_scores, bg_match, frame_diff, roi_results)

            # INSPECTING遷移時に即座に推論（1フレーム遅延を排除）
            if result.get("state") == "inspecting" and roi_results is None:
                t0 = time.monotonic()
                roi_results = await loop.run_in_executor(
                    None, _model_manager.predict_rois, frame, roi_dicts)
                t_infer_ms = int((time.monotonic() - t0) * 1000)
                camera.freeze_frame(frame)
                result = _state_machine.process_frame_unified(
                    match_scores, bg_match, frame_diff, roi_results)

            # JUDGED遷移時に検査ログ保存
            if result.get("state") == "judged" and prev_state != InspectionState.JUDGED:
                await loop.run_in_executor(
                    None, product_manager.save_inspection_log,
                    _active_product_id, frame, result)

            # IDLEに戻ったらフリーズ解除
            if result.get("state") == "idle" and prev_state != InspectionState.IDLE:
                camera.unfreeze_frame()

            _record_state_events(result)
            t_total_ms = int((time.monotonic() - t_frame) * 1000)
            msg = {"type": "state_update", **result,
                   "_timings": {"match_ms": t_match_ms, "infer_ms": t_infer_ms, "total_ms": t_total_ms}}
            _inject_scale(msg)
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
