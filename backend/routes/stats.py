"""統計集計 REST エンドポイント。

統計は **製品を1つ指定する前提**。製品横断の集計は意味がないので提供しない。
- summary: その製品の数字（平均1箱時間、中央値、最速、最遅、箱数、総判定、OK率）
- by-worker: その製品を担当した作業者別の数字（同一製品なので比較可能）
- boxes:   完成箱の履歴（生データ、フィルタ可、CSV出力用）
"""
import csv
import datetime
import io
import statistics
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from backend import db

router = APIRouter()


def _build_where(filters: dict, ts_col: str, require_product: bool = True) -> tuple[str, list]:
    conds: list[str] = []
    params: list = []
    if require_product:
        if not filters.get("product_id"):
            raise HTTPException(400, "product_id は必須です")
        conds.append("product_id = ?")
        params.append(filters["product_id"])
    elif filters.get("product_id"):
        conds.append("product_id = ?")
        params.append(filters["product_id"])
    if filters.get("from"):
        conds.append(f"{ts_col} >= ?")
        params.append(filters["from"])
    if filters.get("to"):
        conds.append(f"{ts_col} <= ?")
        params.append(filters["to"])
    if filters.get("worker_id"):
        conds.append("worker_id = ?")
        params.append(filters["worker_id"])
    if filters.get("pc_id"):
        conds.append("pc_id = ?")
        params.append(filters["pc_id"])
    where = " WHERE " + " AND ".join(conds) if conds else ""
    return where, params


@router.get("/stats/summary")
async def summary(
    product_id: str,
    from_: str | None = None,
    to: str | None = None,
    worker_id: str | None = None,
    pc_id: str | None = None,
):
    """製品単位のサマリ。product_id 必須。"""
    filters = {"product_id": product_id, "from": from_, "to": to,
               "worker_id": worker_id, "pc_id": pc_id}
    conn = db.get_conn()

    # events: 総判定数 / OK率
    where_ev, params_ev = _build_where(filters, ts_col="ts")
    row = conn.execute(
        f"SELECT COUNT(*) AS total, "
        f"  SUM(CASE WHEN result='OK' THEN 1 ELSE 0 END) AS ok_count "
        f"FROM events{where_ev}",
        params_ev,
    ).fetchone()
    total = row["total"] or 0
    ok_count = row["ok_count"] or 0
    ok_rate = (ok_count / total) if total > 0 else None

    # boxes: 1箱完成時間の集計
    where_bx, params_bx = _build_where(filters, ts_col="completed_at")
    box_durations = [
        r["box_duration_ms"]
        for r in conn.execute(
            f"SELECT box_duration_ms FROM boxes{where_bx} ORDER BY completed_at DESC",
            params_bx,
        ).fetchall()
    ]
    completed_boxes = len(box_durations)
    if box_durations:
        avg_box_ms = int(statistics.mean(box_durations))
        median_box_ms = int(statistics.median(box_durations))
        min_box_ms = min(box_durations)
        max_box_ms = max(box_durations)
    else:
        avg_box_ms = median_box_ms = min_box_ms = max_box_ms = None

    return {
        "product_id": product_id,
        "total": total,
        "ok": ok_count,
        "ng": total - ok_count,
        "ok_rate": ok_rate,
        "completed_boxes": completed_boxes,
        "avg_box_duration_ms": avg_box_ms,
        "median_box_duration_ms": median_box_ms,
        "min_box_duration_ms": min_box_ms,
        "max_box_duration_ms": max_box_ms,
        "box_durations_ms": box_durations,  # ヒストグラム描画用（昇順ソート前）
    }


