"""モデル読み込みと推論 — 複数モデルの同時保持に対応。"""
import os
import json
import threading
import numpy as np
import config


class ModelManager:
    def __init__(self):
        self._models: dict[str, dict] = {}  # モデル名 -> {model, class_names, image_size, meta}
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return len(self._models) > 0

    def load(self, model_name: str, model_path: str | None = None,
             meta_path: str | None = None) -> bool:
        import tensorflow as tf

        if model_path is None:
            model_path = os.path.join(config.MODELS_DIR, f"{model_name}.keras")
        if meta_path is None:
            meta_path = os.path.join(config.MODELS_DIR, f"{model_name}_meta.json")

        if not os.path.exists(model_path):
            return False

        with self._lock:
            model = tf.keras.models.load_model(model_path)
            meta = {}
            class_names = []
            image_size = config.DEFAULT_IMAGE_SIZE

            if os.path.exists(meta_path):
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                class_names = meta.get("class_names", [])
                image_size = meta.get("image_size", config.DEFAULT_IMAGE_SIZE)

            class_judgments = meta.get("class_judgments", {})

            self._models[model_name] = {
                "model": model,
                "class_names": class_names,
                "class_judgments": class_judgments,
                "image_size": image_size,
                "meta": meta,
            }
        return True

    def unload(self, model_name: str) -> None:
        with self._lock:
            self._models.pop(model_name, None)

    def unload_all(self) -> None:
        with self._lock:
            self._models.clear()

    def predict(self, frame, model_name: str | None = None) -> dict | None:
        """指定モデルでフレームを推論する。
        model_nameがNoneの場合、最初に読み込まれたモデルを使用（後方互換）。"""
        import tensorflow as tf
        import cv2

        with self._lock:
            if not self._models:
                return None

            if model_name is None:
                model_name = next(iter(self._models))

            entry = self._models.get(model_name)
            if entry is None:
                return None

            model = entry["model"]
            class_names = entry["class_names"]
            class_judgments = entry.get("class_judgments", {})
            image_size = entry["image_size"]

            img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = cv2.resize(img, (image_size, image_size))
            img = np.expand_dims(img, axis=0).astype(np.float32)

            predictions = model.predict(img, verbose=0)
            probs = predictions[0]
            class_idx = int(np.argmax(probs))
            confidence = float(probs[class_idx])

            class_name = (
                class_names[class_idx]
                if class_idx < len(class_names)
                else str(class_idx)
            )

            judgment = class_judgments.get(class_name, "ng")

            return {
                "predicted_class": class_name,
                "judgment": judgment,
                "confidence": round(confidence, 4),
                "probabilities": {
                    class_names[i] if i < len(class_names) else str(i):
                    round(float(probs[i]), 4)
                    for i in range(len(probs))
                },
            }

    def predict_rois(self, frame, rois: list[dict]) -> list[dict]:
        """各ROIを割り当てモデルで推論する。
        ROI別の結果リストを返す。"""
        import cv2

        results = []
        for roi in rois:
            roi_id = roi["id"]
            roi_name = roi.get("name", roi_id)
            model_name = roi.get("model_name")

            if not model_name or model_name not in self._models:
                results.append({
                    "roi_id": roi_id,
                    "roi_name": roi_name,
                    "error": f"モデル未読込: {model_name}",
                })
                continue

            # フレームをROIでクロップ
            h, w = frame.shape[:2]
            x1 = max(0, int(roi["x"] * w))
            y1 = max(0, int(roi["y"] * h))
            x2 = min(w, int((roi["x"] + roi["w"]) * w))
            y2 = min(h, int((roi["y"] + roi["h"]) * h))
            crop = frame[y1:y2, x1:x2]

            if crop.size == 0:
                results.append({
                    "roi_id": roi_id,
                    "roi_name": roi_name,
                    "error": "クロップ領域が空です",
                })
                continue

            pred = self.predict(crop, model_name)
            if pred is None:
                results.append({
                    "roi_id": roi_id,
                    "roi_name": roi_name,
                    "error": "推論に失敗しました",
                })
                continue

            results.append({
                "roi_id": roi_id,
                "roi_name": roi_name,
                "predicted_class": pred["predicted_class"],
                "judgment": pred.get("judgment", "ng"),
                "confidence": pred["confidence"],
                "probabilities": pred["probabilities"],
            })

        return results

    def get_loaded_models(self) -> list[str]:
        with self._lock:
            return list(self._models.keys())

    def get_status(self) -> dict:
        with self._lock:
            if not self._models:
                return {"loaded": False, "models": []}

            models_info = []
            for name, entry in self._models.items():
                models_info.append({
                    "model_name": name,
                    "class_names": entry["class_names"],
                    "image_size": entry["image_size"],
                    "meta": entry["meta"],
                })

            # 後方互換: 最初のモデル情報をトップレベルに展開
            first = models_info[0]
            return {
                "loaded": True,
                "model_name": first["model_name"],
                "class_names": first["class_names"],
                "image_size": first["image_size"],
                "meta": first["meta"],
                "models": models_info,
            }


model_manager = ModelManager()
