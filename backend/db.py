"""SQLite 接続管理と初期スキーマ作成。

WAL モード + autocommit + 単一接続 + write 排他ロックで運用する。
スキーマは workers / events / boxes の 3 テーブル。
"""
import os
import sqlite3
import threading
import config

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()
_write_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS workers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    code        TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workers_active ON workers(active);

CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,
    ts              TEXT NOT NULL,
    pc_id           TEXT NOT NULL,
    pc_label        TEXT,
    worker_id       TEXT,
    worker_name     TEXT,
    product_id      TEXT NOT NULL,
    product_name    TEXT,
    result          TEXT NOT NULL,
    confidence      REAL,
    cycle_ms        INTEGER,
    inspection_ms   INTEGER,
    box_seq         INTEGER,
    box_id          TEXT,
    pieces_per_box  INTEGER,
    received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_worker_ts ON events(worker_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_product_ts ON events(product_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_pc_ts ON events(pc_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_box ON events(box_id);

CREATE TABLE IF NOT EXISTS boxes (
    id              TEXT PRIMARY KEY,
    started_at      TEXT NOT NULL,
    completed_at    TEXT NOT NULL,
    pc_id           TEXT NOT NULL,
    pc_label        TEXT,
    worker_id       TEXT,
    worker_name     TEXT,
    product_id      TEXT NOT NULL,
    product_name    TEXT,
    pieces_per_box  INTEGER NOT NULL,
    box_duration_ms INTEGER NOT NULL,
    received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boxes_completed ON boxes(completed_at);
CREATE INDEX IF NOT EXISTS idx_boxes_worker ON boxes(worker_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_boxes_product ON boxes(product_id, completed_at);
"""


def get_conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            os.makedirs(config.DATA_DIR, exist_ok=True)
            _conn = sqlite3.connect(
                config.INSPECTIONS_DB_PATH,
                check_same_thread=False,
                isolation_level=None,
            )
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA foreign_keys=ON")
            _conn.execute("PRAGMA synchronous=NORMAL")
        return _conn


def write_lock() -> threading.Lock:
    return _write_lock


def init_db() -> None:
    conn = get_conn()
    with _write_lock:
        conn.executescript(_SCHEMA)


def close_db() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            try:
                _conn.close()
            except sqlite3.Error:
                pass
            _conn = None
