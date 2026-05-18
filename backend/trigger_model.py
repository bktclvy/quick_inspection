"""AI トリガー専用モデル (judgment モデルとは独立)。

製品ごとに 1 つの軽量 MobileNetV2 frozen で「present / unstable」を判定する。
ランタイムは全 ROI のクロップを 1 回のバッチ推論で処理し、ROI 別のスコアを返す。

設計の前提:
- 判定モデルとは別物。判定モデルは一切触らない。
- バックボーン固定 (MobileNetV2)。入力 96x96。サイズ・速度優先。
- 学習データ:
    present  = 全 ROI の OK + NG 画像 (judgment データセット)
    unstable = 全 ROI の trigger_data/<roi>/unstable/ 配下の画像
- 出力: products/<p>/trigger_models/trigger.keras + trigger_meta.json
"""
import os
import json
import time
import threading
import asyncio
import logging
import numpy as np
import cv2

import config
from backend.product import _imread, product_manager
from backend import synth

log = logging.getLogger("trigger_model")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s",
                                     datefmt="%H:%M:%S"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)

# ───────── 定数 ─────────

TRIGGER_INPUT_SIZE = 96
TRIGGER_BACKBONE = "mobilenetv2"  # 固定
TRIGGER_MODEL_NAME = "trigger"
CLASS_NAMES = ["present", "unstable"]
PRESENT_IDX = 0
UNSTABLE_IDX = 1


# ───────── パス ─────────

def trigger_models_dir(product_id: str) -> str:
    return os.path.join(product_manager._product_dir(product_id), "trigger_models")


def trigger_model_path(product_id: str) -> str:
    return os.path.join(trigger_models_dir(product_id), f"{TRIGGER_MODEL_NAME}.keras")


def trigger_meta_path(product_id: str) -> str:
    return os.path.join(trigger_models_dir(product_id), f"{TRIGGER_MODEL_NAME}_meta.json")


def get_status(product_id: str) -> dict:
    """そのプロダクトのトリガーモデルの存在と学習日時を返す。"""
    mpath = trigger_model_path(product_id)
    if not os.path.exists(mpath):
        return {"exists": False, "trained_at": None, "meta": None}
    meta = None
    if os.path.exists(trigger_meta_path(product_id)):
        try:
            with open(trigger_meta_path(product_id), "r", encoding="utf-8") as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "exists": True,
        "trained_at": (meta or {}).get("timestamp"),
        "meta": meta,
    }


# ───────── 学習 ─────────

