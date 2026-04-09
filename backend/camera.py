"""スレッドセーフなOpenCVカメラマネージャー（シングルトン）。"""
import threading
import platform
import cv2
import numpy as np
import config


class CameraManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._cap = None
        self._frame_lock = threading.Lock()
        self._camera_index = config.CAMERA_INDEX
        self._width = config.CAMERA_WIDTH
        self._height = config.CAMERA_HEIGHT
        self._rotation = cv2.ROTATE_180
        self._initialized = True

    def open(self, index=None):
        with self._frame_lock:
            if self._cap is not None:
                self._cap.release()
            idx = index if index is not None else self._camera_index
            self._camera_index = idx
            # WindowsではDirectShowを使用（USBカメラの互換性向上）
            backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
            self._cap = cv2.VideoCapture(idx, backend)
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
            return self._cap.isOpened()

    def close(self):
        with self._frame_lock:
            if self._cap is not None:
                self._cap.release()
                self._cap = None

    def is_opened(self):
        with self._frame_lock:
            return self._cap is not None and self._cap.isOpened()

    def read_frame(self):
        with self._frame_lock:
            if self._cap is None or not self._cap.isOpened():
                return None
            ret, frame = self._cap.read()
            if not ret:
                return None
            if self._rotation is not None:
                frame = cv2.rotate(frame, self._rotation)
            return frame

    def get_jpeg_bytes(self, quality=None):
        frame = self.read_frame()
        if frame is None:
            return None, None
        q = quality or config.JPEG_QUALITY
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, q])
        return frame, buf.tobytes()

    def get_info(self):
        with self._frame_lock:
            if self._cap is None:
                return {"opened": False}
            return {
                "opened": self._cap.isOpened(),
                "index": self._camera_index,
                "width": int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                "height": int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                "fps": round(self._cap.get(cv2.CAP_PROP_FPS), 1),
            }

    def list_cameras(self, max_check=5):
        available = []
        for i in range(max_check):
            # 現在アクティブなカメラはスキップ — Windowsで再オープンすると
            # 既存のキャプチャハンドルが無効化される
            if self._cap is not None and self._cap.isOpened() and i == self._camera_index:
                available.append(i)
                continue
            backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
            cap = cv2.VideoCapture(i, backend)
            if cap.isOpened():
                available.append(i)
                cap.release()
        return available


camera = CameraManager()
