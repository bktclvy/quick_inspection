"""StorageBackend 抽象クラス定義。

各同期モードはこのインターフェースを実装する。
"""
from abc import ABC, abstractmethod


class StorageBackend(ABC):
    """作業者マスタ + 検査イベントログのストレージ抽象。"""

    # ── 作業者マスタ ────────────────────────────────────

    @abstractmethod
    def list_workers(self, active_only: bool = True) -> list[dict]:
        ...

    @abstractmethod
    def get_worker(self, worker_id: str) -> dict | None:
        ...

    @abstractmethod
    def save_worker(self, worker: dict) -> dict:
        """新規追加または更新（id があれば update、なければ create）。
        返り値は保存後の worker dict。"""
        ...

    @abstractmethod
    def delete_worker(self, worker_id: str) -> bool:
        ...

    # ── イベントログ ────────────────────────────────────

    @abstractmethod
    def record_event(self, event: dict) -> bool:
        """検査イベント 1 件を記録。冪等（id 重複は無視）。"""
        ...

    @abstractmethod
    def record_box(self, box: dict) -> bool:
        """箱完成 1 件を記録。冪等。"""
        ...

    @abstractmethod
    def query_events(self, filters: dict, limit: int = 1000, offset: int = 0) -> list[dict]:
        ...

    @abstractmethod
    def query_boxes(self, filters: dict, limit: int = 1000, offset: int = 0) -> list[dict]:
        ...

    # ── ヘルスチェック ──────────────────────────────────

    def is_remote_alive(self) -> bool:
        """リモート（マスタ役 PC や共有フォルダ）が到達可能かどうか。
        スタンドアロンモードは常に True。"""
        return True