class TriggerTrainer:
    """製品単位でトリガーモデルを学習するバックグラウンドジョブ管理。"""

    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._status: dict = {"state": "idle"}
        self._loop = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def get_status(self) -> dict:
        return self._status

    def stop(self, timeout: float | None = None):
        self._stop_event.set()
        if timeout is not None and self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def start(self, product_id: str, epochs: int = 8, learning_rate: float = 0.001,
              batch_size: int = 32, validation_split: float = 0.2):
        self._stop_event.clear()
        self._status = {"state": "starting", "product_id": product_id}
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
        self._thread = threading.Thread(
            target=self._train,
            args=(product_id, epochs, learning_rate, batch_size, validation_split),
            daemon=False,
        )
        self._thread.start()

    def _broadcast(self, msg: dict):
        loop = self._loop
        if loop is None:
            return
        try:
            from backend.routes.ws import training_mgr
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(training_mgr.broadcast(msg), loop)
        except (RuntimeError, ImportError):
            pass

    def _collect_samples(self, product_id: str) -> tuple[list[str], list[str], list[str]]:
        """(present_paths, unstable_paths, warnings) を返す。
        present教師:
          - 撮影 captures/present/ (ユーザーがその場で撮ったクリーンな present)
          - + 全 ROI の judgment="ok" クラス画像 (judgment データセット由来)
        unstable教師:
          - 撮影 captures/absent/ (ユーザー撮影の「製品なし」)
          - + 撮影 captures/obstructed/ (任意。手映り等)
          - + 全 ROI の trigger_data/<roi>/unstable/ 配下の合成画像
        """
        p = product_manager.get(product_id)
        if not p:
            return [], [], []
        present_paths: list[str] = []
        unstable_paths: list[str] = []
        warnings: list[str] = []

        # 撮影画像 (フルフレーム): trigger model は 96x96 入力なのでクロップ不要
        present_paths.extend(synth.list_capture_paths(product_id, "present"))
        unstable_paths.extend(synth.list_capture_paths(product_id, "absent"))
        unstable_paths.extend(synth.list_capture_paths(product_id, "obstructed"))

        # judgment データセット (ROI 別クロップ) + 合成 (ROI 別)
        for roi in p.rois:
            paths, warns = synth._collect_source_images(product_id, roi.id)
            present_paths.extend(paths)
            for w in warns:
                warnings.append(f"{roi.name}: {w}")
            udir = synth.get_unstable_dir(product_id, roi.id)
            if os.path.isdir(udir):
                for f in os.listdir(udir):
                    if f.lower().endswith((".jpg", ".jpeg", ".png")):
                        unstable_paths.append(os.path.join(udir, f))
        return present_paths, unstable_paths, warnings

    def _load_image(self, path: str, size: int) -> np.ndarray | None:
        img = _imread(path, cv2.IMREAD_COLOR)
        if img is None:
            return None
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
        return img.astype(np.float32)

    def _train(self, product_id: str, epochs: int, lr: float,
               batch_size: int, val_split: float):
        try:
            import tensorflow as tf

            self._status = {"state": "loading_data", "product_id": product_id}
            self._broadcast({"type": "trigger_status", "state": "loading_data"})

            present_paths, unstable_paths, warnings = self._collect_samples(product_id)
            n_present = len(present_paths)
            n_unstable = len(unstable_paths)
            log.info("=" * 60)
            log.info("AI トリガー学習: product=%s", product_id)
            log.info("  present  = %d 枚 (judgment='ok' クラスのみ)", n_present)
            log.info("  unstable = %d 枚 (合成データ)", n_unstable)
            for w in warnings:
                log.warning("  ! %s", w)

            if n_present < 5 or n_unstable < 5:
                msg = (f"学習データ不足: present={n_present}, unstable={n_unstable} "
                       f"(各5枚以上必要)")
                log.error(msg)
                self._status = {"state": "error", "error": msg}
                self._broadcast({"type": "trigger_error", "error": msg})
                return

            # 画像をメモリにロード (96x96 と小さいので問題なし)
            X_list: list[np.ndarray] = []
            y_list: list[int] = []
            for path in present_paths:
                if self._stop_event.is_set():
                    return
                img = self._load_image(path, TRIGGER_INPUT_SIZE)
                if img is not None:
                    X_list.append(img)
                    y_list.append(PRESENT_IDX)
            for path in unstable_paths:
                if self._stop_event.is_set():
                    return
                img = self._load_image(path, TRIGGER_INPUT_SIZE)
                if img is not None:
                    X_list.append(img)
                    y_list.append(UNSTABLE_IDX)

            X = np.stack(X_list, axis=0)
            y = np.array(y_list, dtype=np.int32)
            log.info("  total tensor: X=%s, y=%s", X.shape, y.shape)

            # クラスバランス調整: class_weight でスケーリング
            class_counts = np.bincount(y, minlength=2)
            total = class_counts.sum()
            class_weight = {
                int(i): float(total / (2 * max(1, c))) for i, c in enumerate(class_counts)
            }
            log.info("  class_weight = %s", class_weight)

            # 軽い augmentation。合成自体がノイズになるので過剰にしない。
            aug = tf.keras.Sequential([
                tf.keras.layers.RandomFlip("horizontal"),
                tf.keras.layers.RandomBrightness(0.05),
                tf.keras.layers.RandomContrast(0.05),
            ], name="trigger_aug")

            # MobileNetV2 は [-1, 1] 正規化が必要
            base = tf.keras.applications.MobileNetV2(
                input_shape=(TRIGGER_INPUT_SIZE, TRIGGER_INPUT_SIZE, 3),
                include_top=False,
                weights="imagenet",
            )
            base.trainable = False

            model = tf.keras.Sequential([
                aug,
                tf.keras.layers.Rescaling(1.0 / 127.5, offset=-1),
                base,
                tf.keras.layers.GlobalAveragePooling2D(),
                tf.keras.layers.Dropout(0.2),
                tf.keras.layers.Dense(64, activation="relu"),
                tf.keras.layers.Dropout(0.2),
                tf.keras.layers.Dense(2, activation="softmax"),
            ])
            model.compile(
                optimizer=tf.keras.optimizers.Adam(learning_rate=lr),
                loss="sparse_categorical_crossentropy",
                metrics=["accuracy"],
            )

            # 同一テンソルで val_split。シャッフルされるよう dataset 化
            n = len(X)
            indices = np.arange(n)
            rng = np.random.RandomState(42)
            rng.shuffle(indices)
            X = X[indices]
            y = y[indices]
            n_val = max(1, int(n * val_split))
            X_train, y_train = X[n_val:], y[n_val:]
            X_val, y_val = X[:n_val], y[:n_val]

            self._status = {"state": "training", "epoch": 0, "total_epochs": epochs}
            self._broadcast({
                "type": "trigger_status", "state": "training",
                "n_present": n_present, "n_unstable": n_unstable,
            })

            trainer_ref = self

            class ProgressCB(tf.keras.callbacks.Callback):
                def on_epoch_end(self, epoch, logs=None):
                    if trainer_ref._stop_event.is_set():
                        self.model.stop_training = True
                        return
                    ep = epoch + 1
                    t_loss = round(float(logs.get("loss", 0)), 4)
                    t_acc = round(float(logs.get("accuracy", 0)), 4)
                    v_loss = round(float(logs.get("val_loss", 0)), 4)
                    v_acc = round(float(logs.get("val_accuracy", 0)), 4)
                    log.info("  Epoch %2d/%d loss=%.4f acc=%.4f val_loss=%.4f val_acc=%.4f",
                             ep, epochs, t_loss, t_acc, v_loss, v_acc)
                    trainer_ref._status = {
                        "state": "training", "epoch": ep, "total_epochs": epochs,
                        "train_loss": t_loss, "train_accuracy": t_acc,
                        "val_loss": v_loss, "val_accuracy": v_acc,
                    }
                    trainer_ref._broadcast({
                        "type": "trigger_epoch", "epoch": ep, "total_epochs": epochs,
                        "train_loss": t_loss, "train_accuracy": t_acc,
                        "val_loss": v_loss, "val_accuracy": v_acc,
                    })

            mdir = trigger_models_dir(product_id)
            os.makedirs(mdir, exist_ok=True)
            mpath = trigger_model_path(product_id)
            cbs = [
                ProgressCB(),
                tf.keras.callbacks.ModelCheckpoint(
                    mpath, monitor="val_accuracy", save_best_only=True,
                    mode="max", verbose=0,
                ),
            ]

            t0 = time.time()
            history = model.fit(
                X_train, y_train,
                validation_data=(X_val, y_val),
                epochs=epochs,
                batch_size=batch_size,
                callbacks=cbs,
                class_weight=class_weight,
                verbose=0,
            )
            elapsed = time.time() - t0

            if self._stop_event.is_set():
                self._status = {"state": "stopped"}
                self._broadcast({"type": "trigger_status", "state": "stopped"})
                return

            hist = history.history
            best_val_acc = max(hist.get("val_accuracy", [0]))
            meta = {
                "product_id": product_id,
                "backbone": TRIGGER_BACKBONE,
                "input_size": TRIGGER_INPUT_SIZE,
                "class_names": CLASS_NAMES,
                "n_present": n_present,
                "n_unstable": n_unstable,
                "epochs_trained": len(hist["loss"]),
                "best_val_accuracy": round(float(best_val_acc), 4),
                "final_train_accuracy": round(float(hist["accuracy"][-1]), 4),
                "final_val_accuracy": round(float(hist["val_accuracy"][-1]), 4),
                "elapsed_seconds": round(elapsed, 1),
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            with open(trigger_meta_path(product_id), "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2, ensure_ascii=False)

            log.info("-" * 60)
            log.info("学習完了: val_acc=%.2f%% elapsed=%.1fs",
                     best_val_acc * 100, elapsed)
            log.info("保存先: %s", mpath)

            # 学習直後に推論用にリロード
            try:
                trigger_model_manager.load(product_id)
            except Exception as e:
                log.warning("リロード失敗: %s", e)

            # 撮影画像は「一時的な利用」とするため、学習成功で自動削除する
            deleted = synth.clear_captures(product_id)
            if deleted > 0:
                log.info("撮影画像 %d 枚を自動削除しました", deleted)

            self._status = {"state": "complete", "meta": meta}
            self._broadcast({
                "type": "trigger_complete", "meta": meta,
                "history": {
                    "loss": [round(float(v), 4) for v in hist["loss"]],
                    "accuracy": [round(float(v), 4) for v in hist["accuracy"]],
                    "val_loss": [round(float(v), 4) for v in hist.get("val_loss", [])],
                    "val_accuracy": [round(float(v), 4) for v in hist.get("val_accuracy", [])],
                },
                "captures_cleared": deleted,
            })

        except Exception as e:
            log.error("学習エラー: %s", e, exc_info=True)
            self._status = {"state": "error", "error": str(e)}
            self._broadcast({"type": "trigger_error", "error": str(e)})


# ───────── 推論マネージャ ─────────

class TriggerModelManager:
    """製品ごとのトリガーモデルをロードし、フレームをバッチ推論する。
    ROI を crop → 96x96 リサイズ → 1 回の predict で全 ROI のスコアを取得。
    """

    def __init__(self):
        self._models: dict[str, dict] = {}  # product_id -> {predict_fn, meta}
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return len(self._models) > 0

    def is_loaded_for(self, product_id: str) -> bool:
        with self._lock:
            return product_id in self._models

    def load(self, product_id: str) -> bool:
        import tensorflow as tf
        mpath = trigger_model_path(product_id)
        if not os.path.exists(mpath):
            return False
        with self._lock:
            model = tf.keras.models.load_model(mpath)
            predict_fn = tf.function(lambda x: model(x, training=False))
            # ウォームアップ (バッチサイズ可変)
            dummy = tf.zeros((1, TRIGGER_INPUT_SIZE, TRIGGER_INPUT_SIZE, 3))
            predict_fn(dummy)
            meta = None
            if os.path.exists(trigger_meta_path(product_id)):
                try:
                    with open(trigger_meta_path(product_id), "r", encoding="utf-8") as f:
                        meta = json.load(f)
                except (json.JSONDecodeError, OSError):
                    pass
            self._models[product_id] = {
                "model": model,
                "predict_fn": predict_fn,
                "meta": meta,
            }
        return True

    def unload(self, product_id: str):
        with self._lock:
            self._models.pop(product_id, None)

    def unload_all(self):
        with self._lock:
            self._models.clear()

    def predict_rois_batched(self, frame: np.ndarray, rois: list) -> dict[str, dict] | None:
        """各 ROI を crop & resize し、まとめて 1 回のバッチ推論。
        Returns: dict[roi_id, {"present_score": float, "unstable_score": float, "judgment": "present"|"unstable"}]
                 モデル未ロードなら None。
        """
        import tensorflow as tf
        with self._lock:
            if not self._models:
                return None
            # 一番最近ロードした製品を使う想定だが、明示するなら呼び出し側で load を保証する
            product_id = next(iter(self._models))
            predict_fn = self._models[product_id]["predict_fn"]

        if not rois:
            return {}

        fh, fw = frame.shape[:2]
        roi_crops: list[np.ndarray] = []
        roi_ids: list[str] = []
        for roi in rois:
            # roi: ROIDefinition または dict
            if isinstance(roi, dict):
                rid = roi["id"]
                rx, ry, rw, rh = roi["x"], roi["y"], roi["w"], roi["h"]
            else:
                rid = roi.id
                rx, ry, rw, rh = roi.x, roi.y, roi.w, roi.h
            x1 = max(0, int(rx * fw))
            y1 = max(0, int(ry * fh))
            x2 = min(fw, int((rx + rw) * fw))
            y2 = min(fh, int((ry + rh) * fh))
            crop = frame[y1:y2, x1:x2]
            if crop.size == 0:
                # 0埋めダミーを入れて結果側で扱う
                crop = np.zeros((TRIGGER_INPUT_SIZE, TRIGGER_INPUT_SIZE, 3), dtype=np.uint8)
            else:
                crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                crop = cv2.resize(crop, (TRIGGER_INPUT_SIZE, TRIGGER_INPUT_SIZE),
                                  interpolation=cv2.INTER_AREA)
            roi_crops.append(crop.astype(np.float32))
            roi_ids.append(rid)

        batch = np.stack(roi_crops, axis=0)
        probs = predict_fn(tf.constant(batch)).numpy()  # (N, 2)

        result = {}
        for i, rid in enumerate(roi_ids):
            p_present = float(probs[i, PRESENT_IDX])
            p_unstable = float(probs[i, UNSTABLE_IDX])
            judgment = "present" if p_present >= p_unstable else "unstable"
            result[rid] = {
                "present_score": round(p_present, 4),
                "unstable_score": round(p_unstable, 4),
                "judgment": judgment,
            }
        return result


# モジュール単一インスタンス
trigger_trainer = TriggerTrainer()
trigger_model_manager = TriggerModelManager()
