"""グローバル設定定数。"""
import os
import sys

# PyInstaller exe化時はexeの場所、通常時はスクリプトの場所
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
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
DEFAULT_TRIGGER_MODE = "auto_background"  # "auto_background", "auto_template", "manual"

# 検査トリガー（背景差分モード）
PRESENCE_THRESHOLD = 25.0    # 背景差分の平均値がこれ以上→物体あり (0-255)
STABILITY_THRESHOLD = 5.0    # フレーム間差分の平均値がこれ以下→安定 (0-255)
STABILITY_FRAMES = 8         # 安定が連続Nフレーム→検査発火
REMOVAL_DIFF_THRESHOLD = 40.0  # 背景MADがこれ以下→物体なし（取り出し完了）

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
