"""製品管理 — ROI、テンプレート、データセット、モデルを束ねる。"""
import os
import json
import uuid
import time
import threading
import numpy as np
import cv2
import config

ROI_COLORS = ["#2563eb", "#e11d48", "#16a34a", "#d97706", "#7c3aed", "#0891b2"]


class ROIDefinition:
    __slots__ = ("id", "name", "x", "y", "w", "h", "model_name", "color")

    def __init__(self, id: str, name: str, x: float, y: float, w: float, h: float,
                 model_name: str | None = None, color: str = "#2563eb"):
        self.id = id
        self.name = name
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.model_name = model_name
        self.color = color

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}

    @classmethod
    def from_dict(cls, d: dict) -> "ROIDefinition":
        return cls(**{k: d.get(k) for k in cls.__slots__})

    def crop_frame(self, frame: np.ndarray) -> np.ndarray:
        """フレームをこのROIのピクセル座標でクロップする。"""
        h, w = frame.shape[:2]
        x1, y1 = max(0, int(self.x * w)), max(0, int(self.y * h))
        x2, y2 = min(w, int((self.x + self.w) * w)), min(h, int((self.y + self.h) * h))
        return frame[y1:y2, x1:x2]


class Product:
    def __init__(self, id: str, name: str, description: str = "",
                 rois: list[ROIDefinition] | None = None,
                 inspection_config: dict | None = None,
                 created_at: str = "", updated_at: str = ""):
        self.id = id
        self.name = name
        self.description = description
        self.rois = rois or []
        self.inspection_config = inspection_config or {
            "match_threshold": config.MATCH_THRESHOLD,
            "trigger_frames": config.TRIGGER_FRAMES,
            "removal_threshold": config.REMOVAL_THRESHOLD,
            "removal_frames": config.REMOVAL_FRAMES,
            "judged_display_ms": config.JUDGED_DISPLAY_MS,
            "trigger_mode": config.DEFAULT_TRIGGER_MODE,
        }
        self.created_at = created_at or time.strftime("%Y-%m-%d %H:%M:%S")
        self.updated_at = updated_at or self.created_at

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "rois": [r.to_dict() for r in self.rois],
            "inspection_config": self.inspection_config,
            "created_at": self.created_at, "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Product":
        rois = [ROIDefinition.from_dict(r) for r in d.get("rois", [])]
        return cls(id=d["id"], name=d["name"], description=d.get("description", ""),
                   rois=rois, inspection_config=d.get("inspection_config"),
                   created_at=d.get("created_at", ""), updated_at=d.get("updated_at", ""))

    def get_roi(self, roi_id: str) -> ROIDefinition | None:
        for r in self.rois:
            if r.id == roi_id:
                return r
        return None


