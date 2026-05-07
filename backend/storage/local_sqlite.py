"""ローカル SQLite バックエンド (モード A: スタンドアロン)。

すべての操作は自 PC の data/inspections.db に対して実行される。
"""
import datetime
from backend import db
from backend.storage.base import StorageBackend


def _row_to_worker(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "code": row["code"],
        "active": bool(row["active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_event(row) -> dict:
    return {
        "id": row["id"],
        "ts": row["ts"],
        "pc_id": row["pc_id"],
        "pc_label": row["pc_label"],
        "worker_id": row["worker_id"],
        "worker_name": row["worker_name"],
        "product_id": row["product_id"],
        "product_name": row["product_name"],
        "result": row["result"],
        "confidence": row["confidence"],
        "cycle_ms": row["cycle_ms"],
        "inspection_ms": row["inspection_ms"],
        "box_seq": row["box_seq"],
        "box_id": row["box_id"],
        "pieces_per_box": row["pieces_per_box"],
        "received_at": row["received_at"],
    }


def _row_to_box(row) -> dict:
    return {
        "id": row["id"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "pc_id": row["pc_id"],
        "pc_label": row["pc_label"],
        "worker_id": row["worker_id"],
        "worker_name": row["worker_name"],
        "product_id": row["product_id"],
        "product_name": row["product_name"],
        "pieces_per_box": row["pieces_per_box"],
        "box_duration_ms": row["box_duration_ms"],
        "received_at": row["received_at"],
    }


class LocalSqliteBackend(StorageBackend):

    # ── workers ─────────────────────────────────────────

    def list_workers(self, active_only: bool = True) -> list[dict]:
        conn = db.get_conn()
        sql = "SELECT * FROM workers"
        if active_only:
            sql += " WHERE active=1"
        sql += " ORDER BY name"
        rows = conn.execute(sql).fetchall()
        return [_row_to_worker(r) for r in rows]

    def get_worker(self, worker_id: str) -> dict | None:
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
        return _row_to_worker(row) if row else None

    def save_worker(self, worker: dict) -> dict:
        conn = db.get_conn()
        now = datetime.datetime.now().isoformat(timespec="seconds")
        wid = worker["id"]
        with db.write_lock():
            existing = conn.execute("SELECT id FROM workers WHERE id=?", (wid,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE workers SET name=?, code=?, active=?, updated_at=? WHERE id=?",
                    (
                        worker["name"],
                        worker.get("code"),
                        1 if worker.get("active", True) else 0,
                        now,
                        wid,
                    ),
                )
            else:
                conn.execute(
                    "INSERT INTO workers (id, name, code, active, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        wid,
                        worker["name"],
                        worker.get("code"),
                        1 if worker.get("active", True) else 0,
                        worker.get("created_at", now),
                        now,
                    ),
                )
        result = self.get_worker(wid)
        assert result is not None
        return result

    def delete_worker(self, worker_id: str) -> bool:
        conn = db.get_conn()
        with db.write_lock():
            cur = conn.execute("DELETE FROM workers WHERE id=?", (worker_id,))
            return cur.rowcount > 0

    # ── events ─────────────────────────────────────────

    def record_event(self, event: dict) -> bool:
        conn = db.get_conn()
        with db.write_lock():
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO events "
                    "(id, ts, pc_id, pc_label, worker_id, worker_name, product_id, product_name, "
                    " result, confidence, cycle_ms, inspection_ms, box_seq, box_id, pieces_per_box) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        event["id"],
                        event["ts"],
                        event["pc_id"],
                        event.get("pc_label"),
                        event.get("worker_id"),
                        event.get("worker_name"),
                        event["product_id"],
                        event.get("product_name"),
                        event["result"],
                        event.get("confidence"),
                        event.get("cycle_ms"),
                        event.get("inspection_ms"),
                        event.get("box_seq"),
                        event.get("box_id"),
                        event.get("pieces_per_box"),
                    ),
                )
                return True
            except Exception:
                return False

    def record_box(self, box: dict) -> bool:
        conn = db.get_conn()
        with db.write_lock():
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO boxes "
                    "(id, started_at, completed_at, pc_id, pc_label, worker_id, worker_name, "
                    " product_id, product_name, pieces_per_box, box_duration_ms) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        box["id"],
                        box["started_at"],
                        box["completed_at"],
                        box["pc_id"],
                        box.get("pc_label"),
                        box.get("worker_id"),
                        box.get("worker_name"),
                        box["product_id"],
                        box.get("product_name"),
                        box["pieces_per_box"],
                        box["box_duration_ms"],
                    ),
                )
                return True
            except Exception:
                return False

    def query_events(self, filters: dict, limit: int = 1000, offset: int = 0) -> list[dict]:
        conn = db.get_conn()
        sql, params = _build_event_query(filters)
        sql += f" ORDER BY ts DESC LIMIT {int(limit)} OFFSET {int(offset)}"
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_event(r) for r in rows]

    def query_boxes(self, filters: dict, limit: int = 1000, offset: int = 0) -> list[dict]:
        conn = db.get_conn()
        sql, params = _build_box_query(filters)
        sql += f" ORDER BY completed_at DESC LIMIT {int(limit)} OFFSET {int(offset)}"
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_box(r) for r in rows]


def _build_event_query(filters: dict) -> tuple[str, list]:
    conds: list[str] = []
    params: list = []
    if filters.get("from"):
        conds.append("ts >= ?")
        params.append(filters["from"])
    if filters.get("to"):
        conds.append("ts <= ?")
        params.append(filters["to"])
    if filters.get("worker_id"):
        conds.append("worker_id = ?")
        params.append(filters["worker_id"])
    if filters.get("product_id"):
        conds.append("product_id = ?")
        params.append(filters["product_id"])
    if filters.get("pc_id"):
        conds.append("pc_id = ?")
        params.append(filters["pc_id"])
    sql = "SELECT * FROM events"
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    return sql, params


def _build_box_query(filters: dict) -> tuple[str, list]:
    conds: list[str] = []
    params: list = []
    if filters.get("from"):
        conds.append("completed_at >= ?")
        params.append(filters["from"])
    if filters.get("to"):
        conds.append("completed_at <= ?")
        params.append(filters["to"])
    if filters.get("worker_id"):
        conds.append("worker_id = ?")
        params.append(filters["worker_id"])
    if filters.get("product_id"):
        conds.append("product_id = ?")
        params.append(filters["product_id"])
    if filters.get("pc_id"):
        conds.append("pc_id = ?")
        params.append(filters["pc_id"])
    sql = "SELECT * FROM boxes"
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    return sql, params
