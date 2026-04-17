# Quick Inspection

AI カメラ検査アプリ。USB ウェブカメラで製品を撮影し、MobileNetV2 で OK/NG を判定する。

## 前提

- **同一マシンで完結**: フロントエンドとバックエンドは必ず同じPCで動作する。リモート配信は想定外。
- **Windows 環境**: Python 3.10, DirectShow カメラ
- **配布**: PyInstaller onedir でexe化。別PCのデスクトップ等に配置して使用

## 技術スタック

- Backend: FastAPI + OpenCV + TensorFlow/Keras
- Frontend: React 18 + TypeScript + Vite
  - 状態管理: Zustand
  - チャート: react-chartjs-2
  - CSS: Tailwind CSS v4 + インラインスタイル
- カメラ: サーバー側 OpenCV → MJPEG ストリーミング (`/stream`)
- 音声: Web Audio API (OK/NG/シャッター音、外部ファイル不要)

## セットアップ・起動

```bash
# Backend
python -m venv venv
venv\Scripts\activate     # Windows
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run build             # dist/ にビルド出力

# 起動
python run.py             # デスクトップウィンドウで起動 (dist/ を配信)
python run.py --dev       # 開発用: ブラウザ + ホットリロード
```

### 開発時 (2ターミナル)

```bash
# Terminal 1: Backend
python run.py --dev

# Terminal 2: Frontend (Vite dev server, port 5173)
cd frontend && npm run dev
```

Vite dev server がAPIリクエストを FastAPI にプロキシする。

## 構成

```
backend/
  app.py            # FastAPI app, static mount (dist/ 優先)
  camera.py         # CameraManager singleton (OpenCV, thread-safe)
  inference.py      # ModelManager (TF model load/predict)
  training.py       # Trainer (MobileNetV2 transfer learning, WS progress)
  state_machine.py  # InspectionStateMachine (IDLE→DETECTING→JUDGED→COOLDOWN)
  routes/
    api.py          # REST: /api/products/*, /api/training/*, /api/inspection/*
    ws.py           # WebSocket: /ws/inspection, /ws/training

frontend/           # Vite + React + TypeScript
  src/
    main.tsx        # エントリーポイント
    App.tsx         # Router + Layout
    index.css       # Tailwind エントリー + テーマ変数
    types/          # TypeScript 型定義
    stores/         # Zustand ストア (app, inspection, training)
    hooks/          # カスタム hooks (WS, audio, keyboard)
    api/            # API クライアント
    components/
      app-header.tsx    # ヘッダー
      inspect-page.tsx  # 検査ページ
      setup-page.tsx    # セットアップページ (ウィザード入口)
      setup-wizard.tsx  # セットアップウィザード
      layout/           # Toast
      camera/           # CameraFeed, ROICanvas
      steps/            # ウィザードの各ステップ
        roi-step.tsx
        template-step.tsx
        dataset-step.tsx
        training-step.tsx
        assign-step.tsx

frontend-legacy/    # 旧 Vanilla JS フロントエンド (参照用)
dist/               # Vite ビルド出力 (FastAPI が配信)
products/           # 製品データ (ROI, テンプレート, データセット, モデル)
```

## 検査ステートマシン

```
IDLE → DETECTING → INSPECTING → JUDGED → WAITING_REMOVAL → IDLE
```

- 存在検知: 背景差分 or テンプレートマッチング
- 判定: ROI別モデル推論 + 多数決
- パラメータ: presence_threshold, stability_frames, judged_display_ms 等

## PyInstaller ビルド

```bash
# 必ずフロントエンドを先にビルド（dist/ を生成）
cd frontend && npm run build

# exe ビルド（--distpath で出力先を分離。dist/ を上書きしないように）
cd .. && python -m PyInstaller quick_inspection.spec --noconfirm --distpath build_output
```

### パス解決の注意点

- **バンドルデータ (dist/)**: exe内の `_internal/dist/` に展開される。`app.py` は `__file__` 基準で参照
- **ユーザーデータ (products/)**: exe と同階層。`config.BASE_DIR = os.path.dirname(sys.executable)` で参照
- **`cv2.imread` / `cv2.imwrite` は使用禁止**: 日本語ユーザー名のパス（デスクトップ等）で失敗する。代わりに `product.py` の `_imread` / `_imwrite` を使うこと
- **`__file__` ベースのパス**: frozen 環境では `_internal/` 内を指す。ユーザーデータには `config.BASE_DIR` を使う

## コーディング規約

- フロントは React + TypeScript (Vite)
- UI テーマはライト系 (ダーク非推奨)
- UIライブラリ (shadcn/ui, MUI, Tailwind等) は使わない。手書きCSS
- CSS は 4px グリッドベースのスペーシングシステム
- CSS変数をインラインスタイルで使う場合は `:root` で定義済みか確認する
- Python は型ヒントを適宜使用
