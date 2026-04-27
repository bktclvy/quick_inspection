"""箱単位の員数ログ (JSONL) 書き込み。"""
import os
import json
import logging
from datetime import datetime
from backend.product import product_manager

log = logging.getLogger("box_log")


def append_box_log(product_id: str, entry: dict) -> None:
    """products/<folder>/box_log/YYYY-MM-DD.jsonl に 1 行追記する。"""
    try:
        product_dir = os.path.dirname(product_manager.counter_file(product_id))
        log_dir = os.path.join(product_dir, "box_log")
        os.makedirs(log_dir, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        log_path = os.path.join(log_dir, f"{date_str}.jsonl")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        log.error("箱ログ書き込みエラー: %s", e)
