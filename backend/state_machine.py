"""検査ステートマシン: IDLE → INSPECTING → JUDGED → WAITING_REMOVAL → IDLE

トリガーモード:
  - auto:   テンプレートマッチングで自動遷移
  - manual: 明示的トリガー（スペースキー）で遷移、WAITING_REMOVAL をスキップ
"""
import os
import json
import time
from enum import Enum
import config


class InspectionState(str, Enum):
    IDLE = "idle"
    INSPECTING = "inspecting"
    JUDGED = "judged"
    WAITING_REMOVAL = "waiting_removal"


class InspectionStateMachine:
    def __init__(self):
        self.state = InspectionState.IDLE
        self.trigger_mode: str = config.DEFAULT_TRIGGER_MODE

        # テンプレートマッチングパラメータ
        self.match_threshold: float = config.MATCH_THRESHOLD
        self.trigger_frames: int = config.TRIGGER_FRAMES
        self.removal_threshold: float = config.REMOVAL_THRESHOLD
        self.removal_frames: int = config.REMOVAL_FRAMES
        self.judged_display_ms: int = config.JUDGED_DISPLAY_MS

        # 連続フレームカウント（内部）
        self._trigger_count: int = 0
        self._removal_count: int = 0

        # 判定結果保持
        self.last_judgment: dict | None = None
        self._judgment_time: float | None = None

        # 検査カウンター
        self.count_total: int = 0
        self.count_ok: int = 0
        self.count_ng: int = 0
        self._counter_file: str | None = None

    # ── 製品セットアップ ──────────────────────────────────

    def setup_product(self, inspection_config: dict, counter_file: str):
        """指定製品の設定でステートマシンを初期化する。"""
        self.reset()
        for key in ("match_threshold", "trigger_frames", "removal_threshold",
                     "removal_frames", "judged_display_ms", "trigger_mode"):
            if key in inspection_config:
                setattr(self, key, inspection_config[key])
        self._counter_file = counter_file
        self._load_counters()

    # ── 設定更新 ──────────────────────────────────────────

    def update_config(self, cfg: dict):
        for key, val in cfg.items():
            if hasattr(self, key) and not key.startswith('_'):
                setattr(self, key, val)

    # ── カウンター永続化 ──────────────────────────────────

    def _load_counters(self):
        if not self._counter_file or not os.path.exists(self._counter_file):
            self.count_total = 0
            self.count_ok = 0
            self.count_ng = 0
            return
        try:
            with open(self._counter_file, "r") as f:
                data = json.load(f)
            self.count_total = data.get("total", 0)
            self.count_ok = data.get("ok", 0)
            self.count_ng = data.get("ng", 0)
        except (json.JSONDecodeError, OSError):
            pass

    def _save_counters(self):
        if not self._counter_file:
            return
        try:
            os.makedirs(os.path.dirname(self._counter_file), exist_ok=True)
            with open(self._counter_file, "w") as f:
                json.dump({"total": self.count_total, "ok": self.count_ok, "ng": self.count_ng}, f)
        except OSError:
            pass

    def get_counters(self) -> dict:
        return {"total": self.count_total, "ok": self.count_ok, "ng": self.count_ng}

    def reset_counters(self):
        self.count_total = 0
        self.count_ok = 0
        self.count_ng = 0
        self._save_counters()

    # ── リセット ──────────────────────────────────────────

    def reset(self):
        self.state = InspectionState.IDLE
        self._trigger_count = 0
        self._removal_count = 0
        self.last_judgment = None
        self._judgment_time = None

    # ── メインフレーム処理（自動モード）──────────────────

    def process_frame(self, match_scores: dict[str, float | None],
                      roi_results: list[dict] | None = None) -> dict:
        """1フレームを処理する。WSループから呼ばれる。"""
        counters = self.get_counters()

        # ── IDLE ──────────────────────────────────────────
        if self.state == InspectionState.IDLE:
            if self.trigger_mode != "auto":
                return {"state": "idle", "trigger_mode": self.trigger_mode,
                        "counters": counters, "match_scores": match_scores}

            valid_scores = {k: v for k, v in match_scores.items() if v is not None}
            if not valid_scores:
                return {"state": "idle", "trigger_mode": "auto",
                        "counters": counters, "match_scores": match_scores,
                        "trigger_count": 0, "trigger_required": self.trigger_frames}

            all_above = all(s >= self.match_threshold for s in valid_scores.values())
            if all_above:
                self._trigger_count += 1
            else:
                self._trigger_count = 0

            if self._trigger_count >= self.trigger_frames:
                self.state = InspectionState.INSPECTING
                self._trigger_count = 0
                return {"state": "inspecting", "trigger_mode": "auto",
                        "counters": counters}

            return {"state": "idle", "trigger_mode": "auto",
                    "counters": counters, "match_scores": match_scores,
                    "trigger_count": self._trigger_count,
                    "trigger_required": self.trigger_frames}

        # ── INSPECTING ────────────────────────────────────
        if self.state == InspectionState.INSPECTING:
            if roi_results is None:
                return {"state": "inspecting", "trigger_mode": self.trigger_mode,
                        "counters": counters}

            judgment = self._make_judgment(roi_results)
            self.last_judgment = judgment
            self._judgment_time = time.time()
            self.state = InspectionState.JUDGED

            self.count_total += 1
            if judgment["overall_judgment"].upper() == "OK":
                self.count_ok += 1
            else:
                self.count_ng += 1
            self._save_counters()
            counters = self.get_counters()

            return {"state": "judged", "trigger_mode": self.trigger_mode,
                    "counters": counters, **judgment}

        # ── JUDGED ────────────────────────────────────────
        if self.state == InspectionState.JUDGED:
            elapsed = (time.time() - self._judgment_time) * 1000
            remaining = max(0, int(self.judged_display_ms - elapsed))

            if elapsed >= self.judged_display_ms:
                if self.trigger_mode == "manual":
                    self.state = InspectionState.IDLE
                    self._trigger_count = 0
                    return {"state": "idle", "trigger_mode": "manual",
                            "counters": counters, "match_scores": match_scores}
                else:
                    self.state = InspectionState.WAITING_REMOVAL
                    self._removal_count = 0

            if self.last_judgment:
                return {"state": self.state.value,
                        "trigger_mode": self.trigger_mode,
                        "counters": counters,
                        "remaining_ms": remaining,
                        **self.last_judgment}

            return {"state": self.state.value, "trigger_mode": self.trigger_mode,
                    "counters": counters, "remaining_ms": remaining}

        # ── WAITING_REMOVAL ───────────────────────────────
        if self.state == InspectionState.WAITING_REMOVAL:
            valid_scores = {k: v for k, v in match_scores.items() if v is not None}
            if not valid_scores:
                self.state = InspectionState.IDLE
                self._trigger_count = 0
                return {"state": "idle", "trigger_mode": "auto",
                        "counters": counters, "match_scores": match_scores}

            any_below = any(s < self.removal_threshold for s in valid_scores.values())
            if any_below:
                self._removal_count += 1
            else:
                self._removal_count = 0

            if self._removal_count >= self.removal_frames:
                self.state = InspectionState.IDLE
                self._trigger_count = 0
                return {"state": "idle", "trigger_mode": "auto",
                        "counters": counters, "match_scores": match_scores}

            result = {"state": "waiting_removal", "trigger_mode": "auto",
                      "counters": counters, "match_scores": match_scores}
            if self.last_judgment:
                result["overall_judgment"] = self.last_judgment.get("overall_judgment")
            return result

        return {"state": "idle", "trigger_mode": self.trigger_mode, "counters": counters}

    # ── 手動トリガー ──────────────────────────────────────

    def manual_trigger(self, roi_results: list[dict]) -> dict:
        """即時検査を実行する（手動モード用）。"""
        judgment = self._make_judgment(roi_results)
        self.last_judgment = judgment
        self._judgment_time = time.time()
        self.state = InspectionState.JUDGED

        self.count_total += 1
        if judgment["overall_judgment"].upper() == "OK":
            self.count_ok += 1
        else:
            self.count_ng += 1
        self._save_counters()

        return {"state": "judged", "trigger_mode": "manual",
                "counters": self.get_counters(), **judgment}

    # ── 判定ロジック ──────────────────────────────────────

    def _make_judgment(self, roi_results: list[dict]) -> dict:
        """ROI別の推論結果を総合判定に集約する。全ROIがOK→OK、1つでもNG→NG。
        各結果の "judgment" フィールド ("ok"/"ng") はモデルメタデータ由来。"""
        overall_ok = True
        min_confidence = 1.0
        clean_results = []

        for r in roi_results:
            if "error" in r:
                overall_ok = False
                clean_results.append(r)
                continue

            cls = r["predicted_class"]
            conf = r["confidence"]
            is_ok = r.get("judgment", "ng") == "ok"
            if not is_ok:
                overall_ok = False
            min_confidence = min(min_confidence, conf)

            clean_results.append({
                "roi_id": r["roi_id"],
                "roi_name": r["roi_name"],
                "judgment": "OK" if is_ok else "NG",
                "predicted_class": cls,
                "confidence": conf,
                "probabilities": r.get("probabilities", {}),
            })

        overall = "OK" if overall_ok else "NG"
        return {
            "overall_judgment": overall,
            "overall_confidence": round(min_confidence, 4),
            "roi_results": clean_results,
        }


state_machine = InspectionStateMachine()
