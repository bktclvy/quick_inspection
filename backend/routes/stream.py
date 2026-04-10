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
        # 常にカメラから読む（キャッシュ更新のため）
        live_frame, _ = camera.get_jpeg_bytes()

        # フリーズ中は検査時フレームを使う
        display_frame = camera.get_stream_frame()
        if display_frame is None:
            if live_frame is None:
                time.sleep(0.5)
                continue
            display_frame = live_frame

        _, jpeg = cv2.imencode(".jpg", display_frame, [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY])

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + jpeg.tobytes()
            + b"\r\n"
        )
        time.sleep(frame_interval)


@router.get("/stream")
async def video_stream():
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
