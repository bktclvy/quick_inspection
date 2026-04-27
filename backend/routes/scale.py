"""秤 (A&D HC-6Ki) 関連 REST エンドポイント。"""
import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.scale import scale
from backend import scale_config as sc

log = logging.getLogger("scale")
router = APIRouter(prefix="/api/scale", tags=["scale"])


class ScaleConfigUpdate(BaseModel):
    model_config = {"extra": "allow"}
    port: Optional[str] = None
    baudrate: Optional[int] = None
    data_bits: Optional[int] = None
    parity: Optional[str] = None
    stop_bits: Optional[int] = None
    read_timeout_ms: Optional[int] = None
    stability_timeout_ms: Optional[int] = None
    tare_command: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/status")
async def get_status():
    reading = scale.get_latest()
    data_age_ms: int | None = None
    if reading:
        data_age_ms = int((time.monotonic() - reading.received_at) * 1000)
    return {
        # port_open: シリアルポートが開けているか（open 成功後に True）
        "port_open": scale.is_connected(),
        # 直近の受信からの経過時間 (ms) - None の場合は一度もデータを受信していない
        "data_age_ms": data_age_ms,
        "latest": {
            "value_g": reading.value_g,
            "stable": reading.stable,
            "overload": reading.overload,
        } if reading else None,
    }


@router.get("/config")
async def get_config():
    return sc.load()


@router.put("/config")
async def update_config(body: ScaleConfigUpdate):
    cfg = sc.load()
    updates = body.model_dump(exclude_none=True)
    cfg.update(updates)
    sc.save(cfg)
    if "enabled" in updates or "port" in updates:
        scale.close()
        if cfg.get("enabled") and cfg.get("port"):
            scale.open(**cfg)
    return cfg


@router.get("/ports")
async def list_ports():
    try:
        from serial.tools import list_ports
        ports = [{"device": p.device, "description": p.description}
                 for p in list_ports.comports()]
        return {"ports": ports}
    except Exception as e:
        return {"ports": [], "error": str(e)}


@router.post("/reconnect")
async def reconnect():
    cfg = sc.load()
    scale.close()
    connected = False
    if cfg.get("enabled") and cfg.get("port"):
        connected = scale.open(**cfg)
    return {"connected": connected}


@router.post("/tare")
async def tare_scale():
    """T (風袋引き) コマンドを送信。ACK後、0g 近傍で ST になるまで待機。
    HC-6Ki は T で ACK (0x06) を返す。Z はゼロ点補正で応答形式が異なる。
    """
    if not scale.is_connected():
        raise HTTPException(503, "秤が接続されていません")
    t0 = time.monotonic()
    ok = scale.tare()  # HC-6Ki は T で風袋引き → ACK 応答
    if not ok:
        raise HTTPException(503, "風袋コマンドの ACK を受信できませんでした")
    cfg = sc.load()
    timeout = cfg.get("stability_timeout_ms", 3000)
    r = scale.wait_zero(timeout_ms=timeout, within_g=0.5)
    return {
        "ok": r is not None,
        "tared_at_g": r.value_g if r else None,
        "duration_ms": int((time.monotonic() - t0) * 1000),
    }


@router.post("/weigh")
async def weigh(body: dict):
    if not scale.is_connected():
        raise HTTPException(503, "秤が接続されていません")
    expected_g: float = float(body.get("expected_g", 0))
    tolerance_g: float = float(body.get("tolerance_g", 2.0))
    timeout_ms: int = int(body.get("timeout_ms", 5000))
    r = scale.wait_stable(timeout_ms=timeout_ms)
    if not r:
        raise HTTPException(408, "安定した計量値を取得できませんでした")
    deviation_g = round(r.value_g - expected_g, 2)
    box_qty = max(int(body.get("box_qty", 1)), 1)
    unit_weight = expected_g / box_qty if expected_g else 0
    estimated_qty_delta = round(deviation_g / unit_weight, 1) if unit_weight else None
    return {
        "ok": abs(deviation_g) <= tolerance_g,
        "measured_g": r.value_g,
        "deviation_g": deviation_g,
        "estimated_qty_delta": estimated_qty_delta,
    }