class ProductManager:
    def __init__(self, products_dir: str):
        self._dir = products_dir
        self._lock = threading.Lock()
        self._products: dict[str, Product] = {}
        self._templates: dict[str, dict[str, np.ndarray]] = {}  # product_id -> {roi_id -> グレースケール画像}
        os.makedirs(self._dir, exist_ok=True)
        self._load_all()

    # ── 永続化 ────────────────────────────────────────────

    def _product_dir(self, product_id: str) -> str:
        return os.path.join(self._dir, product_id)

    def _product_json(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "product.json")

    def templates_dir(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "templates")

    def datasets_dir(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "datasets")

    def models_dir(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "models")

    def counter_file(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "counters.json")

    def _load_all(self):
        if not os.path.isdir(self._dir):
            return
        for name in os.listdir(self._dir):
            json_path = os.path.join(self._dir, name, "product.json")
            if os.path.isfile(json_path):
                try:
                    with open(json_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    p = Product.from_dict(data)
                    self._products[p.id] = p
                    self._load_templates(p.id)
                except (json.JSONDecodeError, KeyError):
                    pass

    def _load_templates(self, product_id: str):
        tpl_dir = self.templates_dir(product_id)
        if not os.path.isdir(tpl_dir):
            return
        self._templates.setdefault(product_id, {})
        for f in os.listdir(tpl_dir):
            if f.endswith(".jpg"):
                roi_id = f[:-4]
                img = cv2.imread(os.path.join(tpl_dir, f), cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    self._templates[product_id][roi_id] = img

    def _save_product(self, product: Product):
        pdir = self._product_dir(product.id)
        os.makedirs(pdir, exist_ok=True)
        with open(self._product_json(product.id), "w", encoding="utf-8") as f:
            json.dump(product.to_dict(), f, indent=2, ensure_ascii=False)

    # ── 製品 CRUD ─────────────────────────────────────────

    def get_all(self) -> list[dict]:
        with self._lock:
            result = []
            for p in self._products.values():
                d = p.to_dict()
                d["roi_count"] = len(p.rois)
                result.append(d)
            return sorted(result, key=lambda x: x["created_at"])

    def get(self, product_id: str) -> Product | None:
        return self._products.get(product_id)

    def get_dict(self, product_id: str) -> dict | None:
        p = self._products.get(product_id)
        if not p:
            return None
        d = p.to_dict()
        # ROIごとのテンプレート有無を付与
        tpls = self._templates.get(product_id, {})
        for roi in d["rois"]:
            roi["has_template"] = roi["id"] in tpls
        return d

    def create(self, name: str, description: str = "") -> dict:
        with self._lock:
            pid = f"prod_{uuid.uuid4().hex[:8]}"
            p = Product(id=pid, name=name, description=description)
            self._products[pid] = p
            # サブディレクトリ作成
            for sub in [self.templates_dir(pid), self.datasets_dir(pid), self.models_dir(pid)]:
                os.makedirs(sub, exist_ok=True)
            self._save_product(p)
            return p.to_dict()

    def update(self, product_id: str, **kwargs) -> dict | None:
        with self._lock:
            p = self._products.get(product_id)
            if not p:
                return None
            for k in ("name", "description", "inspection_config"):
                if k in kwargs and kwargs[k] is not None:
                    setattr(p, k, kwargs[k])
            p.updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
            self._save_product(p)
            return p.to_dict()

    def delete(self, product_id: str) -> bool:
        import shutil
        with self._lock:
            if product_id not in self._products:
                return False
            del self._products[product_id]
            self._templates.pop(product_id, None)
            pdir = self._product_dir(product_id)
            if os.path.isdir(pdir):
                shutil.rmtree(pdir)
            return True

    # ── ROI CRUD（製品内）────────────────────────────────

    def add_roi(self, product_id: str, name: str, x: float, y: float,
                w: float, h: float, color: str | None = None) -> dict | None:
        with self._lock:
            p = self._products.get(product_id)
            if not p:
                return None
            roi_id = f"roi_{uuid.uuid4().hex[:6]}"
            if color is None:
                color = ROI_COLORS[len(p.rois) % len(ROI_COLORS)]
            roi = ROIDefinition(id=roi_id, name=name, x=x, y=y, w=w, h=h, color=color)
            p.rois.append(roi)
            p.updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
            self._save_product(p)
            d = roi.to_dict()
            d["has_template"] = False
            return d

    def update_roi(self, product_id: str, roi_id: str, **kwargs) -> dict | None:
        with self._lock:
            p = self._products.get(product_id)
            if not p:
                return None
            roi = p.get_roi(roi_id)
            if not roi:
                return None
            for k, v in kwargs.items():
                if v is not None and hasattr(roi, k):
                    setattr(roi, k, v)
            p.updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
            self._save_product(p)
            d = roi.to_dict()
            tpls = self._templates.get(product_id, {})
            d["has_template"] = roi_id in tpls
            return d

    def delete_roi(self, product_id: str, roi_id: str) -> bool:
        with self._lock:
            p = self._products.get(product_id)
            if not p:
                return False
            for i, r in enumerate(p.rois):
                if r.id == roi_id:
                    p.rois.pop(i)
                    # テンプレートも削除
                    if product_id in self._templates:
                        self._templates[product_id].pop(roi_id, None)
                    tpl = os.path.join(self.templates_dir(product_id), f"{roi_id}.jpg")
                    if os.path.exists(tpl):
                        os.remove(tpl)
                    p.updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
                    self._save_product(p)
                    return True
            return False

    def assign_model(self, product_id: str, roi_id: str, model_name: str | None) -> bool:
        with self._lock:
            p = self._products.get(product_id)
            if not p:
                return False
            roi = p.get_roi(roi_id)
            if not roi:
                return False
            roi.model_name = model_name
            p.updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
            self._save_product(p)
            return True

    # ── テンプレート管理 ──────────────────────────────────

    def capture_template(self, product_id: str, roi_id: str, frame: np.ndarray) -> bool:
        """現在のフレームからROIの基準画像を撮影する。"""
        with self._lock:
            p = self._products.get(product_id)
            if not p:
                return False
            roi = p.get_roi(roi_id)
            if not roi:
                return False
            crop = roi.crop_frame(frame)
            if crop.size == 0:
                return False
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            self._templates.setdefault(product_id, {})[roi_id] = gray
            tpl_dir = self.templates_dir(product_id)
            os.makedirs(tpl_dir, exist_ok=True)
            cv2.imwrite(os.path.join(tpl_dir, f"{roi_id}.jpg"), gray)
            return True

    def get_template_path(self, product_id: str, roi_id: str) -> str | None:
        path = os.path.join(self.templates_dir(product_id), f"{roi_id}.jpg")
        return path if os.path.exists(path) else None

    def match_score(self, product_id: str, roi_id: str, frame: np.ndarray) -> float | None:
        """ROIのテンプレートマッチスコアを算出する。0〜1またはテンプレート未登録ならNone。"""
        tpls = self._templates.get(product_id, {})
        template = tpls.get(roi_id)
        if template is None:
            return None
        p = self._products.get(product_id)
        if not p:
            return None
        roi = p.get_roi(roi_id)
        if not roi:
            return None
        crop = roi.crop_frame(frame)
        if crop.size == 0:
            return None
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if gray.shape != template.shape:
            gray = cv2.resize(gray, (template.shape[1], template.shape[0]))
        result = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
        return max(0.0, float(result[0][0]))

    # ── モデル一覧 ────────────────────────────────────────

    def list_models(self, product_id: str) -> list[dict]:
        mdir = self.models_dir(product_id)
        if not os.path.isdir(mdir):
            return []
        models = []
        for f in sorted(os.listdir(mdir)):
            if f.endswith("_meta.json"):
                try:
                    with open(os.path.join(mdir, f), "r") as fh:
                        models.append(json.load(fh))
                except (json.JSONDecodeError, OSError):
                    pass
        return models


product_manager = ProductManager(config.PRODUCTS_DIR)
