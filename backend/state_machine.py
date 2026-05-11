"""検査ステートマシン — 厳密フロー

IDLE → DETECTING → INSPECTING → JUDGED → WAITING_REMOVAL → IDLE

設置検知: ROIテンプレートの拡大領域マッチング（全ROI一致で設置確定）
取出検知: 背景画像との差分比較（差分が十分小さい＝背景に戻った）
再検査防止: 取出しを確認しないとIDLEに戻らない → 二重検査不可
"""
import os
import json
import time
import uuid
import datetime
import threading
from enum import Enum
import config


class InspectionState(str, Enum):
    IDLE = "idle"
    DETECTING = "detecting"       # 設置検知中（テンプレートマッチ蓄積）
    INSPECTING = "inspecting"     # モデル推論中
    JUDGED = "judged"             # 判定結果表示中
    WAITING_REMOVAL = "waiting_removal"  # 取出し待ち
    WAITING_CONFIRM = "waiting_confirm"  # 確認待ち（NG or 箱完成）


class InspectionStateMachine:
    def __init__(self):
        self._lock = threading.Lock()
        self.state = InspectionState.IDLE

        # トリガーモード ("auto" or "manual")
        self.trigger_mode: str = "auto"

        # 設置検知パラメータ（テンプレートマッチ）
        self.match_threshold: float = config.MATCH_THRESHOLD
        self.trigger_frames: int = config.TRIGGER_FRAMES
        self.match_margin: float = 0.10  # ROI拡大マージン（10%）

        # 取出し検知パラメータ（背景NCC）
        self.removal_bg_threshold: float = 0.85  # 背景NCCスコアがこれ以上→取出し確認
        self.removal_frames: int = getattr(config, 'REMOVAL_FRAMES', 3)

        # 表示
        self.judged_display_ms: int = config.JUDGED_DISPLAY_MS

        # 箱管理
        self.pieces_per_box: int = 0  # 0 = 箱管理なし

        # 安定検知（設置後、手が退くのを待つ）
        self.stability_threshold: float = config.STABILITY_THRESHOLD
        self.stability_frames: int = config.STABILITY_FRAMES

        # 確認待ち理由
        self._confirm_reason: str = ""    # "ng" or "box_complete"

        # 内部カウンタ
        self._trigger_count: int = 0      # 設置検知用連続マッチ数
        self._removal_count: int = 0      # 取出し検知用連続一致数
        self._stability_count: int = 0    # 安定フレーム数
        self._ai_trigger_count: int = 0   # AI トリガー用連続一致数

        # 判定結果保持
        self.last_judgment: dict | None = None
        self._judgment_time: float | None = None

        # 検査カウンター
        self.count_total: int = 0
        self.count_ok: int = 0
        self.count_ng: int = 0
        self._counter_file: str | None = None

        # サイクル/箱トレーシング
        self._cycle_start_time: float | None = None      # IDLE → DETECTING の時刻
        self._current_box_id: str | None = None          # 現在埋めている箱のID
        self._box_started_at: float | None = None        # 箱の最初の OK の cycle_start
        self._pending_event: dict | None = None          # JUDGED で構築、IDLE で flush
        self._pending_box: dict | None = None            # 箱完成時に構築、IDLE で flush

    # ── 製品セットアップ ──────────────────────────────────

    def setup_product(self, inspection_config: dict, counter_file: str | None):
        with self._lock:
            self._reset_internal()
            for key in ("match_threshold", "trigger_frames", "removal_diff_threshold",
                         "removal_frames", "removal_bg_threshold", "judged_display_ms", "match_margin",
                         "stability_threshold", "stability_frames", "pieces_per_box",
                         # 旧パラメータも受け付ける（互換性）
                         "presence_threshold", "removal_threshold", "trigger_mode"):
                if key in inspection_config:
                    if hasattr(self, key):
                        setattr(self, key, inspection_config[key])
            self._counter_file = counter_file
            if counter_file:
                self._load_counters()
            else:
                self.count_total = self.count_ok = self.count_ng = 0

    # ── 設定更新 ──────────────────────────────────────────

    def update_config(self, cfg: dict):
        with self._lock:
            for key, val in cfg.items():
                if hasattr(self, key) and not key.startswith('_'):
                    setattr(self, key, val)

    # ── メインフレーム処理（統一モード）──────────────────

    def process_frame_unified(self,
                              match_scores: dict[str, float | None],
                              bg_match: float | None,
                              frame_diff: float,
                              roi_results: list[dict] | None = None) -> dict:
        """1フレームを処理する。設置検知（ROIテンプレート）＋取出検知（背景NCC）の統一モード。

        match_scores: 各ROIの拡大領域マッチスコア {roi_id: 0-1 or None}
        bg_match:     背景NCCスコア (0-1)。高い＝背景に近い＝製品なし。Noneなら背景未登録。
        frame_diff:   前フレームとの差分平均値 (0-255)。安定検知用。
        roi_results:  モデル推論結果（INSPECTING時のみ非None）
        """
        with self._lock:
            return self._process_frame_unified_internal(
                match_scores, bg_match, frame_diff, roi_results)

    def _process_frame_unified_internal(self,
                              match_scores: dict[str, float | None],
                              bg_match: float | None,
                              frame_diff: float,
                              roi_results: list[dict] | None = None) -> dict:
        counters = self._get_counters_internal()
        diag = {
            "bg_match": round(bg_match, 3) if bg_match is not None else None,
            "frame_diff": round(frame_diff, 1),
            "match_scores": {k: round(v, 3) if v is not None else None for k, v in match_scores.items()},
        }

        # 背景未設定
        if bg_match is None:
            return {"state": "idle", "trigger_mode": "auto",
                    "counters": counters, "needs_background": True, **diag}

        # ── IDLE: 設置待ち ────────────────────────────────
        if self.state == InspectionState.IDLE:
            valid = {k: v for k, v in match_scores.items() if v is not None}
            if not valid:
                self._trigger_count = 0
                return {"state": "idle", "trigger_mode": "auto",
                        "counters": counters,
                        "trigger_count": 0, "trigger_required": self.trigger_frames,
                        **diag}

            all_match = all(s >= self.match_threshold for s in valid.values())
            if all_match:
                self._trigger_count += 1
            else:
                self._trigger_count = 0

            if self._trigger_count >= self.trigger_frames:
                # 設置検知 → 安定待ちへ。サイクル計測開始
                self.state = InspectionState.DETECTING
                self._trigger_count = 0
                self._stability_count = 0
                self._cycle_start_time = time.time()
                return {"state": "detecting", "trigger_mode": "auto",
                        "counters": counters,
                        "stability_count": 0,
                        "stability_required": self.stability_frames,
                        **diag}

            return {"state": "idle", "trigger_mode": "auto",
                    "counters": counters,
                    "trigger_count": self._trigger_count,
                    "trigger_required": self.trigger_frames,
                    **diag}

        # ── DETECTING: 安定待ち（手が退くのを待つ）────────
        if self.state == InspectionState.DETECTING:
            # テンプレートマッチが外れた → 製品が動いた/外れた → IDLEに戻す
            valid = {k: v for k, v in match_scores.items() if v is not None}
            if valid:
                all_match = all(s >= self.match_threshold for s in valid.values())
                if not all_match:
                    # 製品が外れた（判定前にアボート、サイクル計測リセット）
                    self.state = InspectionState.IDLE
                    self._stability_count = 0
                    self._cycle_start_time = None
                    return {"state": "idle", "trigger_mode": "auto",
                            "counters": counters, **diag}

            # フレーム間差分で安定検知
            if frame_diff <= self.stability_threshold:
                self._stability_count += 1
            else:
                self._stability_count = 0

            if self._stability_count >= self.stability_frames:
                # 安定確認 → 検査実行
                self.state = InspectionState.INSPECTING
                self._stability_count = 0
                return {"state": "inspecting", "trigger_mode": "auto",
                        "counters": counters, **diag}

            return {"state": "detecting", "trigger_mode": "auto",
                    "counters": counters,
                    "stability_count": self._stability_count,
                    "stability_required": self.stability_frames,
                    **diag}

        # ── INSPECTING: 推論待ち ──────────────────────────
        if self.state == InspectionState.INSPECTING:
            if roi_results is None:
                return {"state": "inspecting", "trigger_mode": "auto",
                        "counters": counters, **diag}

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
            self._build_judgment_event(judgment)
            counters = self._get_counters_internal()

            return {"state": "judged", "trigger_mode": "auto",
                    "counters": counters, **diag, **judgment}

        # ── JUDGED: 結果表示（取出しチェックも並行） ─────
        if self.state == InspectionState.JUDGED:
            elapsed = (time.time() - self._judgment_time) * 1000
            remaining = max(0, int(self.judged_display_ms - elapsed))
            display_done = elapsed >= self.judged_display_ms

            # 表示中でも取出しチェックを行う
            if bg_match is not None and bg_match >= self.removal_bg_threshold:
                self._removal_count += 1
            else:
                self._removal_count = 0

            removal_done = self._removal_count >= self.removal_frames

            # 取出し確認 → IDLEまたは確認待ち
            if removal_done:
                need_confirm = False
                reason = ""
                # NG判定 → 確認待ち
                if self.last_judgment and self.last_judgment.get("overall_judgment") == "NG":
                    need_confirm = True
                    reason = "ng"
                # 箱完成 → 確認待ち
                elif self.pieces_per_box > 0 and self.count_ok > 0 and self.count_ok % self.pieces_per_box == 0:
                    need_confirm = True
                    reason = "box_complete"

                if need_confirm:
                    self.state = InspectionState.WAITING_CONFIRM
                    self._confirm_reason = reason
                    self._removal_count = 0
                    result = {"state": "waiting_confirm", "trigger_mode": "auto",
                              "counters": counters, "confirm_reason": reason, **diag}
                    if self.last_judgment:
                        result.update(self.last_judgment)
                    return result
                else:
                    self.state = InspectionState.IDLE
                    self._trigger_count = 0
                    self._removal_count = 0
                    self._stability_count = 0
                    result = {"state": "idle", "trigger_mode": "auto",
                              "counters": counters, **diag}
                    return self._attach_cycle_outputs(result)

            # 表示完了だが取出し未確認 → WAITING_REMOVAL
            if display_done:
                self.state = InspectionState.WAITING_REMOVAL

            result = {"state": self.state.value, "trigger_mode": "auto",
                      "counters": counters, "remaining_ms": remaining, **diag}
            if self.last_judgment:
                result.update(self.last_judgment)
            return result

        # ── WAITING_REMOVAL: 取出し確認（背景NCC） ──
        if self.state == InspectionState.WAITING_REMOVAL:
            # 背景NCCスコアが閾値以上 → 背景に戻った → 取出し確認
            if bg_match >= self.removal_bg_threshold:
                self._removal_count += 1
            else:
                self._removal_count = 0

            if self._removal_count >= self.removal_frames:
                need_confirm = False
                reason = ""
                if self.last_judgment and self.last_judgment.get("overall_judgment") == "NG":
                    need_confirm = True
                    reason = "ng"
                elif self.pieces_per_box > 0 and self.count_ok > 0 and self.count_ok % self.pieces_per_box == 0:
                    need_confirm = True
                    reason = "box_complete"

                if need_confirm:
                    self.state = InspectionState.WAITING_CONFIRM
                    self._confirm_reason = reason
                    self._removal_count = 0
                    result = {"state": "waiting_confirm", "trigger_mode": "auto",
                              "counters": counters, "confirm_reason": reason, **diag}
                    if self.last_judgment:
                        result.update(self.last_judgment)
                    return result
                else:
                    self.state = InspectionState.IDLE
                    self._trigger_count = 0
                    self._removal_count = 0
                    self._stability_count = 0
                    result = {"state": "idle", "trigger_mode": "auto",
                              "counters": counters, **diag}
                    return self._attach_cycle_outputs(result)

            result = {"state": "waiting_removal", "trigger_mode": "auto",
                      "counters": counters, **diag,
                      "removal_count": self._removal_count,
                      "removal_required": self.removal_frames}
            if self.last_judgment:
                result["overall_judgment"] = self.last_judgment.get("overall_judgment")
            return result

        # ── WAITING_CONFIRM: ユーザー確認待ち ─────────────
        if self.state == InspectionState.WAITING_CONFIRM:
            result = {"state": "waiting_confirm", "trigger_mode": "auto",
                      "counters": counters, "confirm_reason": self._confirm_reason, **diag}
            if self.last_judgment:
                result.update(self.last_judgment)
            return result

        return {"state": "idle", "trigger_mode": "auto", "counters": counters, **diag}

    def confirm(self) -> dict:
        """ユーザーが確認ボタンを押した。どの state からでも IDLE に戻す。
        manual モードでの「判定表示後すぐスペースで次へ」の経路にも対応。
        """
        with self._lock:
            self.state = InspectionState.IDLE
            self._trigger_count = 0
            self._removal_count = 0
            self._stability_count = 0
            self._confirm_reason = ""
            result = {"state": "idle", "trigger_mode": self.trigger_mode,
                      "counters": self._get_counters_internal()}
            return self._attach_cycle_outputs(result)

    # ── AI トリガーモード ─────────────────────────────────

    def process_frame_ai_trigger(self, roi_results: list[dict], bg_match: float | None,
                                  frame_diff: float = 0.0) -> dict:
        """AIトリガーモード: モデル推論結果でトリガーを判断する。
        ROIのいずれかが 'uninspectable' を返す、または画像が不安定な間はトリガーしない。"""
        with self._lock:
            return self._process_ai_trigger_internal(roi_results, bg_match, frame_diff)

    def _process_ai_trigger_internal(self, roi_results: list[dict], bg_match: float | None,
                                      frame_diff: float) -> dict:
        counters = self._get_counters_internal()
        diag = {"bg_match": round(bg_match, 3) if bg_match is not None else None,
                "frame_diff": round(frame_diff, 1)}

        if self.state == InspectionState.IDLE:
            has_uninspectable = any(
                r.get("judgment") == "uninspectable"
                for r in roi_results if "error" not in r
            )
            has_error = any("error" in r for r in roi_results)
            not_stable = frame_diff > self.stability_threshold
            if not roi_results or has_uninspectable or has_error or not_stable:
                self._ai_trigger_count = 0
                return {"state": "idle", "trigger_mode": "ai", "counters": counters,
                        "trigger_count": 0, "trigger_required": self.trigger_frames, **diag}

            self._ai_trigger_count += 1
            if self._ai_trigger_count >= self.trigger_frames:
                judgment = self._make_judgment(roi_results)
                self.last_judgment = judgment
                self._judgment_time = time.time()
                # AI トリガーモードは DETECTING を経由しないので、サイクル開始は
                # 判定時刻として扱う（cycle_ms ≒ 0、inspection_ms ≒ 0）
                if self._cycle_start_time is None:
                    self._cycle_start_time = self._judgment_time
                self.state = InspectionState.JUDGED
                self._ai_trigger_count = 0
                self.count_total += 1
                if judgment["overall_judgment"].upper() == "OK":
                    self.count_ok += 1
                else:
                    self.count_ng += 1
                self._save_counters()
                self._build_judgment_event(judgment)
                counters = self._get_counters_internal()
                return {"state": "judged", "trigger_mode": "ai",
                        "counters": counters, **diag, **judgment}

            return {"state": "idle", "trigger_mode": "ai", "counters": counters,
                    "trigger_count": self._ai_trigger_count,
                    "trigger_required": self.trigger_frames, **diag}

        # 非IDLE: 取出し検知のみ (_process_frame_unified_internal に委譲)
        if bg_match is None:
            result = {"state": self.state.value, "trigger_mode": "ai",
                      "counters": counters, **diag}
            if self.last_judgment:
                result.update(self.last_judgment)
            return result

        result = self._process_frame_unified_internal({}, bg_match, 0.0, None)
        result["trigger_mode"] = "ai"
        return result

    # ── 旧APIとの互換 ────────────────────────────────────

    def process_frame(self, match_scores, roi_results=None):
        """旧テンプレートモード互換。統一モードにフォワード。"""
        return self.process_frame_unified(match_scores, bg_match=None, frame_diff=0.0,
                                          roi_results=roi_results)

    def process_frame_background(self, bg_match, frame_diff, roi_results=None):
        """旧背景差分モード互換。統一モードにフォワード。"""
        return self.process_frame_unified({}, bg_match=bg_match, frame_diff=frame_diff,
                                          roi_results=roi_results)

    def manual_trigger(self, roi_results: list[dict]) -> dict:
        """手動トリガー（デバッグ/テスト用）。"""
        with self._lock:
            if self.state != InspectionState.IDLE:
                return {"state": self.state.value, "trigger_mode": "manual",
                        "counters": self._get_counters_internal(),
                        "error": "取出しを完了してからトリガーしてください"}

            judgment = self._make_judgment(roi_results)
            self.last_judgment = judgment
            self._judgment_time = time.time()
            # 手動モードは DETECTING を経由しないので、サイクル開始は判定時刻
            self._cycle_start_time = self._judgment_time
            self.state = InspectionState.JUDGED

            self.count_total += 1
            if judgment["overall_judgment"].upper() == "OK":
                self.count_ok += 1
            else:
                self.count_ng += 1
            self._save_counters()
            self._build_judgment_event(judgment)

            return {"state": "judged", "trigger_mode": "manual",
                    "counters": self._get_counters_internal(), **judgment}

    # ── カウンター ────────────────────────────────────────

    def _load_counters(self):
        if not self._counter_file or not os.path.exists(self._counter_file):
            self.count_total = self.count_ok = self.count_ng = 0
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
        with self._lock:
            return self._get_counters_internal()

    def _get_counters_internal(self) -> dict:
        """ロック取得済みの状態で呼ぶこと。"""
        result = {"total": self.count_total, "ok": self.count_ok, "ng": self.count_ng}
        if self.pieces_per_box > 0:
            result["pieces_per_box"] = self.pieces_per_box
            result["completed_boxes"] = self.count_ok // self.pieces_per_box
            result["current_box_progress"] = self.count_ok % self.pieces_per_box
        return result

    def reset_counters(self):
        with self._lock:
            self.count_total = self.count_ok = self.count_ng = 0
            self._save_counters()

    def reset(self):
        with self._lock:
            self._reset_internal()

    def _reset_internal(self):
        """ロック取得済みの状態で呼ぶこと。"""
        self.state = InspectionState.IDLE
        self._trigger_count = 0
        self._removal_count = 0
        self._stability_count = 0
        self._ai_trigger_count = 0
        self.last_judgment = None
        self._judgment_time = None
        self._cycle_start_time = None
        self._current_box_id = None
        self._box_started_at = None
        self._pending_event = None
        self._pending_box = None

    # ── サイクル/箱イベント生成ヘルパー ─────────────────

    @staticmethod
    def _ts_iso() -> str:
        return datetime.datetime.now().isoformat(timespec="milliseconds")

    def _build_judgment_event(self, judgment: dict) -> None:
        """JUDGED 遷移時に呼ぶ。_pending_event と _pending_box を構築する。
        ロック取得済み前提。"""
        is_ok = judgment.get("overall_judgment", "").upper() == "OK"
        cycle_start = self._cycle_start_time
        judgment_time = self._judgment_time or time.time()
        inspection_ms = (
            int((judgment_time - cycle_start) * 1000)
            if cycle_start is not None else None
        )

        # 箱割り当て
        box_id: str | None = None
        box_seq: int | None = None
        pieces = self.pieces_per_box if self.pieces_per_box > 0 else None
        if is_ok and pieces:
            if self._current_box_id is None:
                self._current_box_id = uuid.uuid4().hex
                self._box_started_at = cycle_start if cycle_start is not None else judgment_time
            box_id = self._current_box_id
            # count_ok は既にこの判定で +1 されている
            box_seq = ((self.count_ok - 1) % pieces) + 1

        self._pending_event = {
            "id": uuid.uuid4().hex,
            "ts": self._ts_iso(),
            "result": "OK" if is_ok else "NG",
            "confidence": judgment.get("overall_confidence"),
            "inspection_ms": inspection_ms,
            "box_id": box_id,
            "box_seq": box_seq,
            "pieces_per_box": pieces,
        }

        # 箱完成検出
        if is_ok and pieces and self.count_ok % pieces == 0:
            box_started = self._box_started_at or judgment_time
            self._pending_box = {
                "id": self._current_box_id or uuid.uuid4().hex,
                "started_at": datetime.datetime.fromtimestamp(box_started).isoformat(timespec="milliseconds"),
                "completed_at": self._ts_iso(),
                "pieces_per_box": pieces,
                "box_duration_ms": int((time.time() - box_started) * 1000),
            }
            # 次の箱に向けてリセット
            self._current_box_id = None
            self._box_started_at = None

    def _attach_cycle_outputs(self, result: dict) -> dict:
        """IDLE 復帰時に呼ぶ。pending イベントを result dict に乗せて返す。
        ロック取得済み前提。"""
        if self._pending_event:
            ev = dict(self._pending_event)
            if self._cycle_start_time is not None:
                ev["cycle_ms"] = int((time.time() - self._cycle_start_time) * 1000)
            else:
                ev["cycle_ms"] = ev.get("inspection_ms")
            result["_event"] = ev
            self._pending_event = None
        if self._pending_box:
            result["_box_event"] = dict(self._pending_box)
            self._pending_box = None
        self._cycle_start_time = None
        return result

    # ── 判定ロジック ──────────────────────────────────────

    def _make_judgment(self, roi_results: list[dict]) -> dict:
        overall_ok = True
        min_confidence = 1.0
        clean_results = []

        for r in roi_results:
            if "error" in r:
                overall_ok = False
                clean_results.append(r)
                continue

            is_ok = r.get("judgment", "ng") == "ok"
            if not is_ok:
                overall_ok = False
            min_confidence = min(min_confidence, r["confidence"])

            clean_results.append({
                "roi_id": r["roi_id"],
                "roi_name": r["roi_name"],
                "judgment": "OK" if is_ok else "NG",
                "predicted_class": r["predicted_class"],
                "confidence": r["confidence"],
                "probabilities": r.get("probabilities", {}),
            })

        return {
            "overall_judgment": "OK" if overall_ok else "NG",
            "overall_confidence": round(min_confidence, 4),
            "roi_results": clean_results,
        }


state_machine = InspectionStateMachine()
