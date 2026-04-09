"""REST APIエンドポイント — 製品スコープ構成。"""
import os
import json
import time
import shutil
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from backend.camera import camera
from backend.product import product_manager
import config

router = APIRouter()


# ─── クラスメタデータ (judgment) ヘルパー ─────────────────────

def _classes_meta_path(base_dir: str) -> str:
    return os.path.join(base_dir, "classes_meta.json")


def _load_classes_meta(base_dir: str) -> dict[str, str]:
    """クラス名 → judgment ("ok"/"ng") のマッピングを読み込む。"""
    path = _classes_meta_path(base_dir)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_classes_meta(base_dir: str, meta: dict[str, str]):
    os.makedirs(base_dir, exist_ok=True)
    with open(_classes_meta_path(base_dir), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


# ─── 製品 ─────────────────────────────────────────────────

@router.get("/products")
async def list_products():
    return {"products": product_manager.get_all()}


class CreateProduct(BaseModel):
    name: str
    description: str = ""


@router.post("/products")
async def create_product(data: CreateProduct):
    return product_manager.create(data.name, data.description)


@router.get("/products/{product_id}")
async def get_product(product_id: str):
    p = product_manager.get_dict(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    return p


class UpdateProduct(BaseModel):
    name: str | None = None
    description: str | None = None
    inspection_config: dict | None = None


@router.put("/products/{product_id}")
async def update_product(product_id: str, data: UpdateProduct):
    p = product_manager.update(product_id, **data.model_dump(exclude_none=True))
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    return p


@router.delete("/products/{product_id}")
async def delete_product(product_id: str):
    if not product_manager.delete(product_id):
        raise HTTPException(404, "製品が見つかりません")
    return {"message": "製品を削除しました"}


# ─── ROI（製品内）────────────────────────────────────────

class CreateROI(BaseModel):
    name: str
    x: float
    y: float
    w: float
    h: float
    color: str | None = None


@router.post("/products/{product_id}/rois")
async def add_roi(product_id: str, data: CreateROI):
    roi = product_manager.add_roi(product_id, data.name, data.x, data.y, data.w, data.h, data.color)
    if not roi:
        raise HTTPException(404, "製品が見つかりません")
    return roi


class UpdateROI(BaseModel):
    name: str | None = None
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None
    color: str | None = None
    model_name: str | None = None


@router.put("/products/{product_id}/rois/{roi_id}")
async def update_roi(product_id: str, roi_id: str, data: UpdateROI):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    roi = product_manager.update_roi(product_id, roi_id, **updates)
    if not roi:
        raise HTTPException(404, "ROIが見つかりません")
    return roi


@router.delete("/products/{product_id}/rois/{roi_id}")
async def delete_roi(product_id: str, roi_id: str):
    if not product_manager.delete_roi(product_id, roi_id):
        raise HTTPException(404, "ROIが見つかりません")
    return {"message": "ROIを削除しました"}


class AssignModel(BaseModel):
    model_name: str | None = None


@router.post("/products/{product_id}/rois/{roi_id}/assign-model")
async def assign_model(product_id: str, roi_id: str, data: AssignModel):
    if not product_manager.assign_model(product_id, roi_id, data.model_name):
        raise HTTPException(404, "ROIが見つかりません")
    return {"message": "モデルを割り当てました"}


@router.post("/products/{product_id}/rois/{roi_id}/capture-template")
async def capture_template(product_id: str, roi_id: str):
    frame = camera.read_frame()
    if frame is None:
        raise HTTPException(500, "カメラからフレームを取得できません")
    if not product_manager.capture_template(product_id, roi_id, frame):
        raise HTTPException(404, "ROIが見つからないか、クロップに失敗しました")
    return {"message": "テンプレートを撮影しました"}


@router.post("/products/{product_id}/capture-background")
async def capture_background(product_id: str):
    """現在のカメラフレームを背景参照画像として保存する。"""
    frame = camera.read_frame()
    if frame is None:
        raise HTTPException(500, "カメラからフレームを取得できません")
    if not product_manager.capture_background(product_id, frame):
        raise HTTPException(404, "製品が見つかりません")
    return {"message": "背景を撮影しました", "has_background": True}


@router.get("/products/{product_id}/background-status")
async def background_status(product_id: str):
    return {"has_background": product_manager.has_background(product_id)}


@router.get("/products/{product_id}/rois/{roi_id}/template")
async def get_template(product_id: str, roi_id: str):
    path = product_manager.get_template_path(product_id, roi_id)
    if not path:
        raise HTTPException(404, "テンプレートが見つかりません")
    return FileResponse(path, media_type="image/jpeg")


# ─── カメラ ───────────────────────────────────────────────

@router.get("/camera/status")
async def camera_status():
    return camera.get_info()


class CameraConfig(BaseModel):
    index: int = 0


@router.post("/camera/configure")
async def camera_configure(cfg: CameraConfig):
    ok = camera.open(cfg.index)
    if not ok:
        raise HTTPException(400, f"カメラ {cfg.index} を開けません")
    return camera.get_info()


@router.get("/camera/list")
async def camera_list():
    return {"cameras": camera.list_cameras()}


# ─── データセット（製品スコープ）─────────────────────────

@router.get("/products/{product_id}/dataset/classes")
async def dataset_classes(product_id: str, roi_id: str | None = None):
    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    base = product_manager.datasets_dir(product_id)
    if roi_id:
        base = os.path.join(base, roi_id)
    os.makedirs(base, exist_ok=True)
    meta = _load_classes_meta(base)
    classes = []
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name)
        if os.path.isdir(path):
            count = len([f for f in os.listdir(path)
                        if f.lower().endswith((".jpg", ".jpeg", ".png"))])
            classes.append({
                "name": name,
                "count": count,
                "judgment": meta.get(name, "ng"),
            })
    return {"classes": classes}


class CreateClass(BaseModel):
    class_name: str
    roi_id: str | None = None
    judgment: str = "ng"  # "ok" or "ng"


@router.post("/products/{product_id}/dataset/class")
async def create_class(product_id: str, data: CreateClass):
    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    base = product_manager.datasets_dir(product_id)
    meta_base = base
    if data.roi_id:
        meta_base = os.path.join(base, data.roi_id)
        path = os.path.join(meta_base, data.class_name)
    else:
        path = os.path.join(base, data.class_name)
    if os.path.exists(path):
        raise HTTPException(400, f"クラス「{data.class_name}」は既に存在します")
    os.makedirs(path, exist_ok=True)
    # judgment メタデータ保存
    meta = _load_classes_meta(meta_base)
    meta[data.class_name] = data.judgment
    _save_classes_meta(meta_base, meta)
    return {"message": f"クラス「{data.class_name}」を作成しました"}


@router.delete("/products/{product_id}/dataset/class/{class_name}")
async def delete_class(product_id: str, class_name: str, roi_id: str | None = None):
    base = product_manager.datasets_dir(product_id)
    meta_base = base
    if roi_id:
        meta_base = os.path.join(base, roi_id)
        path = os.path.join(meta_base, class_name)
    else:
        path = os.path.join(base, class_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"クラス「{class_name}」が見つかりません")
    shutil.rmtree(path)
    # judgment メタデータからも削除
    meta = _load_classes_meta(meta_base)
    meta.pop(class_name, None)
    _save_classes_meta(meta_base, meta)
    return {"message": f"クラス「{class_name}」を削除しました"}


class CaptureRequest(BaseModel):
    class_name: str
    roi_id: str | None = None


@router.post("/products/{product_id}/dataset/capture")
async def capture_image(product_id: str, data: CaptureRequest):
    import cv2

    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")

    base = product_manager.datasets_dir(product_id)
    if data.roi_id:
        class_dir = os.path.join(base, data.roi_id, data.class_name)
    else:
        class_dir = os.path.join(base, data.class_name)
    os.makedirs(class_dir, exist_ok=True)

    frame = camera.read_frame()
    if frame is None:
        raise HTTPException(500, "カメラからフレームを取得できません")

    if data.roi_id:
        roi = p.get_roi(data.roi_id)
        if roi:
            frame = roi.crop_frame(frame)

    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
    jpeg = buf.tobytes()

    filename = f"{int(time.time() * 1000)}.jpg"
    filepath = os.path.join(class_dir, filename)
    with open(filepath, "wb") as f:
        f.write(jpeg)

    count = len([f for f in os.listdir(class_dir)
                if f.lower().endswith((".jpg", ".jpeg", ".png"))])
    return {"filename": filename, "class_name": data.class_name, "count": count}


@router.get("/products/{product_id}/dataset/images/{class_name}")
async def list_images(product_id: str, class_name: str, roi_id: str | None = None):
    base = product_manager.datasets_dir(product_id)
    if roi_id:
        class_dir = os.path.join(base, roi_id, class_name)
    else:
        class_dir = os.path.join(base, class_name)
    if not os.path.exists(class_dir):
        raise HTTPException(404, f"クラス「{class_name}」が見つかりません")
    images = sorted(
        [f for f in os.listdir(class_dir)
         if f.lower().endswith((".jpg", ".jpeg", ".png"))],
        reverse=True,
    )
    return {"class_name": class_name, "images": images}


class DeleteImage(BaseModel):
    class_name: str
    filename: str
    roi_id: str | None = None


@router.post("/products/{product_id}/dataset/delete-image")
async def delete_image(product_id: str, data: DeleteImage):
    base = product_manager.datasets_dir(product_id)
    if data.roi_id:
        filepath = os.path.join(base, data.roi_id, data.class_name, data.filename)
    else:
        filepath = os.path.join(base, data.class_name, data.filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "画像が見つかりません")
    os.remove(filepath)
    return {"message": "画像を削除しました"}


@router.get("/products/{product_id}/dataset/file/{class_name}/{filename}")
async def serve_dataset_image(product_id: str, class_name: str, filename: str,
                              roi_id: str | None = None):
    base = product_manager.datasets_dir(product_id)
    if roi_id:
        filepath = os.path.join(base, roi_id, class_name, filename)
    else:
        filepath = os.path.join(base, class_name, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "画像が見つかりません")
    return FileResponse(filepath, media_type="image/jpeg")


class ImportFolder(BaseModel):
    class_name: str
    roi_id: str | None = None


@router.post("/products/{product_id}/dataset/import-folder")
async def import_folder(product_id: str, data: ImportFolder):
    """フォルダを選択して画像をクラスにインポートする。"""
    import threading

    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")

    base = product_manager.datasets_dir(product_id)
    if data.roi_id:
        class_dir = os.path.join(base, data.roi_id, data.class_name)
    else:
        class_dir = os.path.join(base, data.class_name)
    os.makedirs(class_dir, exist_ok=True)

    result = {"folder": None}

    def pick_folder():
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title=f"インポートするフォルダを選択 → {data.class_name}")
        root.destroy()
        result["folder"] = folder

    t = threading.Thread(target=pick_folder)
    t.start()
    t.join(timeout=120)

    folder = result["folder"]
    if not folder or not os.path.isdir(folder):
        return {"imported": 0, "message": "キャンセルされました"}

    imported = 0
    for f in os.listdir(folder):
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp")):
            src = os.path.join(folder, f)
            dst = os.path.join(class_dir, f)
            if not os.path.exists(dst):
                shutil.copy2(src, dst)
                imported += 1

    count = len([f for f in os.listdir(class_dir)
                if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp"))])
    return {"imported": imported, "count": count, "message": f"{imported} 枚インポートしました"}


# ─── モデル（製品スコープ）────────────────────────────────

@router.get("/products/{product_id}/models")
async def list_product_models(product_id: str):
    return {"models": product_manager.list_models(product_id)}


@router.post("/products/{product_id}/models/{model_name}/load")
async def load_product_model(product_id: str, model_name: str):
    from backend.inference import model_manager
    model_path = os.path.join(product_manager.models_dir(product_id), f"{model_name}.keras")
    meta_path = os.path.join(product_manager.models_dir(product_id), f"{model_name}_meta.json")
    if not os.path.exists(model_path):
        raise HTTPException(404, f"モデル「{model_name}」が見つかりません")
    ok = model_manager.load(model_name, model_path, meta_path)
    if not ok:
        raise HTTPException(400, f"モデル「{model_name}」を読み込めません")
    return model_manager.get_status()


@router.delete("/products/{product_id}/models/{model_name}")
async def delete_product_model(product_id: str, model_name: str):
    mdir = product_manager.models_dir(product_id)
    model_path = os.path.join(mdir, f"{model_name}.keras")
    meta_path = os.path.join(mdir, f"{model_name}_meta.json")
    deleted = False
    for p in [model_path, meta_path]:
        if os.path.exists(p):
            os.remove(p)
            deleted = True
    if not deleted:
        raise HTTPException(404, f"モデル「{model_name}」が見つかりません")
    return {"message": f"モデル「{model_name}」を削除しました"}


@router.post("/products/{product_id}/predict-once")
async def predict_once(product_id: str):
    """現在のカメラフレームで1回だけ推論し結果を返す（モデル割当確認用）。"""
    from backend.inference import model_manager
    import asyncio

    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    if not p.rois:
        raise HTTPException(400, "ROIが定義されていません")

    frame = camera.read_frame()
    if frame is None:
        raise HTTPException(500, "カメラからフレームを取得できません")

    # 割り当て済みROIだけ推論
    roi_dicts = [{s: getattr(r, s) for s in r.__slots__} for r in p.rois if r.model_name]
    if not roi_dicts:
        raise HTTPException(400, "モデルが割り当てられたROIがありません")

    # 必要なモデルをロード
    models_dir = product_manager.models_dir(product_id)
    for rd in roi_dicts:
        mn = rd["model_name"]
        if mn not in model_manager.get_loaded_models():
            model_manager.load(
                mn,
                os.path.join(models_dir, f"{mn}.keras"),
                os.path.join(models_dir, f"{mn}_meta.json"),
            )

    results = await asyncio.get_event_loop().run_in_executor(
        None, model_manager.predict_rois, frame, roi_dicts)
    return {"results": results}


@router.get("/model/status")
async def model_status():
    from backend.inference import model_manager
    return model_manager.get_status()


# ─── 学習 ────────────────────────────────────────────────

class TrainingParams(BaseModel):
    model_name: str = "model_v1"
    roi_id: str | None = None
    epochs: int = config.DEFAULT_EPOCHS
    learning_rate: float = config.DEFAULT_LEARNING_RATE
    batch_size: int = config.DEFAULT_BATCH_SIZE
    validation_split: float = config.DEFAULT_VALIDATION_SPLIT
    image_size: int = config.DEFAULT_IMAGE_SIZE
    freeze_base: bool = True
    augmentation: dict | bool = True


@router.post("/products/{product_id}/training/start")
async def start_training(product_id: str, params: TrainingParams):
    from backend.training import trainer
    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    if trainer.is_running():
        raise HTTPException(400, "学習は既に実行中です")
    trainer.start(product_id, params.model_dump())
    return {"message": "学習を開始しました", "params": params.model_dump()}


class BatchTrainingParams(BaseModel):
    epochs: int = config.DEFAULT_EPOCHS
    learning_rate: float = config.DEFAULT_LEARNING_RATE
    batch_size: int = config.DEFAULT_BATCH_SIZE
    validation_split: float = config.DEFAULT_VALIDATION_SPLIT
    image_size: int = config.DEFAULT_IMAGE_SIZE
    freeze_base: bool = True
    augmentation: dict | bool = True


@router.post("/products/{product_id}/training/start-batch")
async def start_batch_training(product_id: str, params: BatchTrainingParams):
    """全ROIを順次学習する。各ROIのモデル名はROI名から自動生成。"""
    from backend.training import trainer
    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    if trainer.is_running():
        raise HTTPException(400, "学習は既に実行中です")
    if not p.rois:
        raise HTTPException(400, "ROIが定義されていません")

    # データセットが存在するROIのみ対象
    base_ds = product_manager.datasets_dir(product_id)
    roi_jobs = []
    for roi in p.rois:
        roi_ds = os.path.join(base_ds, roi.id)
        if not os.path.isdir(roi_ds):
            continue
        class_dirs = [d for d in os.listdir(roi_ds)
                      if os.path.isdir(os.path.join(roi_ds, d))]
        if len(class_dirs) >= 2:
            roi_jobs.append({
                "roi_id": roi.id,
                "roi_name": roi.name,
                "model_name": roi.name,
            })

    if not roi_jobs:
        raise HTTPException(400, "学習可能なROIがありません（各ROIに2クラス以上必要）")

    trainer.start_batch(product_id, roi_jobs, params.model_dump())
    return {
        "message": f"{len(roi_jobs)} ROIの一括学習を開始しました",
        "roi_jobs": roi_jobs,
    }


class AugPreviewRequest(BaseModel):
    augmentation: dict = {}
    image_size: int = config.DEFAULT_IMAGE_SIZE
    roi_id: str | None = None
    count: int = 6


@router.post("/products/{product_id}/augmentation/preview")
async def augmentation_preview(product_id: str, req: AugPreviewRequest):
    """データセットからランダムに1枚選び、拡張を適用したサンプル画像を返す。"""
    import tensorflow as tf
    import numpy as np
    import cv2
    import base64
    import random
    from backend.training import _build_augmentation_layers

    base_ds = product_manager.datasets_dir(product_id)
    dataset_dir = os.path.join(base_ds, req.roi_id) if req.roi_id else base_ds

    if not os.path.isdir(dataset_dir):
        raise HTTPException(404, "データセットが見つかりません")

    # 全画像をフラットに収集（ROI未選択時はROI配下も探索）
    all_images = []
    def _collect(d):
        for entry in os.listdir(d):
            p = os.path.join(d, entry)
            if os.path.isfile(p) and entry.lower().endswith((".jpg", ".jpeg", ".png")):
                all_images.append(p)
            elif os.path.isdir(p):
                _collect(p)
    _collect(dataset_dir)

    if not all_images:
        raise HTTPException(400, "画像がありません")

    src_path = random.choice(all_images)
    src_img = cv2.imread(src_path)
    if src_img is None:
        raise HTTPException(500, "画像の読み込みに失敗しました")
    src_img = cv2.cvtColor(src_img, cv2.COLOR_BGR2RGB)
    src_img = cv2.resize(src_img, (req.image_size, req.image_size))

    # 元画像を base64 エンコード
    _, buf = cv2.imencode(".jpg", cv2.cvtColor(src_img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
    original_b64 = base64.b64encode(buf).decode()

    # 拡張レイヤーを構築
    aug_layers = _build_augmentation_layers(tf, req.augmentation)
    if not aug_layers:
        return {"original": original_b64, "samples": [original_b64] * req.count}

    aug_model = tf.keras.Sequential(aug_layers)

    samples = []
    img_tensor = tf.constant(src_img, dtype=tf.float32)
    img_batch = tf.expand_dims(img_tensor, 0)

    for _ in range(req.count):
        augmented = aug_model(img_batch, training=True)
        aug_np = tf.clip_by_value(augmented[0], 0, 255).numpy().astype(np.uint8)
        _, buf = cv2.imencode(".jpg", cv2.cvtColor(aug_np, cv2.COLOR_RGB2BGR),
                              [cv2.IMWRITE_JPEG_QUALITY, 90])
        samples.append(base64.b64encode(buf).decode())

    return {"original": original_b64, "samples": samples}


@router.post("/training/stop")
async def stop_training():
    from backend.training import trainer
    trainer.stop()
    return {"message": "学習停止をリクエストしました"}


@router.get("/training/status")
async def training_status():
    from backend.training import trainer
    return trainer.get_status()


# ─── 検査 ────────────────────────────────────────────────

class InspectionStart(BaseModel):
    product_id: str


@router.post("/inspection/start")
async def start_inspection(data: InspectionStart):
    from backend.routes.ws import start_inspection as ws_start
    from backend.inference import model_manager
    from backend.state_machine import state_machine

    p = product_manager.get(data.product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")

    # この製品の設定でステートマシンを初期化
    state_machine.setup_product(
        p.inspection_config,
        product_manager.counter_file(data.product_id),
    )

    # ROIに必要なモデルを読み込み
    for roi in p.rois:
        if roi.model_name and roi.model_name not in model_manager.get_loaded_models():
            model_path = os.path.join(
                product_manager.models_dir(data.product_id),
                f"{roi.model_name}.keras",
            )
            meta_path = os.path.join(
                product_manager.models_dir(data.product_id),
                f"{roi.model_name}_meta.json",
            )
            if os.path.exists(model_path):
                model_manager.load(roi.model_name, model_path, meta_path)

    ws_start(data.product_id, model_manager, state_machine)
    return {"active": True, "product_id": data.product_id}


@router.post("/inspection/stop")
async def stop_inspection():
    from backend.routes.ws import stop_inspection as ws_stop
    from backend.state_machine import state_machine
    ws_stop()
    state_machine.reset()
    return {"active": False}


@router.get("/inspection/status")
async def inspection_status():
    from backend.routes.ws import get_inspection_status
    return get_inspection_status()


# ─── 製品設定・カウンター ─────────────────────────────────

@router.get("/products/{product_id}/config")
async def get_product_config(product_id: str):
    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    return p.inspection_config


class InspectionConfig(BaseModel):
    match_threshold: float | None = None
    trigger_frames: int | None = None
    removal_threshold: float | None = None
    removal_frames: int | None = None
    judged_display_ms: int | None = None
    trigger_mode: str | None = None
    presence_threshold: float | None = None
    stability_threshold: float | None = None
    stability_frames: int | None = None
    removal_diff_threshold: float | None = None


@router.put("/products/{product_id}/config")
async def update_product_config(product_id: str, cfg: InspectionConfig):
    from backend.state_machine import state_machine
    p = product_manager.get(product_id)
    if not p:
        raise HTTPException(404, "製品が見つかりません")
    updates = {k: v for k, v in cfg.model_dump().items() if v is not None}
    # 製品の保存設定を更新
    new_config = {**p.inspection_config, **updates}
    product_manager.update(product_id, inspection_config=new_config)
    # この製品がアクティブならライブのステートマシンも更新
    state_machine.update_config(updates)
    return {"message": "設定を更新しました"}


@router.get("/products/{product_id}/counters")
async def get_counters(product_id: str):
    from backend.state_machine import state_machine
    from backend.routes.ws import get_inspection_status
    status = get_inspection_status()
    if status.get("product_id") == product_id and status.get("active"):
        return state_machine.get_counters()
    # アクティブでない場合はファイルから読み込み
    counter_file = product_manager.counter_file(product_id)
    if os.path.exists(counter_file):
        with open(counter_file, "r") as f:
            return json.load(f)
    return {"total": 0, "ok": 0, "ng": 0}


@router.post("/products/{product_id}/counters/reset")
async def reset_counters(product_id: str):
    from backend.state_machine import state_machine
    from backend.routes.ws import get_inspection_status
    status = get_inspection_status()
    if status.get("product_id") == product_id and status.get("active"):
        state_machine.reset_counters()
    else:
        counter_file = product_manager.counter_file(product_id)
        os.makedirs(os.path.dirname(counter_file), exist_ok=True)
        with open(counter_file, "w") as f:
            json.dump({"total": 0, "ok": 0, "ng": 0}, f)
    return {"message": "カウンターをリセットしました", "total": 0, "ok": 0, "ng": 0}


# ─── フォルダをExplorerで開く ─────────────────────────────

@router.get("/open-folder/{folder_type}")
async def open_folder(folder_type: str, product_id: str | None = None):
    """データセットまたはモデルフォルダをエクスプローラーで開く。"""
    import subprocess
    if folder_type == "datasets" and product_id:
        path = product_manager.datasets_dir(product_id)
    elif folder_type == "models" and product_id:
        path = product_manager.models_dir(product_id)
    elif folder_type == "products":
        path = config.PRODUCTS_DIR
    else:
        raise HTTPException(400, f"不明なフォルダ種別: {folder_type}")

    os.makedirs(path, exist_ok=True)
    subprocess.Popen(["explorer", os.path.normpath(path)])
    return {"path": path}


# ─── パス情報 ─────────────────────────────────────────────

@router.get("/paths")
async def get_paths():
    return {
        "products": os.path.normpath(config.PRODUCTS_DIR),
        "base": os.path.normpath(config.BASE_DIR),
    }
