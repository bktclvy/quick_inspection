"""秤設定ファイル (scale_config.json) の読み書き。"""
import os
import json
import config

# A&D HC-6Ki: 9600bps / 7bit / Even parity / 1 stop bit (7E1)
DEFAULT_SCALE_CONFIG: dict = {
    "port": "",
    "baudrate": 9600,
    "data_bits": 7,
    "parity": "E",
    "stop_bits": 1,
    "read_timeout_ms": 500,
    "stability_timeout_ms": 3000,
    "tare_command": "Z\r\n",
    "enabled": False,
}

_PATH = os.path.join(config.BASE_DIR, "scale_config.json")


def config_path() -> str:
    return _PATH


def load() -> dict:
    try:
        with open(_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return {**DEFAULT_SCALE_CONFIG, **data}
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(DEFAULT_SCALE_CONFIG)


def save(cfg: dict) -> None:
    tmp = _PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _PATH)