@router.get("/stats/by-worker")
async def by_worker(
    product_id: str,
    from_: str | None = None,
    to: str | None = None,
    pc_id: str | None = None,
):
    """製品を絞った上での作業者別実績。同一製品下なので比較可能。"""
    filters = {"product_id": product_id, "from": from_, "to": to,
               "worker_id": None, "pc_id": pc_id}
    conn = db.get_conn()

    # boxes 集計（worker_id ごと）
    where_bx, params_bx = _build_where(filters, ts_col="completed_at")
    box_by_worker: dict[str, dict] = {}
    for r in conn.execute(
        f"SELECT worker_id, worker_name, box_duration_ms FROM boxes{where_bx} "
        f"AND worker_id IS NOT NULL"
        if where_bx else
        f"SELECT worker_id, worker_name, box_duration_ms FROM boxes "
        f"WHERE worker_id IS NOT NULL",
        params_bx,
    ).fetchall():
        wid = r["worker_id"]
        if wid not in box_by_worker:
            box_by_worker[wid] = {
                "worker_id": wid,
                "worker_name": r["worker_name"],
                "box_durations": [],
            }
        box_by_worker[wid]["box_durations"].append(r["box_duration_ms"])

    # events 集計（worker_id ごと）
    where_ev, params_ev = _build_where(filters, ts_col="ts")
    ev_by_worker: dict[str, dict] = {}
    for r in conn.execute(
        f"SELECT worker_id, COUNT(*) AS total, "
        f"  SUM(CASE WHEN result='OK' THEN 1 ELSE 0 END) AS ok_count "
        f"FROM events{where_ev} AND worker_id IS NOT NULL "
        f"GROUP BY worker_id"
        if where_ev else
        f"SELECT worker_id, COUNT(*) AS total, "
        f"  SUM(CASE WHEN result='OK' THEN 1 ELSE 0 END) AS ok_count "
        f"FROM events WHERE worker_id IS NOT NULL "
        f"GROUP BY worker_id",
        params_ev,
    ).fetchall():
        ev_by_worker[r["worker_id"]] = {"total": r["total"], "ok": r["ok_count"] or 0}

    # 統合
    workers: list[dict] = []
    for wid, b in box_by_worker.items():
        durations = b["box_durations"]
        avg_ms = int(statistics.mean(durations)) if durations else None
        median_ms = int(statistics.median(durations)) if durations else None
        ev = ev_by_worker.get(wid, {"total": 0, "ok": 0})
        ok_rate = (ev["ok"] / ev["total"]) if ev["total"] > 0 else None
        workers.append({
            "worker_id": wid,
            "worker_name": b["worker_name"],
            "completed_boxes": len(durations),
            "avg_box_duration_ms": avg_ms,
            "median_box_duration_ms": median_ms,
            "total": ev["total"],
            "ok": ev["ok"],
            "ok_rate": ok_rate,
        })
    # 完成箱がないが判定はある作業者も含める
    for wid, ev in ev_by_worker.items():
        if wid in box_by_worker:
            continue
        # worker name を boxes/events から取れない場合 workers テーブルから引く
        wn_row = conn.execute("SELECT name FROM workers WHERE id=?", (wid,)).fetchone()
        ok_rate = (ev["ok"] / ev["total"]) if ev["total"] > 0 else None
        workers.append({
            "worker_id": wid,
            "worker_name": wn_row["name"] if wn_row else wid,
            "completed_boxes": 0,
            "avg_box_duration_ms": None,
            "median_box_duration_ms": None,
            "total": ev["total"],
            "ok": ev["ok"],
            "ok_rate": ok_rate,
        })

    # 平均1箱時間が短い順（None は最後）
    workers.sort(key=lambda w: (w["avg_box_duration_ms"] is None, w["avg_box_duration_ms"] or 0))
    return {"workers": workers}


