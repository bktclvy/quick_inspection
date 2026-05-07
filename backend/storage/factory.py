"""ストレージバックエンドのファクトリ。

app_config.json の mode に応じて実装を切り替える。
Phase 1 では LocalSqliteBackend のみ。
"""
from backend.storage.base import StorageBackend
from backend.storage.local_sqlite import LocalSqliteBackend
from backend import app_config

_backend: StorageBackend | None = None
_backend_mode: str | None = None


def get_backend() -> StorageBackend:
    """現在の app_config.mode に応じたバックエンドを返す。
    モードが変わったら新しいバックエンドを生成する。"""
    global _backend, _backend_mode
    cfg = app_config.load()
    mode = cfg.get("mode", app_config.MODE_STANDALONE)

    if _backend is not None and _backend_mode == mode:
        return _backend

    if mode in (app_config.MODE_STANDALONE, app_config.MODE_MASTER):
        _backend = LocalSqliteBackend()
    else:
        # Phase 2 で SharedFileBackend / HttpMasterBackend を実装するまでは
        # ローカル SQLite にフォールバック（送信キューはローカルで継続蓄積）
        _backend = LocalSqliteBackend()

    _backend_mode = mode
    return _backend


def reset() -> None:
    """設定変更時に呼ぶ。次回 get_backend() で再生成される。"""
    global _backend, _backend_mode
    _backend = None
    _backend_mode = None
