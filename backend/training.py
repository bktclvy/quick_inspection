"""MobileNetV2転移学習パイプライン（WebSocket進捗通知付き）。"""
import os
import json
import time
import threading
import asyncio
import logging
import config

log = logging.getLogger("training")
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)


AUGMENTATION_DEFAULTS = {
    "horizontal_flip": True,
    "vertical_flip": False,
    "rotation": 0.1,
    "zoom": 0.1,
    "brightness": 0.1,
    "contrast": 0.1,
}


def _build_augmentation_layers(tf, augmentation) -> list:
    """augmentation パラメータから Keras 拡張レイヤーのリストを構築する。

    augmentation が True の場合はデフォルト設定を使用。
    False の場合は空リスト。dict の場合は個別設定を適用。
    """
    if augmentation is False or augmentation is None:
        return []

    if augmentation is True:
        cfg = dict(AUGMENTATION_DEFAULTS)
    else:
        cfg = dict(AUGMENTATION_DEFAULTS)
        cfg.update(augmentation)

    layers = []
    if cfg.get("horizontal_flip"):
        layers.append(tf.keras.layers.RandomFlip("horizontal"))
    if cfg.get("vertical_flip"):
        layers.append(tf.keras.layers.RandomFlip("vertical"))

    rotation = cfg.get("rotation", 0)
    if rotation and float(rotation) > 0:
        layers.append(tf.keras.layers.RandomRotation(float(rotation)))

    zoom = cfg.get("zoom", 0)
    if zoom and float(zoom) > 0:
        layers.append(tf.keras.layers.RandomZoom(float(zoom)))

    brightness = cfg.get("brightness", 0)
    if brightness and float(brightness) > 0:
        layers.append(tf.keras.layers.RandomBrightness(float(brightness)))

    contrast = cfg.get("contrast", 0)
    if contrast and float(contrast) > 0:
        layers.append(tf.keras.layers.RandomContrast(float(contrast)))

    return layers