@router.get("/stats/boxes")
async def list_boxes(
    product_id: str,
    from_: str | None = None,
    to: str | None = None,
    worker_id: str | None = None,
    pc_id: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    """完成箱履歴。product_id 必須。"""
    filters = {"product_id": product_id, "from": from_, "to": to,
               "worker_id": worker_id, "pc_id": pc_id}
    conn = db.get_conn()
    where, params = _build_where(filters, ts_col="completed_at")
    rows = conn.execute(
        f"SELECT id, started_at, completed_at, worker_id, worker_name, "
        f"  product_id, product_name, pieces_per_box, box_duration_ms, pc_id, pc_label "
        f"FROM boxes{where} "
        f"ORDER BY completed_at DESC "
        f"LIMIT {int(limit)} OFFSET {int(offset)}",
        params,
    ).fetchall()
    return {
        "boxes": [
            {
                "id": r["id"],
                "started_at": r["started_at"],
                "completed_at": r["completed_at"],
                "worker_id": r["worker_id"],
                "worker_name": r["worker_name"],
                "product_id": r["product_id"],
                "product_name": r["product_name"],
                "pieces_per_box": r["pieces_per_box"],
                "box_duration_ms": r["box_duration_ms"],
                "pc_id": r["pc_id"],
                "pc_label": r["pc_label"],
            }
            for r in rows
        ]
    }


@router.get("/stats/calendar")
async def calendar(
    product_id: str,
    from_: str,
    to: str,
    worker_id: str | None = None,
    pc_id: str | None = None,
):
    """カレンダーピッカー用の日別サマリ。
    from_ / to は YYYY-MM-DD 形式（その日の00:00から翌日00:00まで）。
    """
    filters = {"product_id": product_id, "from": from_, "to": to,
               "worker_id": worker_id, "pc_id": pc_id}
    conn = db.get_conn()

    # boxes: 日別箱数 + 平均1箱時間
    where_bx, params_bx = _build_where(filters, ts_col="completed_at")
    box_rows = conn.execute(
        f"SELECT substr(completed_at, 1, 10) AS date, "
        f"  COUNT(*) AS box_count, "
        f"  AVG(box_duration_ms) AS avg_box_ms "
        f"FROM boxes{where_bx} "
        f"GROUP BY substr(completed_at, 1, 10)",
        params_bx,
    ).fetchall()

    # events: 日別総判定 + OK数
    where_ev, params_ev = _build_where(filters, ts_col="ts")
    ev_rows = conn.execute(
        f"SELECT substr(ts, 1, 10) AS date, "
        f"  COUNT(*) AS total, "
        f"  SUM(CASE WHEN result='OK' THEN 1 ELSE 0 END) AS ok_count "
        f"FROM events{where_ev} "
        f"GROUP BY substr(ts, 1, 10)",
        params_ev,
    ).fetchall()

    by_date: dict[str, dict] = {}
    for r in box_rows:
        by_date.setdefault(r["date"], {})
        by_date[r["date"]]["box_count"] = r["box_count"]
        by_date[r["date"]]["avg_box_duration_ms"] = (
            int(r["avg_box_ms"]) if r["avg_box_ms"] is not None else None
        )
    for r in ev_rows:
        by_date.setdefault(r["date"], {})
        by_date[r["date"]]["total"] = r["total"]
        by_date[r["date"]]["ok"] = r["ok_count"] or 0

    days = []
    for date, d in by_date.items():
        total = d.get("total", 0)
        ok = d.get("ok", 0)
        days.append({
            "date": date,
            "box_count": d.get("box_count", 0),
            "avg_box_duration_ms": d.get("avg_box_duration_ms"),
            "total": total,
            "ok": ok,
            "ng": total - ok,
            "ok_rate": (ok / total) if total > 0 else None,
        })
    days.sort(key=lambda x: x["date"])
    return {"days": days}


@router.get("/stats/boxes/csv")
async def boxes_csv(
    product_id: str,
    from_: str | None = None,
    to: str | None = None,
    worker_id: str | None = None,
    pc_id: str | None = None,
):
    """完成箱履歴を CSV でダウンロード。"""
    filters = {"product_id": product_id, "from": from_, "to": to,
               "worker_id": worker_id, "pc_id": pc_id}
    conn = db.get_conn()
    where, params = _build_where(filters, ts_col="completed_at")
    rows = conn.execute(
        f"SELECT started_at, completed_at, worker_name, product_name, "
        f"  pieces_per_box, box_duration_ms, pc_label "
        f"FROM boxes{where} ORDER BY completed_at DESC",
        params,
    ).fetchall()
    out = io.StringIO()
    out.write("﻿")  # BOM for Excel
    writer = csv.writer(out)
    writer.writerow(["開始日時", "完成日時", "作業者", "製品", "個数", "所要時間(秒)", "PC"])
    for r in rows:
        sec = round((r["box_duration_ms"] or 0) / 1000, 1)
        writer.writerow([
            r["started_at"],
            r["completed_at"],
            r["worker_name"] or "",
            r["product_name"] or "",
            r["pieces_per_box"],
            sec,
            r["pc_label"] or "",
        ])
    out.seek(0)
    fname = f"boxes_{product_id}_{datetime.datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
