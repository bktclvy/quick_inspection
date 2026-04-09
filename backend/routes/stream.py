"""MJPEGストリーミングエンドポイント — ローカルカメラ配信。"""
import time
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from backend.camera import camera
import config

router = APIRouter()


def mjpeg_generator():
    """MJPEGマルチパートフレームを生成する。"""
    frame_interval = 1.0 / config.STREAM_FPS
    while True:
        _, jpeg = camera.get_jpeg_bytes()
        if jpeg is None:
            time.sleep(0.5)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + jpeg
            + b"\r\n"
        )
        time.sleep(frame_interval)


@router.get("/stream")
async def video_stream():
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
