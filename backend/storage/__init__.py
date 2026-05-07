"""ストレージバックエンド: 同期モードごとに作業者マスタとイベントログの読み書きを抽象化する。"""
from backend.storage.base import StorageBackend
from backend.storage.factory import get_backend

__all__ = ["StorageBackend", "get_backend"]
