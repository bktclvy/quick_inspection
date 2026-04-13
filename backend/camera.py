"""スレッドセーフなOpenCVカメラマネージャー（シングルトン）。"""
import threading
import platform
import time
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
        self._flip_h: bool = False
        self._flip_v: bool = False
        # カメラ設定の意図値（ドライバが正しく返さないため自前で保持）
        self._autofocus: bool = True
        self._focus_value: int = 0
        self._auto_exposure: bool = True
        self._exposure_value: int = -6
        # フレームキャッシュ（ストリームとWSループで共有）
        self._latest_frame: np.ndarray | None = None
        self._frame_id: int = 0
        # キャプチャスレッド（カメラバッファ蓄積によるラグを防止）
        self._capture_thread: threading.Thread | None = None
        self._capture_running: bool = False
        # フリーズフレーム（検査結果表示中はこのフレームをストリームに使う）
        self._frozen_frame: np.ndarray | None = None
        self._frozen: bool = False
        self._initialized = True

    def open(self, index=None):
        self._stop_capture()
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
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            opened = self._cap.isOpened()
        if opened:
            self._start_capture()
        return opened

    def close(self):
        self._stop_capture()
        with self._frame_lock:
            if self._cap is not None:
                self._cap.release()
                self._cap = None

    def _start_capture(self):
        if self._capture_running:
            return
        self._capture_running = True
        self._capture_thread = threading.Thread(
            target=self._capture_loop, daemon=True, name="camera-capture")
        self._capture_thread.start()

    def _stop_capture(self):
        self._capture_running = False
        if self._capture_thread is not None:
            self._capture_thread.join(timeout=2.0)
            self._capture_thread = None

    def _capture_loop(self):
        """常にカメラからフレームを読み取り、最新フレームのみ保持。
        カメラのOSバッファ蓄積を防ぎ、映像遅延を抑制する。"""
        while self._capture_running:
            with self._frame_lock:
                if self._cap is None or not self._cap.isOpened():
                    break
                ret, frame = self._cap.read()
            if not ret:
                time.sleep(0.01)
                continue
            if self._rotation is not None:
                frame = cv2.rotate(frame, self._rotation)
            if self._flip_h:
                frame = cv2.flip(frame, 1)
            if self._flip_v:
                frame = cv2.flip(frame, 0)
            self._latest_frame = frame
            self._frame_id += 1

    def is_opened(self):
        with self._frame_lock:
            return self._cap is not None and self._cap.isOpened()

    def read_frame(self):
        """最新フレームを返す。キャプチャスレッド稼働中はキャッシュを使用。"""
        if self._capture_running and self._latest_frame is not None:
            return self._latest_frame
        # フォールバック: キャプチャスレッド未稼働時は直接読む
        with self._frame_lock:
            if self._cap is None or not self._cap.isOpened():
                return None
            ret, frame = self._cap.read()
            if not ret:
                return None
            if self._rotation is not None:
                frame = cv2.rotate(frame, self._rotation)
            if self._flip_h:
                frame = cv2.flip(frame, 1)
            if self._flip_v:
                frame = cv2.flip(frame, 0)
            self._latest_frame = frame
            self._frame_id += 1
            return frame

    def get_latest_frame(self) -> tuple[np.ndarray | None, int]:
        """キャッシュ済みの最新フレームとIDを返す（カメラ読み取りなし）。"""
        return self._latest_frame, self._frame_id

    def freeze_frame(self, frame: np.ndarray | None = None):
        """現在のフレーム（または指定フレーム）をフリーズ。ストリームにこのフレームを返し続ける。"""
        self._frozen_frame = frame if frame is not None else self._latest_frame
        self._frozen = True

    def unfreeze_frame(self):
        """フリーズを解除。ストリームがライブに戻る。"""
        self._frozen = False
        self._frozen_frame = None

    def get_stream_frame(self) -> np.ndarray | None:
        """ストリーム配信用のフレームを返す。フリーズ中は検査時のフレーム。"""
        if self._frozen and self._frozen_frame is not None:
            return self._frozen_frame
        return self._latest_frame

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

    def set_flip(self, horizontal: bool = False, vertical: bool = False):
        """映像の反転設定。"""
        self._flip_h = horizontal
        self._flip_v = vertical

    def set_autofocus(self, enabled: bool, focus_value: int | None = None):
        """オートフォーカスの制御。enabled=Falseで固定フォーカス。"""
        self._autofocus = enabled
        if focus_value is not None:
            self._focus_value = focus_value
        with self._frame_lock:
            if self._cap is None or not self._cap.isOpened():
                return
            if enabled:
                self._cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
            else:
                self._cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
                if focus_value is not None:
                    self._cap.set(cv2.CAP_PROP_FOCUS, focus_value)

    def set_exposure(self, auto: bool, value: int | None = None):
        """露出制御。"""
        self._auto_exposure = auto
        if value is not None:
            self._exposure_value = value
        with self._frame_lock:
            if self._cap is None or not self._cap.isOpened():
                return
            if auto:
                self._cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 3)  # auto
            else:
                self._cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1)  # manual
                if value is not None:
                    self._cap.set(cv2.CAP_PROP_EXPOSURE, value)

    def get_camera_properties(self) -> dict:
        """現在のカメラプロパティを取得。意図値を返す（ドライバの報告値は不正確なため）。"""
        return {
            "autofocus": self._autofocus,
            "focus": self._focus_value,
            "auto_exposure": self._auto_exposure,
            "exposure": self._exposure_value,
            "flip_h": self._flip_h,
            "flip_v": self._flip_v,
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
