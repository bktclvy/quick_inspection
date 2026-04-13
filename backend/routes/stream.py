"""MJPEGストリーミングエンドポイント — ローカルカメラ配信。"""
import time
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from backend.camera import camera
import config

router = APIRouter()


def mjpeg_generator():
    """MJPEGマルチパートフレームを生成する。"""
    import cv2
    frame_interval = 1.0 / config.STREAM_FPS
    while True:
        t0 = time.monotonic()

        # キャプチャスレッドが更新するフレームを使用（フリーズ中は検査時フレーム）
        display_frame = camera.get_stream_frame()
        if display_frame is None:
            time.sleep(0.1)
            continue

        _, jpeg = cv2.imencode(".jpg", display_frame, [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY])

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + jpeg.tobytes()
            + b"\r\n"
        )
        # 正確なフレームレート維持（処理時間を差し引く）
        elapsed = time.monotonic() - t0
        remaining = frame_interval - elapsed
        if remaining > 0:
            time.sleep(remaining)


@router.get("/stream")
async def video_stream():
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
