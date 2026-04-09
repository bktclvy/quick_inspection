"""テンプレートマッチング検出のスタンドアロンテスト。

本体に一切依存せず、カメラ映像にROI枠・マッチスコア・ステート遷移を
リアルタイム表示して、置いた/置いていない判定の動作を目視確認する。

使い方:
    python tests/test_template_matching.py                  # 最初の製品を使用
    python tests/test_template_matching.py prod_b02ef0b1    # 製品IDを指定

操作:
    q: 終了
    r: ステートマシンリセット
"""
import os
import sys
import json
import time
import platform
import cv2
import numpy as np

# ── プロジェクトルート ────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
PRODUCTS_DIR = os.path.join(PROJECT_DIR, "products")


# ── 製品データ読み込み ────────────────────────────────────

def load_product(product_id: str | None = None) -> tuple[dict, dict[str, np.ndarray]]:
    """product.json とテンプレート画像をロードする。"""
    if product_id:
        pdir = os.path.join(PRODUCTS_DIR, product_id)
    else:
        # 最初の製品を自動選択
        dirs = [d for d in os.listdir(PRODUCTS_DIR)
                if os.path.isfile(os.path.join(PRODUCTS_DIR, d, "product.json"))]
        if not dirs:
            print("エラー: products/ に製品が見つかりません。")
            sys.exit(1)
        pdir = os.path.join(PRODUCTS_DIR, dirs[0])

    json_path = os.path.join(pdir, "product.json")
    if not os.path.isfile(json_path):
        print(f"エラー: {json_path} が見つかりません。")
        sys.exit(1)

    with open(json_path, "r", encoding="utf-8") as f:
        product = json.load(f)

    # テンプレート読み込み
    templates: dict[str, np.ndarray] = {}
    tpl_dir = os.path.join(pdir, "templates")
    if os.path.isdir(tpl_dir):
        for fname in os.listdir(tpl_dir):
            if fname.endswith(".jpg"):
                roi_id = fname[:-4]
                img = cv2.imread(os.path.join(tpl_dir, fname), cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    templates[roi_id] = img

    print(f"製品: {product['name']} ({product['id']})")
    print(f"ROI数: {len(product['rois'])}, テンプレート数: {len(templates)}")

    rois_with_template = [r for r in product["rois"] if r["id"] in templates]
    if not rois_with_template:
        print("警告: テンプレートが登録されたROIがありません。スコアは全てNoneになります。")

    return product, templates


# ── マッチスコア計算（本体と同一アルゴリズム）────────────

def calc_match_score(frame: np.ndarray, roi: dict,
                     template: np.ndarray | None) -> float | None:
    """ROI領域のテンプレートマッチスコアを返す。テンプレートなしならNone。"""
    if template is None:
        return None

    h, w = frame.shape[:2]
    x1 = max(0, int(roi["x"] * w))
    y1 = max(0, int(roi["y"] * h))
    x2 = min(w, int((roi["x"] + roi["w"]) * w))
    y2 = min(h, int((roi["y"] + roi["h"]) * h))
    crop = frame[y1:y2, x1:x2]

    if crop.size == 0:
        return None

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    if gray.shape != template.shape:
        gray = cv2.resize(gray, (template.shape[1], template.shape[0]))

    result = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
    return max(0.0, float(result[0][0]))


# ── 簡易ステートマシン ───────────────────────────────────

class SimpleStateMachine:
    """本体 InspectionStateMachine の簡易再実装（推論なし）。"""

    def __init__(self, cfg: dict):
        self.match_threshold: float = cfg.get("match_threshold", 0.80)
        self.trigger_frames: int = cfg.get("trigger_frames", 3)
        self.removal_threshold: float = cfg.get("removal_threshold", 0.50)
        self.removal_frames: int = cfg.get("removal_frames", 3)
        self.judged_display_ms: int = cfg.get("judged_display_ms", 2000)
        self.reset()

    def reset(self):
        self.state = "IDLE"
        self._trigger_count = 0
        self._removal_count = 0
        self._judged_time: float | None = None
        self.trigger_total = 0  # 検出回数

    def process(self, match_scores: dict[str, float | None]) -> dict:
        valid = {k: v for k, v in match_scores.items() if v is not None}

        if self.state == "IDLE":
            if not valid:
                return self._info(match_scores)
            all_above = all(s >= self.match_threshold for s in valid.values())
            if all_above:
                self._trigger_count += 1
            else:
                self._trigger_count = 0
            if self._trigger_count >= self.trigger_frames:
                self.state = "INSPECTING"
                self._trigger_count = 0
            return self._info(match_scores)

        if self.state == "INSPECTING":
            # 推論はしないので即座にJUDGEDに遷移（テスト目的）
            self.state = "JUDGED"
            self._judged_time = time.time()
            self.trigger_total += 1
            return self._info(match_scores)

        if self.state == "JUDGED":
            elapsed = (time.time() - self._judged_time) * 1000
            if elapsed >= self.judged_display_ms:
                self.state = "WAITING_REMOVAL"
                self._removal_count = 0
            return self._info(match_scores, remaining=max(0, int(self.judged_display_ms - elapsed)))

        if self.state == "WAITING_REMOVAL":
            if not valid:
                self.state = "IDLE"
                self._trigger_count = 0
                return self._info(match_scores)
            any_below = any(s < self.removal_threshold for s in valid.values())
            if any_below:
                self._removal_count += 1
            else:
                self._removal_count = 0
            if self._removal_count >= self.removal_frames:
                self.state = "IDLE"
                self._trigger_count = 0
            return self._info(match_scores)

        return self._info(match_scores)

    def _info(self, match_scores, remaining=None):
        info = {
            "state": self.state,
            "trigger_count": self._trigger_count,
            "trigger_required": self.trigger_frames,
            "removal_count": self._removal_count,
            "removal_required": self.removal_frames,
            "trigger_total": self.trigger_total,
            "match_scores": match_scores,
        }
        if remaining is not None:
            info["remaining_ms"] = remaining
        return info


# ── 色ヘルパー ────────────────────────────────────────────

def hex_to_bgr(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)


def score_color(score: float | None, match_th: float, removal_th: float) -> tuple[int, int, int]:
    """スコアに応じた色: 緑(>=match) / 黄(中間) / 赤(<removal)。"""
    if score is None:
        return (128, 128, 128)  # グレー
    if score >= match_th:
        return (0, 200, 0)     # 緑
    if score >= removal_th:
        return (0, 200, 200)   # 黄
    return (0, 0, 220)         # 赤


STATE_COLORS = {
    "IDLE": (200, 200, 200),
    "INSPECTING": (0, 200, 0),
    "JUDGED": (255, 180, 0),
    "WAITING_REMOVAL": (0, 140, 255),
}


# ── メインループ ──────────────────────────────────────────

def main():
    product_id = sys.argv[1] if len(sys.argv) > 1 else None
    product, templates = load_product(product_id)
    rois = product["rois"]
    cfg = product.get("inspection_config", {})
    sm = SimpleStateMachine(cfg)

    print(f"\n設定: match_threshold={sm.match_threshold}, trigger_frames={sm.trigger_frames}, "
          f"removal_threshold={sm.removal_threshold}, removal_frames={sm.removal_frames}")
    print("\nカメラを開いています...")

    backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
    cap = cv2.VideoCapture(0, backend)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    if not cap.isOpened():
        print("エラー: カメラを開けません。")
        sys.exit(1)

    # 180度回転（本体と同じ）
    rotation = cv2.ROTATE_180

    print("起動しました。 q=終了, r=リセット\n")

    window_name = "Template Matching Test"
    cv2.namedWindow(window_name, cv2.WINDOW_AUTOSIZE)

    while True:
        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.rotate(frame, rotation)
        fh, fw = frame.shape[:2]
        display = frame.copy()

        # ── マッチスコア計算 ──
        match_scores: dict[str, float | None] = {}
        for roi in rois:
            rid = roi["id"]
            tpl = templates.get(rid)
            score = calc_match_score(frame, roi, tpl)
            match_scores[rid] = score

        # ── ステートマシン処理 ──
        info = sm.process(match_scores)

        # ── ROI描画 ──
        for roi in rois:
            rid = roi["id"]
            x1 = int(roi["x"] * fw)
            y1 = int(roi["y"] * fh)
            x2 = int((roi["x"] + roi["w"]) * fw)
            y2 = int((roi["y"] + roi["h"]) * fh)

            score = match_scores.get(rid)
            sc = score_color(score, sm.match_threshold, sm.removal_threshold)

            # ROI矩形
            cv2.rectangle(display, (x1, y1), (x2, y2), sc, 2)

            # スコアテキスト
            score_text = f"{score:.3f}" if score is not None else "N/A"
            label = f"{roi['name']}: {score_text}"

            # テキスト背景
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            cv2.rectangle(display, (x1, y1 - th - 8), (x1 + tw + 4, y1), sc, -1)
            cv2.putText(display, label, (x1 + 2, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

        # ── 上部ステータスバー ──
        bar_h = 80
        overlay = display.copy()
        cv2.rectangle(overlay, (0, 0), (fw, bar_h), (40, 40, 40), -1)
        cv2.addWeighted(overlay, 0.7, display, 0.3, 0, display)

        state = info["state"]
        state_col = STATE_COLORS.get(state, (200, 200, 200))

        # ステート表示
        cv2.putText(display, f"State: {state}", (10, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, state_col, 2, cv2.LINE_AA)

        # トリガー/除去カウント
        if state == "IDLE":
            tc = info["trigger_count"]
            tr = info["trigger_required"]
            progress = f"Trigger: {tc}/{tr}"
            cv2.putText(display, progress, (10, 55),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1, cv2.LINE_AA)
            # プログレスバー
            bar_w = 150
            bar_x = 10
            bar_y = 62
            cv2.rectangle(display, (bar_x, bar_y), (bar_x + bar_w, bar_y + 8), (80, 80, 80), -1)
            fill = int(bar_w * tc / tr) if tr > 0 else 0
            if fill > 0:
                cv2.rectangle(display, (bar_x, bar_y), (bar_x + fill, bar_y + 8), (0, 200, 0), -1)

        elif state == "WAITING_REMOVAL":
            rc = info["removal_count"]
            rr = info["removal_required"]
            progress = f"Removal: {rc}/{rr}"
            cv2.putText(display, progress, (10, 55),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1, cv2.LINE_AA)
            bar_w = 150
            bar_x = 10
            bar_y = 62
            cv2.rectangle(display, (bar_x, bar_y), (bar_x + bar_w, bar_y + 8), (80, 80, 80), -1)
            fill = int(bar_w * rc / rr) if rr > 0 else 0
            if fill > 0:
                cv2.rectangle(display, (bar_x, bar_y), (bar_x + fill, bar_y + 8), (0, 140, 255), -1)

        elif state == "JUDGED":
            remaining = info.get("remaining_ms", 0)
            cv2.putText(display, f"DETECTED! (remaining: {remaining}ms)", (10, 55),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1, cv2.LINE_AA)

        # 検出回数
        cv2.putText(display, f"Detections: {info['trigger_total']}", (fw - 200, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1, cv2.LINE_AA)

        # 閾値情報
        cv2.putText(display, f"Match>={sm.match_threshold}  Remove<{sm.removal_threshold}",
                    (fw - 300, 55),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (160, 160, 160), 1, cv2.LINE_AA)

        cv2.imshow(window_name, display)

        key = cv2.waitKey(50) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            sm.reset()
            print("ステートマシンをリセットしました。")

    cap.release()
    cv2.destroyAllWindows()
    print(f"\n終了。検出回数: {sm.trigger_total}")


if __name__ == "__main__":
    main()
