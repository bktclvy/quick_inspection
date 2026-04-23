"""製品管理 — ROI、テンプレート、データセット、モデルを束ねる。"""
import os
import re
import json
import uuid
import time
import threading
import numpy as np
import cv2
import send2trash
import config

ROI_COLORS = ["#2563eb", "#e11d48", "#16a34a", "#d97706", "#7c3aed", "#0891b2"]

# Windows で禁止された文字（NTFS / FAT 共通）と制御文字
_INVALID_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED = (
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


def _safe_folder_name(name: str, fallback: str) -> str:
    """ユーザー入力の名前を Windows で安全なフォルダ名に変換する。
    - 禁止文字 / 制御文字は `_` に置換
    - 前後の空白・ドットを除去
    - 連続する `_` は1つに圧縮
    - 空になったら fallback
    - Windows 予約名に一致したら末尾に `_` を付ける
    - 40文字で切り詰め
    日本語等の Unicode はそのまま保持する（project は非ASCIIパス対応済み）。"""
    s = _INVALID_CHARS_RE.sub("_", (name or "").strip())
    s = s.strip(" .")
    s = re.sub(r"_+", "_", s)
    if not s:
        s = fallback
    if s.upper() in _WINDOWS_RESERVED:
        s = s + "_"
    return s[:40]


def _unique_folder_name(base: str, existing: set[str]) -> str:
    """同階層の既存フォルダ名と衝突しない名前を返す。衝突時は _2, _3, ... を付与。"""
    if base not in existing:
        return base
    for i in range(2, 1000):
        cand = f"{base}_{i}"
        if cand not in existing:
            return cand
    return f"{base}_{int(time.time())}"


# cv2.imread/imwrite は非ASCIIパス（日本語ユーザー名等）で失敗するため numpy 経由で処理
def _imread(path: str, flags: int = cv2.IMREAD_COLOR) -> np.ndarray | None:
    try:
        buf = np.fromfile(path, dtype=np.uint8)
        return cv2.imdecode(buf, flags)
    except Exception:
        return None


def _imwrite(path: str, img: np.ndarray, params: list | None = None) -> bool:
    try:
        ext = os.path.splitext(path)[1]
        result, buf = cv2.imencode(ext, img, params or [])
        if result:
            buf.tofile(path)
            return True
        return False
    except Exception:
        return False


# 照明変化耐性のためのヒストグラム均一化
_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

def _normalize_gray(gray: np.ndarray) -> np.ndarray:
    """CLAHE適用で明るさ・コントラストを正規化。"""
    return _clahe.apply(gray)


def _safe_delete(path: str, base_dir: str):
    """base_dir 配下のパスのみ削除を許可。ゴミ箱に送る。"""
    abs_path = os.path.abspath(path)
    abs_base = os.path.abspath(base_dir)
    if not abs_path.startswith(abs_base + os.sep):
        raise ValueError(f"安全でないパスの削除を拒否: {abs_path}")
    if os.path.exists(abs_path):
        send2trash.send2trash(abs_path)


class ROIDefinition:
    __slots__ = ("id", "name", "x", "y", "w", "h", "model_name", "color", "folder_name")

    def __init__(self, id: str, name: str, x: float, y: float, w: float, h: float,
                 model_name: str | None = None, color: str = "#2563eb",
                 folder_name: str | None = None):
        self.id = id
        self.name = name
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.model_name = model_name
        self.color = color
        # folder_name が空なら id を使う（旧データ互換）
        self.folder_name = folder_name or id

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
                 trigger_region: dict | None = None,
                 trigger_search_region: dict | None = None,
                 inspection_config: dict | None = None,
                 created_at: str = "", updated_at: str = "",
                 folder_name: str | None = None, **kwargs):
        self.id = id
        self.name = name
        self.description = description
        # folder_name が空なら id を使う（旧データ互換）
        self.folder_name = folder_name or id
        self.rois = rois or []
        # トリガー領域
        # trigger_region: テンプレート矩形（マッチ対象）
        # trigger_search_region: 検索エリア（この中をスキャン）
        self.trigger_region = trigger_region
        self.trigger_search_region = trigger_search_region
        self.inspection_config = inspection_config or {
            "match_threshold": config.MATCH_THRESHOLD,
            "trigger_frames": config.TRIGGER_FRAMES,
            "judged_display_ms": config.JUDGED_DISPLAY_MS,
            "stability_threshold": config.STABILITY_THRESHOLD,
            "stability_frames": config.STABILITY_FRAMES,
        }
        self.created_at = created_at or time.strftime("%Y-%m-%d %H:%M:%S")
        self.updated_at = updated_at or self.created_at

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "folder_name": self.folder_name,
            "rois": [r.to_dict() for r in self.rois],
            "trigger_region": self.trigger_region,
            "trigger_search_region": self.trigger_search_region,
            "inspection_config": self.inspection_config,
            "created_at": self.created_at, "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Product":
        rois = [ROIDefinition.from_dict(r) for r in d.get("rois", [])]
        return cls(id=d["id"], name=d["name"], description=d.get("description", ""),
                   rois=rois, trigger_region=d.get("trigger_region"),
                   trigger_search_region=d.get("trigger_search_region"),
                   inspection_config=d.get("inspection_config"),
                   created_at=d.get("created_at", ""), updated_at=d.get("updated_at", ""),
                   folder_name=d.get("folder_name"))

    def get_roi(self, roi_id: str) -> ROIDefinition | None:
        for r in self.rois:
            if r.id == roi_id:
                return r
        return None

    def crop_trigger_region(self, frame: np.ndarray, margin: float = 0.0):
        """トリガー領域をフレームからクロップ。marginで拡大可能。"""
        if not self.trigger_region:
            return None
        tr = self.trigger_region
        h, w = frame.shape[:2]
        mx = tr["w"] * margin
        my = tr["h"] * margin
        x1 = max(0, int((tr["x"] - mx) * w))
        y1 = max(0, int((tr["y"] - my) * h))
        x2 = min(w, int((tr["x"] + tr["w"] + mx) * w))
        y2 = min(h, int((tr["y"] + tr["h"] + my) * h))
        crop = frame[y1:y2, x1:x2]
        return crop if crop.size > 0 else None