class Trainer:
    def __init__(self):
        self._thread = None
        self._stop_event = threading.Event()
        self._status = {"state": "idle"}
        self._loop = None

    def is_running(self):
        return self._thread is not None and self._thread.is_alive()

    def get_status(self):
        return self._status

    def stop(self, timeout: float | None = None):
        """学習を停止する。timeoutを指定するとスレッドの終了を待つ。"""
        self._stop_event.set()
        if timeout is not None and self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def start(self, product_id: str, params: dict):
        self._stop_event.clear()
        self._status = {"state": "starting", "params": params, "product_id": product_id}

        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        self._thread = threading.Thread(
            target=self._train, args=(product_id, params), daemon=False)
        self._thread.start()

    def start_batch(self, product_id: str, roi_jobs: list[dict], base_params: dict):
        """全ROIを順次学習する。roi_jobs: [{roi_id, roi_name, model_name}, ...]"""
        self._stop_event.clear()
        self._status = {"state": "starting_batch", "product_id": product_id,
                        "batch_total": len(roi_jobs)}

        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        self._thread = threading.Thread(
            target=self._train_batch, args=(product_id, roi_jobs, base_params),
            daemon=False)
        self._thread.start()

    def _broadcast(self, message: dict):
        from backend.routes.ws import training_mgr
        loop = self._loop
        if loop is not None:
            try:
                if loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        training_mgr.broadcast(message), loop
                    )
            except RuntimeError:
                pass  # ループが閉じられた場合は無視

    def _train_batch(self, product_id: str, roi_jobs: list[dict], base_params: dict):
        """ROIキューを順次学習する。"""
        from backend.product import product_manager

        total = len(roi_jobs)
        results = []

        for idx, job in enumerate(roi_jobs):
            if self._stop_event.is_set():
                self._status = {"state": "stopped"}
                self._broadcast({"type": "status", "state": "stopped"})
                return

            roi_id = job["roi_id"]
            roi_name = job["roi_name"]
            model_name = job["model_name"]

            self._broadcast({
                "type": "batch_progress",
                "batch_index": idx,
                "batch_total": total,
                "roi_id": roi_id,
                "roi_name": roi_name,
                "model_name": model_name,
            })

            # 個別ROI学習用パラメータを構築
            params = {**base_params, "roi_id": roi_id, "model_name": model_name}
            self._train(product_id, params, batch_info={"index": idx, "total": total,
                                                         "roi_name": roi_name})

            # エラーや停止で中断チェック
            if self._stop_event.is_set():
                self._status = {"state": "stopped"}
                self._broadcast({"type": "status", "state": "stopped"})
                return

            if self._status.get("state") == "error":
                # エラーを記録して次のROIへ続行
                results.append({"roi_id": roi_id, "roi_name": roi_name,
                                "status": "error", "error": self._status.get("error")})
                self._broadcast({
                    "type": "batch_roi_error",
                    "roi_id": roi_id, "roi_name": roi_name,
                    "error": self._status.get("error"),
                    "batch_index": idx, "batch_total": total,
                })
                continue

            meta = self._status.get("meta", {})
            results.append({"roi_id": roi_id, "roi_name": roi_name,
                            "status": "complete", "meta": meta})

            # モデルをROIに自動割当
            product_manager.assign_model(product_id, roi_id, model_name)

        self._status = {"state": "batch_complete", "results": results}
        self._broadcast({
            "type": "batch_complete",
            "results": results,
            "batch_total": total,
        })

    def _train(self, product_id: str, params: dict, batch_info: dict | None = None):
        import tensorflow as tf
        import numpy as np
        from backend.product import product_manager

        try:
            self._status = {"state": "loading_data"}
            self._broadcast({"type": "status", "state": "loading_data"})

            image_size = params.get("image_size", config.DEFAULT_IMAGE_SIZE)
            batch_size = params.get("batch_size", config.DEFAULT_BATCH_SIZE)
            epochs = params.get("epochs", config.DEFAULT_EPOCHS)
            lr = params.get("learning_rate", config.DEFAULT_LEARNING_RATE)
            val_split = params.get("validation_split", config.DEFAULT_VALIDATION_SPLIT)
            freeze_base = params.get("freeze_base", True)
            augmentation = params.get("augmentation", True)
            model_name = params.get("model_name", "model_v1")
            backbone = params.get("backbone", "mobilenetv2")

            # データセットルートを決定（製品スコープ、オプションでROIスコープ）
            roi_id = params.get("roi_id")
            dataset_dir = (product_manager.roi_datasets_dir(product_id, roi_id)
                           if roi_id else product_manager.datasets_dir(product_id))

            # モデル出力ディレクトリを決定（製品スコープ）
            models_dir = product_manager.models_dir(product_id)
            os.makedirs(models_dir, exist_ok=True)

            # データセット検証
            if not os.path.isdir(dataset_dir):
                self._status = {"state": "error", "error": f"データセットディレクトリが見つかりません: {dataset_dir}"}
                self._broadcast({"type": "error", "error": "データセットディレクトリが見つかりません"})
                return

            class_dirs = [
                d for d in os.listdir(dataset_dir)
                if os.path.isdir(os.path.join(dataset_dir, d))
            ]
            if len(class_dirs) < 2:
                self._status = {"state": "error", "error": "2クラス以上が必要です"}
                self._broadcast({"type": "error", "error": "2クラス以上が必要です"})
                return

            for cd in class_dirs:
                count = len([
                    f for f in os.listdir(os.path.join(dataset_dir, cd))
                    if f.lower().endswith((".jpg", ".jpeg", ".png"))
                ])
                if count < 5:
                    self._status = {
                        "state": "error",
                        "error": f"クラス「{cd}」には最低5枚必要です（現在{count}枚）",
                    }
                    self._broadcast({
                        "type": "error",
                        "error": f"クラス「{cd}」には最低5枚必要です（現在{count}枚）",
                    })
                    return

            # データセット読み込み
            train_ds = tf.keras.utils.image_dataset_from_directory(
                dataset_dir,
                validation_split=val_split,
                subset="training",
                seed=42,
                image_size=(image_size, image_size),
                batch_size=batch_size,
            )
            val_ds = tf.keras.utils.image_dataset_from_directory(
                dataset_dir,
                validation_split=val_split,
                subset="validation",
                seed=42,
                image_size=(image_size, image_size),
                batch_size=batch_size,
            )

            class_names = train_ds.class_names
            num_classes = len(class_names)

            # クラス別枚数を集計してログ出力
            class_counts = {}
            for cd in class_names:
                class_counts[cd] = len([
                    f for f in os.listdir(os.path.join(dataset_dir, cd))
                    if f.lower().endswith((".jpg", ".jpeg", ".png"))
                ])

            log.info("=" * 60)
            log.info("学習開始: %s (product=%s, roi=%s, backbone=%s)", model_name, product_id, roi_id or "全体", backbone)
            log.info("データセット: %s", dataset_dir)
            for cn, cnt in class_counts.items():
                log.info("  %-20s %d 枚", cn, cnt)
            log.info("パラメータ: epochs=%d, lr=%.5f, batch=%d, img=%d, freeze=%s",
                     epochs, lr, batch_size, image_size, freeze_base)
            if isinstance(augmentation, dict):
                aug_on = [k for k, v in augmentation.items() if v]
                log.info("データ拡張: %s", ", ".join(aug_on) if aug_on else "なし")
            else:
                log.info("データ拡張: %s", "デフォルト" if augmentation else "なし")
            log.info("=" * 60)

            # クラスのjudgmentマッピングを読み込む
            from backend.routes.api import _load_classes_meta
            classes_meta = _load_classes_meta(dataset_dir)
            class_judgments = {cn: classes_meta.get(cn, "ng") for cn in class_names}

            self._broadcast({
                "type": "status",
                "state": "building_model",
                "class_names": class_names,
            })

            train_ds = train_ds.prefetch(tf.data.AUTOTUNE)
            val_ds = val_ds.prefetch(tf.data.AUTOTUNE)

            # モデル構築
            _backbone_map = {
                "mobilenetv2":      (tf.keras.applications.MobileNetV2,      True),
                "efficientnetv2b0": (tf.keras.applications.EfficientNetV2B0, False),
                "efficientnetv2b3": (tf.keras.applications.EfficientNetV2B3, False),
                "efficientnetv2s":  (tf.keras.applications.EfficientNetV2S,  False),
            }
            BackboneCls, needs_rescale = _backbone_map.get(backbone, _backbone_map["mobilenetv2"])

            base_model = BackboneCls(
                input_shape=(image_size, image_size, 3),
                include_top=False,
                weights="imagenet",
            )
            base_model.trainable = not freeze_base

            # MobileNetV2 は [-1,1] に正規化が必要、EfficientNet 系は内部に前処理を持つ
            preprocess_layers = [tf.keras.layers.Rescaling(1.0 / 127.5, offset=-1)] if needs_rescale else []

            aug_layers = _build_augmentation_layers(tf, augmentation)
            layers = aug_layers + preprocess_layers

            model = tf.keras.Sequential(
                layers + [
                    base_model,
                    tf.keras.layers.GlobalAveragePooling2D(),
                    tf.keras.layers.Dropout(0.2),
                    tf.keras.layers.Dense(128, activation="relu"),
                    tf.keras.layers.Dropout(0.2),
                    tf.keras.layers.Dense(num_classes, activation="softmax"),
                ]
            )

            model.compile(
                optimizer=tf.keras.optimizers.Adam(learning_rate=lr),
                loss="sparse_categorical_crossentropy",
                metrics=["accuracy"],
            )

            self._status = {"state": "training", "epoch": 0, "total_epochs": epochs}
            self._broadcast({"type": "status", "state": "training",
                             **({"batch": batch_info} if batch_info else {})})

            trainer_ref = self
            _batch_info = batch_info

            class ProgressCallback(tf.keras.callbacks.Callback):
                def on_epoch_end(self, epoch, logs=None):
                    if trainer_ref._stop_event.is_set():
                        self.model.stop_training = True
                        return

                    ep = epoch + 1
                    t_loss = round(float(logs.get("loss", 0)), 4)
                    t_acc = round(float(logs.get("accuracy", 0)), 4)
                    v_loss = round(float(logs.get("val_loss", 0)), 4)
                    v_acc = round(float(logs.get("val_accuracy", 0)), 4)

                    log.info("Epoch %2d/%d  loss=%.4f  acc=%.4f  val_loss=%.4f  val_acc=%.4f",
                             ep, epochs, t_loss, t_acc, v_loss, v_acc)

                    data = {
                        "type": "epoch_end",
                        "epoch": ep,
                        "total_epochs": epochs,
                        "train_loss": t_loss,
                        "train_accuracy": t_acc,
                        "val_loss": v_loss,
                        "val_accuracy": v_acc,
                    }
                    if _batch_info:
                        data["batch"] = _batch_info
                    trainer_ref._status = {
                        "state": "training",
                        **data,
                    }
                    trainer_ref._broadcast(data)

            # コールバック
            cb_list = [ProgressCallback()]

            # ベストモデル保存（val_accuracyが改善したエポックのみ）
            model_path = os.path.join(models_dir, f"{model_name}.keras")
            cb_list.append(tf.keras.callbacks.ModelCheckpoint(
                model_path,
                monitor="val_accuracy",
                save_best_only=True,
                mode="max",
                verbose=0,
            ))

            # アーリーストップ
            early_stop_patience = params.get("early_stop_patience", 0)
            if early_stop_patience > 0:
                cb_list.append(tf.keras.callbacks.EarlyStopping(
                    monitor="val_loss",
                    patience=early_stop_patience,
                    restore_best_weights=True,
                    verbose=0,
                ))

            # 学習実行
            start_time = time.time()
            history = model.fit(
                train_ds,
                validation_data=val_ds,
                epochs=epochs,
                callbacks=cb_list,
                verbose=0,
            )
            elapsed = time.time() - start_time

            if self._stop_event.is_set():
                self._status = {"state": "stopped"}
                self._broadcast({"type": "status", "state": "stopped"})
                return

            # メタデータ保存
            hist = history.history
            best_val_acc = max(hist.get("val_accuracy", [0]))
            meta = {
                "model_name": model_name,
                "product_id": product_id,
                "roi_id": roi_id,
                "backbone": backbone,
                "class_names": class_names,
                "class_judgments": class_judgments,
                "num_classes": num_classes,
                "image_size": image_size,
                "epochs_trained": len(hist["loss"]),
                "best_val_accuracy": round(float(best_val_acc), 4),
                "final_train_accuracy": round(float(hist["accuracy"][-1]), 4),
                "final_val_accuracy": round(float(hist["val_accuracy"][-1]), 4),
                "params": params,
                "elapsed_seconds": round(elapsed, 1),
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            meta_path = os.path.join(models_dir, f"{model_name}_meta.json")
            with open(meta_path, "w") as f:
                json.dump(meta, f, indent=2)

            log.info("-" * 60)
            log.info("学習完了: %s  best_val_acc=%.2f%%  elapsed=%.1fs",
                     model_name, best_val_acc * 100, elapsed)
            log.info("保存先: %s", model_path)
            log.info("-" * 60)

            self._status = {"state": "complete", "meta": meta}
            complete_msg = {
                "type": "training_complete",
                "meta": meta,
                "history": {
                    "loss": [round(float(v), 4) for v in hist["loss"]],
                    "accuracy": [round(float(v), 4) for v in hist["accuracy"]],
                    "val_loss": [round(float(v), 4) for v in hist.get("val_loss", [])],
                    "val_accuracy": [round(float(v), 4) for v in hist.get("val_accuracy", [])],
                },
            }
            if batch_info:
                complete_msg["batch"] = batch_info
            self._broadcast(complete_msg)

        except Exception as e:
            log.error("学習エラー: %s", e, exc_info=True)
            self._status = {"state": "error", "error": str(e)}
            self._broadcast({"type": "error", "error": str(e)})


trainer = Trainer()
