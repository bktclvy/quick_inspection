"""アプリケーション全体の設定 (app_config.json) の読み書き。

mode / pc_id / pc_label / master_url / shared_path / クラウド同期パス を保持。
PC ID は初回読み込み時に UUID で自動生成・保存される。
"""
import os
import json
import uuid
import config

# 同期モード
MODE_STANDALONE = "standalone"
MODE_SHARED_FOLDER = "shared_folder"
MODE_CLOUD_SYNC = "cloud_sync"
MODE_MASTER = "master"
MODE_CLIENT = "client"

VALID_MODES = {MODE_STANDALONE, MODE_SHARED_FOLDER, MODE_CLOUD_SYNC, MODE_MASTER, MODE_CLIENT}

DEFAULT_APP_CONFIG: dict = {
    "mode": MODE_STANDALONE,
    "pc_id": "",
    "pc_label": "",
    "master_url": "",
    "shared_path": "",
    "cloud_sync_path": "",
    "flush_interval_sec": 5,
    "health_timeout_sec": 2,
}


def _generate_pc_id() -> str:
    return f"pc_{uuid.uuid4().hex[:8]}"


def load() -> dict:
    """app_config.json を読み込む。pc_id が未設定なら自動生成して保存する。"""
    cfg = dict(DEFAULT_APP_CONFIG)
    try:
        with open(config.APP_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        cfg.update(data)
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    # mode の正規化
    if cfg.get("mode") not in VALID_MODES:
        cfg["mode"] = MODE_STANDALONE

    # PC ID 自動生成
    if not cfg.get("pc_id"):
        cfg["pc_id"] = _generate_pc_id()
        save(cfg)

    return cfg


def save(cfg: dict) -> None:
    merged = {**DEFAULT_APP_CONFIG, **cfg}
    if merged.get("mode") not in VALID_MODES:
        merged["mode"] = MODE_STANDALONE
    tmp = config.APP_CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
    os.replace(tmp, config.APP_CONFIG_PATH)


def update(updates: dict) -> dict:
    """部分更新して保存。マージ後の設定を返す。"""
    cfg = load()
    cfg.update(updates)
    save(cfg)
    return cfg
