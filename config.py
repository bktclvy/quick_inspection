"""グローバル設定定数。"""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASETS_DIR = os.path.join(BASE_DIR, "datasets")
MODELS_DIR = os.path.join(BASE_DIR, "models")

# カメラ
CAMERA_INDEX = 0
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
JPEG_QUALITY = 75
STREAM_FPS = 20

# 検査トリガー（テンプレートマッチング）
MATCH_THRESHOLD = 0.80       # テンプレートマッチスコア閾値（検査発火）
TRIGGER_FRAMES = 3           # 閾値超え連続フレーム数（トリガー発火）
REMOVAL_THRESHOLD = 0.50     # 製品除去判定のスコア閾値
REMOVAL_FRAMES = 3           # 閾値以下の連続フレーム数（除去判定）
JUDGED_DISPLAY_MS = 2000     # 判定結果の表示時間（ミリ秒）
DEFAULT_TRIGGER_MODE = "auto"  # "auto" または "manual"

# 製品
PRODUCTS_DIR = os.path.join(BASE_DIR, "products")

# 学習デフォルト
DEFAULT_EPOCHS = 20
DEFAULT_LEARNING_RATE = 0.001
DEFAULT_BATCH_SIZE = 32
DEFAULT_VALIDATION_SPLIT = 0.2
DEFAULT_IMAGE_SIZE = 224

# サーバー
HOST = "127.0.0.1"


def _find_free_port() -> int:
    """8000番から空きポートを探す。"""
    import socket
    for port in range(8000, 8100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    # フォールバック: OSに任せる
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = _find_free_port()
