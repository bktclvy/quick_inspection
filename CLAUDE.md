# Quick Inspection

AI カメラ検査アプリ。USB ウェブカメラで製品を撮影し、MobileNetV2 で OK/NG を判定する。

## 前提

- **同一マシンで完結**: フロントエンドとバックエンドは必ず同じPCで動作する。リモート配信は想定外。
- **Windows 環境**: Python 3.10, DirectShow カメラ

## 技術スタック

- Backend: FastAPI + OpenCV + TensorFlow/Keras
- Frontend: Vanilla HTML/CSS/JS (ビルドツール不要), Chart.js (CDN)
- カメラ: サーバー側 OpenCV → MJPEG ストリーミング (`/stream`)
- 音声: Web Audio API (OK/NG/シャッター音、外部ファイル不要)

## セットアップ・起動

```bash
python -m venv venv
venv\Scripts\activate     # Windows
pip install -r requirements.txt
python run.py             # デスクトップウィンドウで起動
python run.py --dev       # 開発用: ブラウザ + ホットリロード
```

## 構成

```
backend/
  app.py            # FastAPI app, static mount
  camera.py         # CameraManager singleton (OpenCV, thread-safe)
  inference.py      # ModelManager (TF model load/predict)
  training.py       # Trainer (MobileNetV2 transfer learning, WS progress)
  state_machine.py  # InspectionStateMachine (IDLE→DETECTING→JUDGED→COOLDOWN)
  routes/
    api.py          # REST: /api/dataset/*, /api/model/*, /api/training/*, /api/config
    ws.py           # WebSocket: /ws/camera, /ws/training

frontend/
  index.html        # SPA (3ページ: 検査, データセット, 学習)
  css/style.css     # Light theme (Clean Room)
  js/
    app.js          # SPA routing
    camera.js       # MJPEG init, カメラ選択, inspection WS
    inspection.js   # 検査ページ
    dataset.js      # データセット撮影ページ
    training.js     # 学習ページ + Chart.js
    components.js   # Toast, AudioFeedback (Web Audio API)

datasets/           # 撮影画像 (クラス別サブフォルダ)
models/             # 学習済みモデル (.keras + _meta.json)
```

## 検査ステートマシン

```
IDLE → DETECTING → JUDGED → COOLDOWN → IDLE
```

- 存在検知: フレーム差分 (背景モデルとの比較)
- 判定: N フレーム蓄積後、多数決 + 信頼度加重
- パラメータ: presence_threshold, required_frames, cooldown_ms, confidence_threshold

## コーディング規約

- フロントは Vanilla JS (フレームワーク不使用)
- UI テーマはライト系 (ダーク非推奨)
- Python は型ヒントを適宜使用