class ProductManager:
    def __init__(self, products_dir: str):
        self._dir = products_dir
        self._lock = threading.Lock()
        self._products: dict[str, Product] = {}
        self._templates: dict[str, dict[str, list[np.ndarray]]] = {}  # product_id -> {roi_id -> [画像リスト]}
        self._trigger_templates: dict[str, list[np.ndarray]] = {}   # product_id -> [トリガーテンプレート]
        self._backgrounds: dict[str, np.ndarray] = {}               # product_id -> グレースケール背景画像
        os.makedirs(self._dir, exist_ok=True)
        self._load_all()
        self._migrate_legacy_folders()

    # ── 永続化 ────────────────────────────────────────────

    def _product_dir(self, product_id: str) -> str:
        p = self._products.get(product_id)
        if p and p.folder_name:
            return os.path.join(self._dir, p.folder_name)
        # フォールバック: ID をそのままフォルダ名として使う（新規作成直前・旧データ用）
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

    def background_path(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "background.jpg")

    # ── ROI フォルダ名解決 ──────────────────────────────
    def _roi_folder(self, product_id: str, roi_id: str) -> str:
        """roi_id から実際のフォルダ名（folder_name）を引く。見つからなければ roi_id を返す。"""
        p = self._products.get(product_id)
        if not p:
            return roi_id
        roi = p.get_roi(roi_id)
        if not roi:
            return roi_id
        return roi.folder_name or roi.id

    def roi_templates_dir(self, product_id: str, roi_id: str) -> str:
        return os.path.join(self.templates_dir(product_id), self._roi_folder(product_id, roi_id))

    def roi_datasets_dir(self, product_id: str, roi_id: str) -> str:
        return os.path.join(self.datasets_dir(product_id), self._roi_folder(product_id, roi_id))

    def roi_folder_names(self, product_id: str) -> set[str]:
        """datasets/ 配下で「ROI専用サブフォルダ」と判定すべき名前の集合。クラス名と区別するために使う。"""
        p = self._products.get(product_id)
        if not p:
            return set()
        names: set[str] = set()
        for r in p.rois:
            if r.folder_name:
                names.add(r.folder_name)
            names.add(r.id)  # 旧データ互換
        return names

    def _load_all(self):
        if not os.path.isdir(self._dir):
            return
        for name in os.listdir(self._dir):
            json_path = os.path.join(self._dir, name, "product.json")
            if os.path.isfile(json_path):
                try:
                    with open(json_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    # folder_name が未設定 (旧データ) は実ディレクトリ名で埋める
                    if not data.get("folder_name"):
                        data["folder_name"] = name
                    p = Product.from_dict(data)
                    self._products[p.id] = p
                    self._load_templates(p.id)
                    self._load_trigger_templates(p.id)
                    self._load_background(p.id)
                except (json.JSONDecodeError, KeyError):
                    pass

    def _migrate_legacy_folders(self):
        """起動時マイグレーション: UUID ベースの旧フォルダ名を name 由来の人間可読名にリネームする。
        失敗時はログのみ出して旧名のまま稼働継続。"""
        # 製品フォルダ
        for pid, p in list(self._products.items()):
            current = p.folder_name
            fallback = pid[5:] if pid.startswith("prod_") else pid
            desired = _safe_folder_name(p.name, fallback=fallback)
            peers = {q.folder_name for q in self._products.values() if q.id != pid and q.folder_name}
            desired = _unique_folder_name(desired, peers)
            if current == desired:
                continue
            old_path = os.path.join(self._dir, current)
            new_path = os.path.join(self._dir, desired)
            if not os.path.isdir(old_path) or os.path.exists(new_path):
                continue
            try:
                os.rename(old_path, new_path)
                p.folder_name = desired
                self._save_product(p)
                print(f"[migrate] product folder: {current} -> {desired}")
            except OSError as e:
                print(f"[migrate] WARN: failed to rename product {current}: {e}")

        # ROI フォルダ (templates/ と datasets/ 内)
        for pid, p in self._products.items():
            updated = False
            for roi in p.rois:
                current = roi.folder_name
                fallback = roi.id[4:] if roi.id.startswith("roi_") else roi.id
                desired = _safe_folder_name(roi.name, fallback=fallback)
                peers = {r.folder_name for r in p.rois if r.id != roi.id and r.folder_name}
                desired = _unique_folder_name(desired, peers)
                if current == desired:
                    continue
                rename_failed = False
                for sub in ("templates", "datasets"):
                    sub_dir = os.path.join(self._product_dir(pid), sub)
                    old_path = os.path.join(sub_dir, current)
                    new_path = os.path.join(sub_dir, desired)
                    if not os.path.isdir(old_path):
                        continue  # 何もない、リネーム不要
                    if os.path.exists(new_path):
                        continue  # 新名のフォルダが既にある、衝突回避のためスキップ
                    try:
                        os.rename(old_path, new_path)
                        print(f"[migrate] ROI folder: {sub}/{current} -> {sub}/{desired}")
                    except OSError as e:
                        rename_failed = True
                        print(f"[migrate] WARN: failed to rename ROI {sub}/{current}: {e}")
                # 既存フォルダが無くても / 全て成功すれば、folder_name を新名に更新
                if not rename_failed:
                    roi.folder_name = desired
                    updated = True
            if updated:
                self._save_product(p)

    def _load_templates(self, product_id: str):
        """テンプレートを読み込む。ROIごとにサブディレクトリまたは単一ファイル。
        新形式: templates/{roi_folder}/001.jpg, 002.jpg, ...
        旧形式: templates/{roi_id}.jpg（互換用、リスト[1枚]として扱う）
        内部辞書のキーは常に roi.id を使う。フォルダ名は folder_name。"""
        tpl_dir = self.templates_dir(product_id)
        if not os.path.isdir(tpl_dir):
            return
        self._templates.setdefault(product_id, {})
        # folder_name または id → roi_id のマップ（旧データ互換）
        p = self._products.get(product_id)
        folder_to_id: dict[str, str] = {}
        if p:
            for roi in p.rois:
                if roi.folder_name:
                    folder_to_id[roi.folder_name] = roi.id
                folder_to_id[roi.id] = roi.id
        for entry in os.listdir(tpl_dir):
            entry_path = os.path.join(tpl_dir, entry)
            if os.path.isdir(entry_path):
                roi_id = folder_to_id.get(entry, entry)
                imgs = []
                for f in sorted(os.listdir(entry_path)):
                    if f.endswith(".jpg"):
                        img = _imread(os.path.join(entry_path, f), cv2.IMREAD_GRAYSCALE)
                        if img is not None:
                            imgs.append(img)
                if imgs:
                    self._templates[product_id][roi_id] = imgs
            elif entry.endswith(".jpg"):
                # 旧形式: 単一ファイル → リスト化
                roi_id = entry[:-4]
                if roi_id not in self._templates.get(product_id, {}):
                    img = _imread(entry_path, cv2.IMREAD_GRAYSCALE)
                    if img is not None:
                        self._templates[product_id][roi_id] = [img]

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
        # ROIごとのテンプレート情報を付与
        tpls = self._templates.get(product_id, {})
        for roi in d["rois"]:
            roi_tpls = tpls.get(roi["id"], [])
            roi["has_template"] = len(roi_tpls) > 0
            roi["template_count"] = len(roi_tpls)
        d["trigger_template_count"] = self.get_trigger_template_count(product_id)
        return d

    def create(self, name: str, description: str = "") -> dict:
        with self._lock:
            pid = f"prod_{uuid.uuid4().hex[:8]}"
            # フォルダ名は name をサニタイズ + 既存製品との衝突回避
            folder = _safe_folder_name(name, fallback=pid[5:])
            peers = {q.folder_name for q in self._products.values() if q.folder_name}
            folder = _unique_folder_name(folder, peers)
            p = Product(id=pid, name=name, description=description, folder_name=folder)
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
            for k in ("name", "description", "inspection_config", "trigger_region", "trigger_search_region"):
                if k in kwargs:
                    setattr(p, k, kwargs[k])
            p.updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
            self._save_product(p)
            return p.to_dict()

    def delete(self, product_id: str) -> bool:
        with self._lock:
            if product_id not in self._products:
                return False
            # folder_name 解決が self._products に依存するので、削除前にパスを確定
            pdir = self._product_dir(product_id)
            del self._products[product_id]
            self._templates.pop(product_id, None)
            _safe_delete(pdir, self._dir)
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
            folder = _safe_folder_name(name, fallback=roi_id[4:])
            peers = {r.folder_name for r in p.rois if r.folder_name}
            folder = _unique_folder_name(folder, peers)
            roi = ROIDefinition(id=roi_id, name=name, x=x, y=y, w=w, h=h,
                                color=color, folder_name=folder)
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
                    # 削除前にパスを確定（_roi_folder が self._products に依存）
                    roi_tpl_dir = self.roi_templates_dir(product_id, roi_id)
                    legacy_tpl = os.path.join(self.templates_dir(product_id), f"{roi_id}.jpg")
                    p.rois.pop(i)
                    # テンプレートも削除
                    if product_id in self._templates:
                        self._templates[product_id].pop(roi_id, None)
                    if os.path.isdir(roi_tpl_dir):
                        try:
                            _safe_delete(roi_tpl_dir, self._dir)
                        except Exception:
                            pass
                    if os.path.exists(legacy_tpl):
                        os.remove(legacy_tpl)
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
        """現在のフレームからROIのテンプレートを追加登録する（複数登録可能）。"""
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
            gray = _normalize_gray(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))

            # メモリに追加
            self._templates.setdefault(product_id, {})
            if roi_id not in self._templates[product_id]:
                self._templates[product_id][roi_id] = []
            self._templates[product_id][roi_id].append(gray)

            # ディスクに保存
            roi_tpl_dir = self.roi_templates_dir(product_id, roi_id)
            os.makedirs(roi_tpl_dir, exist_ok=True)
            idx = len(os.listdir(roi_tpl_dir)) + 1
            _imwrite(os.path.join(roi_tpl_dir, f"{idx:03d}.jpg"), gray)
            return True

    def delete_template(self, product_id: str, roi_id: str, index: int) -> bool:
        """指定インデックスのテンプレートを削除する。"""
        with self._lock:
            tpls = self._templates.get(product_id, {}).get(roi_id, [])
            if index < 0 or index >= len(tpls):
                return False
            tpls.pop(index)
            # ディスク上のファイルを全部書き直し
            roi_tpl_dir = self.roi_templates_dir(product_id, roi_id)
            _safe_delete(roi_tpl_dir, self._dir)
            os.makedirs(roi_tpl_dir, exist_ok=True)
            for i, img in enumerate(tpls):
                _imwrite(os.path.join(roi_tpl_dir, f"{i + 1:03d}.jpg"), img)
            return True

    def get_template_count(self, product_id: str, roi_id: str) -> int:
        """登録済みテンプレート数を返す。"""
        return len(self._templates.get(product_id, {}).get(roi_id, []))

    def get_template_path(self, product_id: str, roi_id: str, index: int = 0) -> str | None:
        """テンプレート画像のパスを返す。indexで複数対応。"""
        # 新形式
        roi_tpl_dir = self.roi_templates_dir(product_id, roi_id)
        if os.path.isdir(roi_tpl_dir):
            files = sorted(f for f in os.listdir(roi_tpl_dir) if f.endswith(".jpg"))
            if 0 <= index < len(files):
                return os.path.join(roi_tpl_dir, files[index])
        # 旧形式
        if index == 0:
            old_path = os.path.join(self.templates_dir(product_id), f"{roi_id}.jpg")
            if os.path.exists(old_path):
                return old_path
        return None

    def match_score(self, product_id: str, roi_id: str, frame: np.ndarray) -> float | None:
        """ROIのテンプレートマッチスコアを算出する。複数テンプレートの最大値。"""
        templates = self._templates.get(product_id, {}).get(roi_id, [])
        if not templates:
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
        gray = _normalize_gray(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))

        best = 0.0
        for template in templates:
            g = gray
            if g.shape != template.shape:
                g = cv2.resize(g, (template.shape[1], template.shape[0]))
            result = cv2.matchTemplate(g, template, cv2.TM_CCOEFF_NORMED)
            best = max(best, float(result[0][0]))
        return max(0.0, best)

    def match_score_enlarged(self, product_id: str, roi_id: str,
                             frame: np.ndarray, margin: float = 0.10) -> float | None:
        """ROIテンプレート（複数対応）を margin 分拡大した領域内でスライディングウィンドウ検索し、
        全テンプレート中の最大マッチスコアを返す。製品設置検知用。"""
        templates = self._templates.get(product_id, {}).get(roi_id, [])
        if not templates:
            return None
        p = self._products.get(product_id)
        if not p:
            return None
        roi = p.get_roi(roi_id)
        if not roi:
            return None

        fh, fw = frame.shape[:2]
        mx = roi.w * margin
        my = roi.h * margin
        x1 = max(0, int((roi.x - mx) * fw))
        y1 = max(0, int((roi.y - my) * fh))
        x2 = min(fw, int((roi.x + roi.w + mx) * fw))
        y2 = min(fh, int((roi.y + roi.h + my) * fh))
        search_region = frame[y1:y2, x1:x2]
        if search_region.size == 0:
            return None

        gray = _normalize_gray(cv2.cvtColor(search_region, cv2.COLOR_BGR2GRAY))
        gh, gw = gray.shape[:2]

        best = 0.0
        for template in templates:
            th, tw = template.shape[:2]
            if th > gh or tw > gw:
                scale = min(gh / th, gw / tw) * 0.95
                tpl = cv2.resize(template, (int(tw * scale), int(th * scale)))
            else:
                tpl = template

            if tpl.shape[0] > gray.shape[0] or tpl.shape[1] > gray.shape[1]:
                continue

            result = cv2.matchTemplate(gray, tpl, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, _ = cv2.minMaxLoc(result)
            best = max(best, max_val)

        return max(0.0, float(best))

    # ── トリガーテンプレート ────────────────────────────────

    def _trigger_tpl_dir(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "trigger_templates")

    def _load_trigger_templates(self, product_id: str):
        tdir = self._trigger_tpl_dir(product_id)
        if not os.path.isdir(tdir):
            return
        imgs = []
        for f in sorted(os.listdir(tdir)):
            if f.endswith(".jpg"):
                img = _imread(os.path.join(tdir, f), cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    imgs.append(img)
        if imgs:
            self._trigger_templates[product_id] = imgs

    def capture_trigger_template(self, product_id: str, frame: np.ndarray,
                                 region: dict | None = None) -> bool:
        """トリガーテンプレートを追加登録する。
        region: {"x","y","w","h"} 正規化座標。指定するとそのエリアをクロップして保存。
        regionがNoneの場合はproductのtrigger_regionを使う。"""
        with self._lock:
            p = self._products.get(product_id)
            if not p:
                return False

            if region:
                # 直接指定された領域でクロップ
                h, w = frame.shape[:2]
                x1 = max(0, int(region["x"] * w))
                y1 = max(0, int(region["y"] * h))
                x2 = min(w, int((region["x"] + region["w"]) * w))
                y2 = min(h, int((region["y"] + region["h"]) * h))
                crop = frame[y1:y2, x1:x2]
                if crop.size == 0:
                    return False
                # trigger_regionも更新（最後に描画した矩形）
                p.trigger_region = region
                self._save_product(p)
            elif p.trigger_region:
                crop = p.crop_trigger_region(frame)
                if crop is None:
                    return False
            else:
                return False

            gray = _normalize_gray(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))

            self._trigger_templates.setdefault(product_id, [])
            self._trigger_templates[product_id].append(gray)

            # 領域情報もJSONで保存
            tdir = self._trigger_tpl_dir(product_id)
            os.makedirs(tdir, exist_ok=True)
            idx = len(os.listdir(tdir)) // 2 + 1  # .jpg + .json pairs
            _imwrite(os.path.join(tdir, f"{idx:03d}.jpg"), gray)
            with open(os.path.join(tdir, f"{idx:03d}.json"), "w") as f:
                json.dump(region or p.trigger_region, f)
            return True

    def delete_trigger_template(self, product_id: str, index: int) -> bool:
        with self._lock:
            tpls = self._trigger_templates.get(product_id, [])
            if index < 0 or index >= len(tpls):
                return False
            tpls.pop(index)
            tdir = self._trigger_tpl_dir(product_id)
            _safe_delete(tdir, self._dir)
            os.makedirs(tdir, exist_ok=True)
            for i, img in enumerate(tpls):
                _imwrite(os.path.join(tdir, f"{i + 1:03d}.jpg"), img)
            return True

    def get_trigger_template_count(self, product_id: str) -> int:
        return len(self._trigger_templates.get(product_id, []))

    def get_trigger_template_path(self, product_id: str, index: int = 0) -> str | None:
        tdir = self._trigger_tpl_dir(product_id)
        if not os.path.isdir(tdir):
            return None
        files = sorted(f for f in os.listdir(tdir) if f.endswith(".jpg"))
        if 0 <= index < len(files):
            return os.path.join(tdir, files[index])
        return None

    def trigger_match_score(self, product_id: str, frame: np.ndarray,
                            margin: float = 0.10) -> float | None:
        """トリガーテンプレートを検索エリア内でマッチングし、最大スコアを返す。
        trigger_search_region が設定されていればそのエリアを使用。
        なければ trigger_region を margin 分拡大して使用。"""
        templates = self._trigger_templates.get(product_id, [])
        if not templates:
            return None
        p = self._products.get(product_id)
        if not p:
            return None

        fh, fw = frame.shape[:2]

        # 検索エリアの決定
        if p.trigger_search_region:
            sr = p.trigger_search_region
            x1 = max(0, int(sr["x"] * fw))
            y1 = max(0, int(sr["y"] * fh))
            x2 = min(fw, int((sr["x"] + sr["w"]) * fw))
            y2 = min(fh, int((sr["y"] + sr["h"]) * fh))
        elif p.trigger_region:
            # フォールバック: trigger_region + margin
            tr = p.trigger_region
            mx, my = tr["w"] * margin, tr["h"] * margin
            x1 = max(0, int((tr["x"] - mx) * fw))
            y1 = max(0, int((tr["y"] - my) * fh))
            x2 = min(fw, int((tr["x"] + tr["w"] + mx) * fw))
            y2 = min(fh, int((tr["y"] + tr["h"] + my) * fh))
        else:
            return None

        search = frame[y1:y2, x1:x2]
        if search.size == 0:
            return None

        gray = _normalize_gray(cv2.cvtColor(search, cv2.COLOR_BGR2GRAY))
        gh, gw = gray.shape[:2]

        best = 0.0
        for tpl in templates:
            th, tw = tpl.shape[:2]
            if th > gh or tw > gw:
                scale = min(gh / th, gw / tw) * 0.95
                t = cv2.resize(tpl, (int(tw * scale), int(th * scale)))
            else:
                t = tpl
            if t.shape[0] > gray.shape[0] or t.shape[1] > gray.shape[1]:
                continue
            result = cv2.matchTemplate(gray, t, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, _ = cv2.minMaxLoc(result)
            best = max(best, max_val)

        return max(0.0, float(best))

    # ── 背景画像 ──────────────────────────────────────────

    def _load_background(self, product_id: str):
        bg_path = self.background_path(product_id)
        if os.path.isfile(bg_path):
            img = _imread(bg_path, cv2.IMREAD_GRAYSCALE)
            if img is not None:
                self._backgrounds[product_id] = img

    def capture_background(self, product_id: str, frame: np.ndarray) -> bool:
        """現在のフレームを背景参照画像として保存する。"""
        if product_id not in self._products:
            return False
        gray = _normalize_gray(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        bg_path = self.background_path(product_id)
        os.makedirs(os.path.dirname(bg_path), exist_ok=True)
        _imwrite(bg_path, gray)
        self._backgrounds[product_id] = gray
        return True

    def get_background(self, product_id: str) -> np.ndarray | None:
        return self._backgrounds.get(product_id)

    def has_background(self, product_id: str) -> bool:
        return product_id in self._backgrounds

    def background_diff(self, product_id: str, frame: np.ndarray) -> float | None:
        """フレーム全体と背景のピクセル平均差分値を返す (0-255)。"""
        bg = self._backgrounds.get(product_id)
        if bg is None:
            return None
        gray = _normalize_gray(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        if gray.shape != bg.shape:
            gray = cv2.resize(gray, (bg.shape[1], bg.shape[0]))
        diff = cv2.absdiff(gray, bg)
        return float(diff.mean())

    def background_match_score(self, product_id: str, frame: np.ndarray) -> float | None:
        """背景画像とのテンプレートマッチスコアを返す (0-1)。
        スコアが高い＝現在のフレームが背景に近い＝製品が取り出されている。"""
        bg = self._backgrounds.get(product_id)
        if bg is None:
            return None
        gray = _normalize_gray(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        if gray.shape != bg.shape:
            gray = cv2.resize(gray, (bg.shape[1], bg.shape[0]))
        result = cv2.matchTemplate(gray, bg, cv2.TM_CCOEFF_NORMED)
        return max(0.0, float(result[0][0]))

    def background_match_score_gray(self, product_id: str, raw_gray: np.ndarray) -> float | None:
        """background_match_score の高速版。cvtColor 済みの raw_gray を受け取る。
        NCC (0-1) を返す。高い = 背景に近い = 製品が取り出された。"""
        bg = self._backgrounds.get(product_id)
        if bg is None:
            return None
        gray = _normalize_gray(raw_gray)
        if gray.shape != bg.shape:
            gray = cv2.resize(gray, (bg.shape[1], bg.shape[0]))
        result = cv2.matchTemplate(gray, bg, cv2.TM_CCOEFF_NORMED)
        return max(0.0, float(result[0][0]))

    def trigger_match_score_gray(self, product_id: str, raw_gray: np.ndarray,
                                 margin: float = 0.10) -> float | None:
        """trigger_match_score の高速版。cvtColor 済みの raw_gray を受け取る。
        CLAHE は内部で検索領域にのみ適用（従来通り）。"""
        templates = self._trigger_templates.get(product_id, [])
        if not templates:
            return None
        p = self._products.get(product_id)
        if not p:
            return None

        fh, fw = raw_gray.shape[:2]
        if p.trigger_search_region:
            sr = p.trigger_search_region
            x1 = max(0, int(sr["x"] * fw))
            y1 = max(0, int(sr["y"] * fh))
            x2 = min(fw, int((sr["x"] + sr["w"]) * fw))
            y2 = min(fh, int((sr["y"] + sr["h"]) * fh))
        elif p.trigger_region:
            tr = p.trigger_region
            mx, my = tr["w"] * margin, tr["h"] * margin
            x1 = max(0, int((tr["x"] - mx) * fw))
            y1 = max(0, int((tr["y"] - my) * fh))
            x2 = min(fw, int((tr["x"] + tr["w"] + mx) * fw))
            y2 = min(fh, int((tr["y"] + tr["h"] + my) * fh))
        else:
            return None

        search = raw_gray[y1:y2, x1:x2]
        if search.size == 0:
            return None
        gray = _normalize_gray(search)
        gh, gw = gray.shape[:2]

        best = 0.0
        for tpl in templates:
            th, tw = tpl.shape[:2]
            if th > gh or tw > gw:
                scale = min(gh / th, gw / tw) * 0.95
                t = cv2.resize(tpl, (int(tw * scale), int(th * scale)))
            else:
                t = tpl
            if t.shape[0] > gray.shape[0] or t.shape[1] > gray.shape[1]:
                continue
            result = cv2.matchTemplate(gray, t, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, _ = cv2.minMaxLoc(result)
            best = max(best, max_val)
        return max(0.0, float(best))

    def background_mad_gray(self, product_id: str, raw_gray: np.ndarray) -> float | None:
        """cvtColor 済みの raw_gray と保存済み背景画像の MAD を返す (0-255)。
        低い = 背景に近い (= 製品が取り出された)。"""
        bg = self._backgrounds.get(product_id)
        if bg is None:
            return None
        gray = _normalize_gray(raw_gray)
        if gray.shape != bg.shape:
            gray = cv2.resize(gray, (bg.shape[1], bg.shape[0]))
        return float(cv2.absdiff(gray, bg).mean())

    # ── 検査ログ保存 ──────────────────────────────────────

    def inspection_log_dir(self, product_id: str) -> str:
        return os.path.join(self._product_dir(product_id), "inspection_log")

    def save_inspection_log(self, product_id: str, frame: np.ndarray,
                            result: dict) -> str | None:
        """検査フレームとメタデータを保存する。保存パスを返す。"""
        import datetime
        p = self._products.get(product_id)
        if not p:
            return None

        today = datetime.date.today().isoformat()
        log_dir = os.path.join(self.inspection_log_dir(product_id), today)
        os.makedirs(log_dir, exist_ok=True)

        # 連番を決定
        existing = [f for f in os.listdir(log_dir) if f.endswith('.jpg')]
        seq = len(existing) + 1

        judgment = result.get("overall_judgment", "UNKNOWN")
        timestamp = datetime.datetime.now().strftime("%H%M%S")
        base_name = f"{seq:04d}_{judgment}_{timestamp}"

        # 画像保存
        img_path = os.path.join(log_dir, f"{base_name}.jpg")
        _imwrite(img_path, frame)

        # メタデータ保存
        counters = result.get("counters", {})
        meta = {
            "timestamp": datetime.datetime.now().isoformat(),
            "product_id": product_id,
            "product_name": p.name,
            "overall_judgment": judgment,
            "overall_confidence": result.get("overall_confidence"),
            "roi_results": result.get("roi_results", []),
            "counters": counters,
            "box_number": counters.get("completed_boxes"),
            "box_progress": counters.get("current_box_progress"),
            "image_file": f"{base_name}.jpg",
        }
        meta_path = os.path.join(log_dir, f"{base_name}.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)

        return img_path

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
