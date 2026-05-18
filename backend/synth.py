"""AI トリガー専用「不安定」サンプルの自動合成。

既存のROI画像 (OK/NG) に障害物・遮蔽・ブラーを合成し、別建ての
AI トリガーモデル (judgment モデルとは独立) の学習用負例を生成する。

判定 (OK/NG) データセットには一切手を加えない。出力は
  products/<p>/trigger_data/<roi_folder>/unstable/synth_*.jpg
人手で追加した synth_ 以外のファイルは再生成時も保持される。
"""
import os
import json
import time
import random
import shutil
import numpy as np
import cv2

from backend.product import _imread, _imwrite, product_manager

SYNTH_PREFIX = "synth_"
META_FILENAME = ".synth_meta.json"
UNSTABLE_DIR = "unstable"  # サブフォルダ名

CAPTURES_DIR = "captures"
CAPTURE_STATES = ("present", "absent", "obstructed")


# ─── 個別エフェクト ────────────────────────────────────────

def _bg_patch(img: np.ndarray, bg: np.ndarray | None = None, **_) -> np.ndarray:
    """背景画像から切り出したパッチを楕円マスクで貼る (= 製品が部分的に隠れた状態)。"""
    if bg is None:
        return img
    h, w = img.shape[:2]
    bh, bw = bg.shape[:2]
    pw = min(bw, random.randint(int(w * 0.2), int(w * 0.55)))
    ph = min(bh, random.randint(int(h * 0.2), int(h * 0.55)))
    if pw <= 4 or ph <= 4:
        return img
    bx = random.randint(0, bw - pw)
    by = random.randint(0, bh - ph)
    patch = bg[by:by + ph, bx:bx + pw]
    if patch.ndim == 2:
        patch = cv2.cvtColor(patch, cv2.COLOR_GRAY2BGR)
    px = random.randint(0, max(0, w - pw))
    py = random.randint(0, max(0, h - ph))

    mask = np.zeros((ph, pw), dtype=np.float32)
    cv2.ellipse(mask, (pw // 2, ph // 2),
                (max(1, pw // 2 - 2), max(1, ph // 2 - 2)),
                0, 0, 360, 1.0, -1)
    k = max(3, (min(ph, pw) // 4) | 1)
    mask = cv2.GaussianBlur(mask, (k, k), 0)
    mask3 = np.stack([mask] * 3, axis=-1)

    out = img.copy()
    roi = out[py:py + ph, px:px + pw].astype(np.float32)
    blended = roi * (1.0 - mask3) + patch.astype(np.float32) * mask3
    out[py:py + ph, px:px + pw] = np.clip(blended, 0, 255).astype(np.uint8)
    return out


def _skin_blob(img: np.ndarray, **_) -> np.ndarray:
    """肌色の楕円ブロブをランダム位置に貼る (= 手映りの代理)。"""
    h, w = img.shape[:2]
    eh = random.randint(int(h * 0.15), int(h * 0.6))
    ew = random.randint(int(w * 0.15), int(w * 0.6))
    cx = random.randint(ew // 2, max(ew // 2 + 1, w - ew // 2))
    cy = random.randint(eh // 2, max(eh // 2 + 1, h - eh // 2))
    angle = random.randint(0, 180)

    skin_hsv = np.array([[[
        random.randint(5, 25),
        random.randint(40, 130),
        random.randint(100, 210),
    ]]], dtype=np.uint8)
    skin_bgr = cv2.cvtColor(skin_hsv, cv2.COLOR_HSV2BGR)[0, 0]
    color = (int(skin_bgr[0]), int(skin_bgr[1]), int(skin_bgr[2]))

    mask = np.zeros((h, w), dtype=np.float32)
    cv2.ellipse(mask, (cx, cy),
                (max(1, ew // 2), max(1, eh // 2)),
                angle, 0, 360, 1.0, -1)
    k = max(3, (min(eh, ew) // 4) | 1)
    mask = cv2.GaussianBlur(mask, (k, k), 0)
    mask3 = np.stack([mask] * 3, axis=-1)

    overlay = np.full_like(img, color, dtype=np.uint8)
    blended = img.astype(np.float32) * (1.0 - mask3) + overlay.astype(np.float32) * mask3
    return np.clip(blended, 0, 255).astype(np.uint8)


def _motion_blur(img: np.ndarray, **_) -> np.ndarray:
    """強いモーションブラー (= 動作中・不安定)。"""
    ksize = random.choice([15, 19, 23, 27])
    angle = random.uniform(0, 360)
    kernel = np.zeros((ksize, ksize), dtype=np.float32)
    kernel[ksize // 2, :] = 1.0
    M = cv2.getRotationMatrix2D((ksize / 2, ksize / 2), angle, 1.0)
    kernel = cv2.warpAffine(kernel, M, (ksize, ksize))
    s = kernel.sum()
    if s <= 1e-6:
        return img
    kernel /= s
    return cv2.filter2D(img, -1, kernel)


def _cutout(img: np.ndarray, **_) -> np.ndarray:
    """ランダム矩形を暗くする (= 強遮蔽・影)。"""
    h, w = img.shape[:2]
    rh = random.randint(int(h * 0.2), int(h * 0.55))
    rw = random.randint(int(w * 0.2), int(w * 0.55))
    rx = random.randint(0, max(0, w - rw))
    ry = random.randint(0, max(0, h - rh))
    darkness = random.uniform(0.0, 0.3)
    out = img.copy()
    region = out[ry:ry + rh, rx:rx + rw].astype(np.float32) * darkness
    out[ry:ry + rh, rx:rx + rw] = region.astype(np.uint8)
    return out


EFFECTS = {
    "bg_patch": _bg_patch,
    "skin_blob": _skin_blob,
    "motion_blur": _motion_blur,
    "cutout": _cutout,
}

DEFAULT_PATTERNS = ["bg_patch", "skin_blob", "motion_blur"]


# ─── データ操作ヘルパー ────────────────────────────────────

def _trigger_data_dir(product_id: str) -> str:
    """trigger_data/ ルート (製品スコープ)。"""
    return os.path.join(product_manager._product_dir(product_id), "trigger_data")


def get_unstable_dir(product_id: str, roi_id: str) -> str:
    """そのROIの unstable サンプル格納ディレクトリ。
    products/<p>/trigger_data/<roi_folder>/unstable/
    """
    folder = product_manager._roi_folder(product_id, roi_id)
    return os.path.join(_trigger_data_dir(product_id), folder, UNSTABLE_DIR)


# ─── 撮影画像 (ユーザーが手動で撮る trigger 学習用フレーム) ──

def get_captures_root(product_id: str) -> str:
    """trigger_data/captures/。状態別サブフォルダの親。"""
    return os.path.join(_trigger_data_dir(product_id), CAPTURES_DIR)


def get_capture_dir(product_id: str, state: str) -> str:
    """trigger_data/captures/<state>/ を返す。"""
    if state not in CAPTURE_STATES:
        raise ValueError(f"未知の撮影状態: {state}")
    return os.path.join(get_captures_root(product_id), state)


def record_capture(product_id: str, state: str, frame: np.ndarray) -> str:
    """フレームを 1 枚キャプチャとして保存する。
    保存先: trigger_data/captures/<state>/<連番>.jpg
    """
    if state not in CAPTURE_STATES:
        raise ValueError(f"未知の撮影状態: {state}")
    cdir = get_capture_dir(product_id, state)
    os.makedirs(cdir, exist_ok=True)
    existing = [f for f in os.listdir(cdir)
                if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    seq = len(existing) + 1
    path = os.path.join(cdir, f"{seq:04d}.jpg")
    _imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return path


def get_capture_counts(product_id: str) -> dict[str, int]:
    """各状態の撮影枚数を返す。"""
    counts: dict[str, int] = {}
    for state in CAPTURE_STATES:
        cdir = get_capture_dir(product_id, state)
        if os.path.isdir(cdir):
            counts[state] = len([
                f for f in os.listdir(cdir)
                if f.lower().endswith((".jpg", ".jpeg", ".png"))
            ])
        else:
            counts[state] = 0
    return counts


def list_capture_paths(product_id: str, state: str | None = None) -> list[str]:
    """撮影画像のパスを返す。state=None なら全状態。"""
    states = [state] if state else list(CAPTURE_STATES)
    paths: list[str] = []
    for s in states:
        if s not in CAPTURE_STATES:
            continue
        cdir = get_capture_dir(product_id, s)
        if not os.path.isdir(cdir):
            continue
        for f in sorted(os.listdir(cdir)):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(cdir, f))
    return paths


def clear_captures(product_id: str, state: str | None = None) -> int:
    """撮影画像を削除する。state=None なら全状態。削除枚数を返す。"""
    states = [state] if state else list(CAPTURE_STATES)
    deleted = 0
    for s in states:
        if s not in CAPTURE_STATES:
            continue
        cdir = get_capture_dir(product_id, s)
        if not os.path.isdir(cdir):
            continue
        for f in os.listdir(cdir):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                try:
                    os.remove(os.path.join(cdir, f))
                    deleted += 1
                except OSError:
                    pass
    return deleted


def _collect_source_images(product_id: str, roi_id: str) -> tuple[list[str], list[str]]:
    """そのROIの「製品が正常に映っている」画像パスを収集。
    judgment="ok" のクラスのみを採用する。NG クラスは内部に「製品なし」「手で隠れ」
    といった "uninspectable に近い" 画像が混入していることが多いため除外。

    Returns: (paths, warnings)
        paths    : present 教師として使える画像パスのリスト
        warnings : classes_meta.json が無い等のセットアップ問題に関する警告メッセージ
    """
    roi_ds = product_manager.roi_datasets_dir(product_id, roi_id)
    warnings: list[str] = []
    if not os.path.isdir(roi_ds):
        return [], warnings

    cm_path = os.path.join(roi_ds, "classes_meta.json")
    judgments: dict[str, str] = {}
    if os.path.exists(cm_path):
        try:
            with open(cm_path, "r", encoding="utf-8") as f:
                judgments = json.load(f) or {}
        except (json.JSONDecodeError, OSError):
            warnings.append("classes_meta.json の読み込みに失敗しました")
    else:
        warnings.append("classes_meta.json がありません (各クラスの ok/ng 設定が必要)")

    paths: list[str] = []
    used_classes: list[str] = []
    seen_classes: list[str] = []
    for cls in sorted(os.listdir(roi_ds)):
        cls_dir = os.path.join(roi_ds, cls)
        if not os.path.isdir(cls_dir):
            continue
        if cls.startswith("."):
            continue
        seen_classes.append(cls)
        # judgment が "ok" のクラスだけを present 教師として採用
        if judgments.get(cls) != "ok":
            continue
        used_classes.append(cls)
        for f in os.listdir(cls_dir):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(cls_dir, f))

    if seen_classes and not used_classes:
        warnings.append(
            "judgment='ok' のクラスが見つかりません (採用したクラス無し)。"
            "データセット画面で各クラスの ok/ng を確認してください。"
        )
    return paths, warnings


def migrate_legacy_unstable(product_id: str) -> int:
    """旧パス datasets/<roi>/unstable/ にあるファイルを trigger_data/<roi>/unstable/ に移動。
    classes_meta.json から unstable エントリも除去する。
    移動した画像枚数を返す (画像のみカウント)。
    """
    p = product_manager.get(product_id)
    if not p:
        return 0
    moved = 0
    for roi in p.rois:
        old_dir = os.path.join(product_manager.roi_datasets_dir(product_id, roi.id), UNSTABLE_DIR)
        if not os.path.isdir(old_dir):
            continue
        new_dir = get_unstable_dir(product_id, roi.id)
        os.makedirs(new_dir, exist_ok=True)
        for f in os.listdir(old_dir):
            src = os.path.join(old_dir, f)
            dst = os.path.join(new_dir, f)
            if os.path.exists(dst):
                continue
            try:
                shutil.move(src, dst)
                if f.lower().endswith((".jpg", ".jpeg", ".png")):
                    moved += 1
            except OSError:
                pass
        # 空なら旧ディレクトリ自体を削除
        try:
            if os.path.isdir(old_dir) and not os.listdir(old_dir):
                os.rmdir(old_dir)
        except OSError:
            pass
        # classes_meta.json から unstable を取り除く
        meta_path = os.path.join(product_manager.roi_datasets_dir(product_id, roi.id), "classes_meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    cm = json.load(f) or {}
                if "unstable" in cm:
                    cm.pop("unstable", None)
                    with open(meta_path, "w", encoding="utf-8") as f:
                        json.dump(cm, f, indent=2, ensure_ascii=False)
            except (json.JSONDecodeError, OSError):
                pass
    return moved


def _clear_synth_files(unstable_dir: str) -> None:
    if not os.path.isdir(unstable_dir):
        return
    for f in os.listdir(unstable_dir):
        if (f.startswith(SYNTH_PREFIX)
                and f.lower().endswith((".jpg", ".jpeg", ".png"))):
            try:
                os.remove(os.path.join(unstable_dir, f))
            except OSError:
                pass


def _bg_only_sample(bg: np.ndarray, roi_obj, ref_img: np.ndarray) -> np.ndarray | None:
    """純粋な「製品なし」サンプルを作る: 背景画像のROI範囲を切り出して軽い変動を加える。"""
    if bg is None:
        return None
    bh, bw = bg.shape[:2]
    if roi_obj is not None:
        rx1 = max(0, int(roi_obj.x * bw))
        ry1 = max(0, int(roi_obj.y * bh))
        rx2 = min(bw, int((roi_obj.x + roi_obj.w) * bw))
        ry2 = min(bh, int((roi_obj.y + roi_obj.h) * bh))
        base = bg[ry1:ry2, rx1:rx2]
    else:
        base = bg
    if base.size == 0:
        return None
    if base.ndim == 2:
        base = cv2.cvtColor(base, cv2.COLOR_GRAY2BGR)
    tgt_h, tgt_w = ref_img.shape[:2]
    base = cv2.resize(base, (tgt_w, tgt_h))

    shift_x = random.randint(-5, 5)
    shift_y = random.randint(-5, 5)
    M = np.float32([[1, 0, shift_x], [0, 1, shift_y]])
    out = cv2.warpAffine(base, M, (tgt_w, tgt_h), borderMode=cv2.BORDER_REPLICATE)

    delta = random.randint(-15, 15)
    out = np.clip(out.astype(np.int16) + delta, 0, 255).astype(np.uint8)

    noise = np.random.randint(-3, 4, out.shape, dtype=np.int16)
    out = np.clip(out.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return out


# ─── 公開 API ───────────────────────────────────────────────

def synthesize_unstable_for_roi(
    product_id: str,
    roi_id: str,
    patterns: list[str] | None = None,
    count_multiplier: float = 1.0,
) -> dict:
    """指定ROIで unstable サンプルを生成する。

    内訳 (背景画像あり時):
      30% OK/NG + 障害物         (synth_obs_*.jpg)    一部隠れた製品
      40% 背景のみ + 軽い変動    (synth_bg_*.jpg)     純粋な「製品なし」
      30% 背景 + 障害物          (synth_bgobs_*.jpg)  製品なし + 手映り等

    この 3 カテゴリで「製品が映っているか」と「障害物があるか」を独立した
    特徴として学べるようにする。背景未登録なら全部 OK/NG + 障害物にフォールバック
    (この場合「製品なし」を学習できないので errors に警告を入れる)。
    """
    patterns = list(patterns) if patterns else list(DEFAULT_PATTERNS)
    for p in patterns:
        if p not in EFFECTS:
            return {"generated": 0, "errors": [f"未知の合成パターン: {p}"]}

    sources, src_warnings = _collect_source_images(product_id, roi_id)
    if not sources:
        msg = "judgment='ok' のクラス画像がありません"
        if src_warnings:
            msg += " (" + " / ".join(src_warnings) + ")"
        return {"generated": 0, "errors": [msg]}

    bg = product_manager.get_background(product_id)
    target_count = max(10, int(len(sources) * count_multiplier))

    errors: list[str] = list(src_warnings)
    if bg is None:
        errors.append("警告: 背景画像が未登録です。「製品なし」状態を学習できません")
        n_obstructed = target_count
        n_bg_only = 0
        n_bg_obs = 0
    else:
        n_bg_only = int(target_count * 0.40)
        n_bg_obs = int(target_count * 0.30)
        n_obstructed = target_count - n_bg_only - n_bg_obs

    # 「背景の上に背景パッチ」は無意味なので、bg_obs カテゴリでは bg_patch を除外
    obstacle_only = [p for p in patterns if p != "bg_patch"]
    if not obstacle_only:
        # bg_patch だけ選ばれている場合のフォールバック
        obstacle_only = ["skin_blob", "motion_blur", "cutout"]

    unstable_dir = get_unstable_dir(product_id, roi_id)
    os.makedirs(unstable_dir, exist_ok=True)
    _clear_synth_files(unstable_dir)

    generated = 0
    p_obj = product_manager.get(product_id)
    roi_obj = p_obj.get_roi(roi_id) if p_obj else None
    ref_img = _imread(sources[0], cv2.IMREAD_COLOR)

    # カテゴリ 1: OK/NG + 障害物 (一部隠れた製品)
    for i in range(n_obstructed):
        src_path = random.choice(sources)
        src = _imread(src_path, cv2.IMREAD_COLOR)
        if src is None:
            errors.append(f"読込失敗: {os.path.basename(src_path)}")
            continue
        out = src
        n_effects = random.randint(1, min(3, len(patterns)))
        chosen = random.sample(patterns, k=n_effects)
        for name in chosen:
            try:
                out = EFFECTS[name](out, bg=bg)
            except Exception as e:
                errors.append(f"{name}: {e}")
        out_path = os.path.join(unstable_dir, f"{SYNTH_PREFIX}obs_{i:04d}.jpg")
        _imwrite(out_path, out, [cv2.IMWRITE_JPEG_QUALITY, 90])
        generated += 1

    # カテゴリ 2: 背景のみ + 軽い変動 (純粋な「製品なし」)
    if n_bg_only > 0 and ref_img is not None:
        for j in range(n_bg_only):
            sample = _bg_only_sample(bg, roi_obj, ref_img)
            if sample is None:
                break
            out_path = os.path.join(unstable_dir, f"{SYNTH_PREFIX}bg_{j:04d}.jpg")
            _imwrite(out_path, sample, [cv2.IMWRITE_JPEG_QUALITY, 90])
            generated += 1

    # カテゴリ 3: 背景 + 障害物 (製品なし状態でも手・動きがある状況)
    if n_bg_obs > 0 and ref_img is not None and obstacle_only:
        for k in range(n_bg_obs):
            base = _bg_only_sample(bg, roi_obj, ref_img)
            if base is None:
                break
            out = base
            n_effects = random.randint(1, min(2, len(obstacle_only)))
            chosen = random.sample(obstacle_only, k=n_effects)
            for name in chosen:
                try:
                    out = EFFECTS[name](out, bg=None)
                except Exception as e:
                    errors.append(f"{name}: {e}")
            out_path = os.path.join(unstable_dir, f"{SYNTH_PREFIX}bgobs_{k:04d}.jpg")
            _imwrite(out_path, out, [cv2.IMWRITE_JPEG_QUALITY, 90])
            generated += 1

    meta = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "generated_count": generated,
        "source_count": len(sources),
        "patterns": patterns,
        "count_multiplier": count_multiplier,
        "bg_used": bg is not None,
        "split": {
            "obstructed": n_obstructed,
            "bg_only": n_bg_only,
            "bg_obstructed": n_bg_obs,
        },
    }
    try:
        with open(os.path.join(unstable_dir, META_FILENAME), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
    except OSError as e:
        errors.append(f"meta書込失敗: {e}")

    return {
        "generated": generated,
        "unstable_dir": unstable_dir,
        "errors": errors,
        "meta": meta,
    }


def delete_synth_unstable(product_id: str, roi_id: str) -> int:
    """synth_*.jpg と .synth_meta.json のみ削除する。人手追加画像は保持。"""
    unstable_dir = get_unstable_dir(product_id, roi_id)
    if not os.path.isdir(unstable_dir):
        return 0
    deleted = 0
    for f in os.listdir(unstable_dir):
        is_synth_img = (f.startswith(SYNTH_PREFIX)
                        and f.lower().endswith((".jpg", ".jpeg", ".png")))
        if is_synth_img or f == META_FILENAME:
            try:
                os.remove(os.path.join(unstable_dir, f))
                if is_synth_img:
                    deleted += 1
            except OSError:
                pass
    return deleted


def get_unstable_status(product_id: str, roi_id: str) -> dict:
    """そのROIの unstable サンプル状態を返す。"""
    unstable_dir = get_unstable_dir(product_id, roi_id)
    if not os.path.isdir(unstable_dir):
        return {
            "exists": False, "synth_count": 0, "manual_count": 0,
            "total_count": 0, "meta": None,
        }
    synth_count = 0
    manual_count = 0
    for f in os.listdir(unstable_dir):
        if not f.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        if f.startswith(SYNTH_PREFIX):
            synth_count += 1
        else:
            manual_count += 1
    meta_path = os.path.join(unstable_dir, META_FILENAME)
    meta = None
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "exists": True,
        "synth_count": synth_count,
        "manual_count": manual_count,
        "total_count": synth_count + manual_count,
        "meta": meta,
    }


def list_synth_previews(product_id: str, roi_id: str, n: int = 8) -> list[str]:
    """合成プレビュー用ファイル名一覧 (ランダムサンプル)。"""
    unstable_dir = get_unstable_dir(product_id, roi_id)
    if not os.path.isdir(unstable_dir):
        return []
    synth_files = [
        f for f in os.listdir(unstable_dir)
        if f.startswith(SYNTH_PREFIX) and f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
    if not synth_files:
        return []
    sample = random.sample(synth_files, min(n, len(synth_files)))
    return sorted(sample)
