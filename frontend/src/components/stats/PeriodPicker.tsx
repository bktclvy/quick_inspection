/**
 * 期間ピッカー — 統計画面で「いつのデータを見るか」を選ぶ
 *
 * 設計のポイント:
 *   ・カレンダーが主役。生産日が一目で分かる（数字を大きく表示 + ヒートマップ背景）
 *   ・非生産日は薄く、視覚的に区別
 *   ・クイックプリセット: 今日 / 昨日 / 今週 / 先週 / 今月 / 先月 / 全期間
 *   ・1日クリックで単日選択。もう1日クリックで範囲選択（順序自動補正）
 *   ・「選択を確定」を押すまで親に反映しない（誤操作防止）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { statsApi } from '@/api/stats'
import type { DaySummary } from '@/api/stats'

export interface Period {
  // ISO datetime, undefined for "全期間"
  from?: string
  to?: string
  label: string  // 表示用 ("今日 4/28" "今週" "4/20 - 4/26" 等)
}

interface Props {
  productId: string
  workerId?: string
  period: Period
  onChange: (p: Period) => void
}

export function PeriodPicker({ productId, workerId, period, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // ポップオーバー位置を計算（右端/下端で溢れないようフリップ）
  const updatePos = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const POPOVER_W = 460
    const POPOVER_H = 540
    const MARGIN = 12

    // 水平: 通常はボタン左揃え。右に溢れるならボタンの右端に揃える
    let left = r.left
    if (left + POPOVER_W > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, r.right - POPOVER_W)
    }
    if (left < MARGIN) left = MARGIN

    // 垂直: 通常はボタン下。下に溢れるならボタン上に開く
    let top = r.bottom + 8
    if (top + POPOVER_H > window.innerHeight - MARGIN) {
      const upward = r.top - POPOVER_H - 8
      top = upward >= MARGIN ? upward : Math.max(MARGIN, window.innerHeight - POPOVER_H - MARGIN)
    }

    setPos({ top, left })
  }

  useEffect(() => {
    if (!open) return
    updatePos()
    const onResize = () => updatePos()
    const onScroll = () => updatePos()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)  // capture: スクロール可能な祖先も拾う
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // ESC キーで閉じる
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          height: 38, padding: '0 14px',
          fontSize: 13, fontWeight: 700,
          fontFamily: "'DM Sans', system-ui, sans-serif", color: '#1a1625',
          background: '#ffffff', border: '1.5px solid #e8e4df', borderRadius: 10,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c7494" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {period.label}
        <span style={{ color: '#b0a9bc', fontSize: 11 }}>▼</span>
      </button>

      {open && pos && createPortal(
        <PickerPopover
          productId={productId}
          workerId={workerId}
          period={period}
          pos={pos}
          onClose={() => setOpen(false)}
          onApply={(p) => { onChange(p); setOpen(false) }}
        />,
        document.body,
      )}
    </>
  )
}

/* ─── ポップオーバー本体 ─────────────────────────────── */

function PickerPopover({ productId, workerId, period, pos, onClose, onApply }: {
  productId: string
  workerId?: string
  period: Period
  pos: { top: number; left: number }
  onClose: () => void
  onApply: (p: Period) => void
}) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const [viewMonth, setViewMonth] = useState(() => {
    const base = period.from ? new Date(period.from) : today
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const [draftStart, setDraftStart] = useState<Date | null>(period.from ? startOfDay(new Date(period.from)) : null)
  const [draftEnd,   setDraftEnd]   = useState<Date | null>(period.to ? startOfDay(new Date(period.to)) : null)
  const [hoverDate,  setHoverDate]  = useState<Date | null>(null)

  // カレンダー範囲データ（その月＋前後を含む）
  const [days, setDays] = useState<Map<string, DaySummary>>(new Map())
  useEffect(() => {
    const from = new Date(viewMonth)
    from.setDate(1); from.setMonth(from.getMonth() - 1)
    const to = new Date(viewMonth)
    to.setMonth(to.getMonth() + 2); to.setDate(0)
    statsApi.calendar({
      product_id: productId,
      from_: ymd(from),
      to: ymd(to) + 'T23:59:59',
      worker_id: workerId || undefined,
    }).then((r) => {
      const m = new Map<string, DaySummary>()
      for (const d of r.days) m.set(d.date, d)
      setDays(m)
    }).catch(() => setDays(new Map()))
  }, [productId, viewMonth, workerId])

  // 月変更
  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))

  // クイックプリセット
  const setPreset = (preset: PresetId) => {
    const p = makePreset(preset, today)
    setDraftStart(p.from ?? null)
    setDraftEnd(p.to ?? null)
    if (p.from) setViewMonth(new Date(p.from.getFullYear(), p.from.getMonth(), 1))
  }

  // 日クリック
  const onDayClick = (d: Date) => {
    if (!draftStart || (draftStart && draftEnd)) {
      // 新規 or リセット
      setDraftStart(d); setDraftEnd(null)
    } else {
      // 終点を決める。順序を補正
      if (d < draftStart) {
        setDraftEnd(draftStart); setDraftStart(d)
      } else if (sameDay(d, draftStart)) {
        // 同じ日 → 単日選択
        setDraftEnd(d)
      } else {
        setDraftEnd(d)
      }
    }
  }

  const apply = () => {
    if (!draftStart) {
      onApply({ label: '全期間' })
      return
    }
    const start = draftStart
    const end = draftEnd ?? draftStart
    onApply({
      from: start.toISOString(),
      to: endOfDay(end).toISOString(),
      label: makeLabel(start, end, today),
    })
  }

  const clear = () => {
    setDraftStart(null); setDraftEnd(null)
  }

  // ヒートマップの最大箱数（その月のうち）
  const maxBoxCount = useMemo(() => {
    let mx = 0
    days.forEach((d) => { if (d.box_count > mx) mx = d.box_count })
    return mx
  }, [days])

  // セル描画
  const monthCells = buildMonthCells(viewMonth)

  return (
    <>
      {/* 背景クリックで閉じる */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'transparent',
      }} />

      <div style={{
        position: 'fixed', top: pos.top, left: pos.left,
        zIndex: 9999, width: 460,
        background: '#ffffff', borderRadius: 16,
        boxShadow: '0 16px 40px rgba(0,0,0,0.16), 0 4px 12px rgba(0,0,0,0.08)',
        border: '1px solid #ebe7e2',
        overflow: 'hidden',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        animation: 'popIn 0.18s ease',
      }}>
        {/* クイックプリセット */}
        <div style={{ padding: 14, borderBottom: '1px solid #f0ede9', background: '#faf9f7' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'all'] as PresetId[]).map((id) => (
              <button key={id} onClick={() => setPreset(id)} style={presetBtnStyle}>
                {PRESET_LABEL[id]}
              </button>
            ))}
          </div>
        </div>

        {/* 月ナビ */}
        <div style={{
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button onClick={prevMonth} style={navBtnStyle} title="前の月">◀</button>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1a1625' }}>
            {viewMonth.getFullYear()} 年 {viewMonth.getMonth() + 1} 月
          </div>
          <button onClick={nextMonth} style={navBtnStyle} title="次の月">▶</button>
        </div>

        {/* カレンダー */}
        <div style={{ padding: '0 12px 12px' }}>
          {/* 曜日ヘッダー */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
            {['月', '火', '水', '木', '金', '土', '日'].map((w, i) => (
              <div key={w} style={{
                fontSize: 10, fontWeight: 700, textAlign: 'center',
                color: i === 5 ? '#3b82f6' : i === 6 ? '#ef4444' : '#9994a8',
                letterSpacing: '0.04em',
              }}>{w}</div>
            ))}
          </div>

          {/* 日セル */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {monthCells.map(({ date, inMonth }, i) => (
              <DayCell
                key={i}
                date={date}
                inMonth={inMonth}
                isToday={sameDay(date, today)}
                summary={days.get(ymd(date))}
                maxBoxCount={maxBoxCount}
                draftStart={draftStart}
                draftEnd={draftEnd}
                hoverDate={hoverDate}
                onClick={() => onDayClick(date)}
                onHover={(h) => setHoverDate(h ? date : null)}
              />
            ))}
          </div>
        </div>

        {/* 選択中の表示 */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid #f0ede9',
          background: '#faf9f7',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 13, color: '#5c5470',
        }}>
          <div>
            {!draftStart ? (
              <span style={{ color: '#9994a8' }}>期間を選んでください</span>
            ) : draftEnd && !sameDay(draftStart, draftEnd) ? (
              <>
                <strong style={{ color: '#1a1625' }}>{ymdJp(draftStart)}</strong>
                <span style={{ margin: '0 6px', color: '#b0a9bc' }}>〜</span>
                <strong style={{ color: '#1a1625' }}>{ymdJp(draftEnd)}</strong>
                <span style={{ marginLeft: 6, color: '#9994a8' }}>
                  ({Math.round((draftEnd.getTime() - draftStart.getTime()) / 86400000) + 1}日間)
                </span>
              </>
            ) : (
              <strong style={{ color: '#1a1625' }}>{ymdJp(draftStart)}</strong>
            )}
          </div>
          <button onClick={clear} style={{
            fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
            color: '#9994a8', background: 'transparent',
            border: 'none', cursor: 'pointer',
          }}>クリア</button>
        </div>

        {/* アクション */}
        <div style={{ padding: 12, display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={cancelBtnStyle}>キャンセル</button>
          <button onClick={apply} disabled={false} style={applyBtnStyle}>選択を確定</button>
        </div>

        <style>{`
          @keyframes popIn { from { opacity: 0; transform: translateY(-6px); }
                              to { opacity: 1; transform: translateY(0); } }
        `}</style>
      </div>
    </>
  )
}

/* ─── 日セル ─────────────────────────────────────────── */

function DayCell({ date, inMonth, isToday, summary, maxBoxCount, draftStart, draftEnd, hoverDate, onClick, onHover }: {
  date: Date
  inMonth: boolean
  isToday: boolean
  summary?: DaySummary
  maxBoxCount: number
  draftStart: Date | null
  draftEnd: Date | null
  hoverDate: Date | null
  onClick: () => void
  onHover: (hover: boolean) => void
}) {
  const hasData = !!summary && summary.box_count > 0
  const intensity = hasData && maxBoxCount > 0 ? summary!.box_count / maxBoxCount : 0

  // 選択範囲判定
  const inRange = (() => {
    if (!draftStart) return false
    if (draftStart && !draftEnd) {
      // 範囲確定中：ホバー位置を仮の終点として表示
      if (hoverDate && hoverDate.getTime() !== draftStart.getTime()) {
        const lo = hoverDate < draftStart ? hoverDate : draftStart
        const hi = hoverDate < draftStart ? draftStart : hoverDate
        return date >= startOfDay(lo) && date <= startOfDay(hi)
      }
      return sameDay(date, draftStart)
    }
    return draftEnd && date >= draftStart && date <= draftEnd
  })()
  const isStart = draftStart && sameDay(date, draftStart)
  const isEnd   = draftEnd && sameDay(date, draftEnd)

  // 背景色（ヒートマップ）
  let heatBg = 'transparent'
  if (hasData) {
    // 紫グラデーション: 薄い→濃い
    const alpha = 0.10 + intensity * 0.55
    heatBg = `linear-gradient(135deg, rgba(99, 102, 241, ${alpha}), rgba(139, 92, 246, ${alpha + 0.1}))`
  }

  // セルスタイル
  const baseBg = inRange ? '#eef2ff' : (hasData ? '#fff' : '#fafaf8')
  const showSelection = isStart || isEnd

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      title={summary ? `${summary.box_count}箱 / ${summary.total}判定 / OK率 ${summary.ok_rate ? (summary.ok_rate*100).toFixed(1) + '%' : '—'}` : ''}
      style={{
        position: 'relative',
        height: 56,
        border: 'none',
        borderRadius: 10,
        padding: 0,
        cursor: 'pointer',
        background: baseBg,
        opacity: inMonth ? 1 : 0.32,
        outline: showSelection ? '2px solid #6366f1' : (isToday ? '2px solid #cbd5e1' : 'none'),
        outlineOffset: -2,
        boxShadow: showSelection ? '0 4px 12px rgba(99,102,241,0.3)' : 'none',
        fontFamily: 'inherit',
        overflow: 'hidden',
        transition: 'transform 0.1s ease, box-shadow 0.15s ease',
        transform: showSelection ? 'scale(1.02)' : 'scale(1)',
      }}
    >
      {/* ヒートマップ背景 */}
      {hasData && (
        <div style={{
          position: 'absolute', inset: 0,
          background: heatBg,
          pointerEvents: 'none',
        }} />
      )}

      {/* 日付 */}
      <div style={{
        position: 'absolute', top: 4, left: 6,
        fontSize: 10, fontWeight: 700,
        color: hasData ? '#3d3654' : '#9994a8',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {date.getDate()}
      </div>

      {/* 今日マーク */}
      {isToday && (
        <div style={{
          position: 'absolute', top: 4, right: 6,
          fontSize: 8, fontWeight: 800, color: '#6366f1',
          letterSpacing: '0.04em',
        }}>
          今日
        </div>
      )}

      {/* 箱数（中央に大きく） */}
      {hasData && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            fontSize: 18, fontWeight: 800,
            color: showSelection ? '#1a1625' : '#1a1625',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            textShadow: '0 0 1px rgba(255,255,255,0.5)',
            lineHeight: 1,
          }}>
            {summary!.box_count}
          </div>
        </div>
      )}

      {/* 単位 (生産日にだけ薄く下に) */}
      {hasData && (
        <div style={{
          position: 'absolute', bottom: 4, right: 6,
          fontSize: 8, fontWeight: 700, color: '#7c7494',
          opacity: 0.8,
        }}>
          箱
        </div>
      )}
    </button>
  )
}

/* ─── プリセット ─────────────────────────────────────── */

type PresetId = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'all'

const PRESET_LABEL: Record<PresetId, string> = {
  today: '今日',
  yesterday: '昨日',
  this_week: '今週',
  last_week: '先週',
  this_month: '今月',
  last_month: '先月',
  all: '全期間',
}

function makePreset(id: PresetId, today: Date): { from?: Date; to?: Date } {
  const t = startOfDay(today)
  if (id === 'today') return { from: t, to: t }
  if (id === 'yesterday') {
    const y = new Date(t); y.setDate(y.getDate() - 1)
    return { from: y, to: y }
  }
  if (id === 'this_week') {
    const start = startOfWeek(t)
    return { from: start, to: t }
  }
  if (id === 'last_week') {
    const thisStart = startOfWeek(t)
    const lastStart = new Date(thisStart); lastStart.setDate(lastStart.getDate() - 7)
    const lastEnd   = new Date(thisStart); lastEnd.setDate(lastEnd.getDate() - 1)
    return { from: lastStart, to: lastEnd }
  }
  if (id === 'this_month') {
    const start = new Date(t.getFullYear(), t.getMonth(), 1)
    return { from: start, to: t }
  }
  if (id === 'last_month') {
    const start = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    const end = new Date(t.getFullYear(), t.getMonth(), 0)
    return { from: start, to: end }
  }
  return {} // 全期間
}

/* ─── 日付ヘルパー ────────────────────────────────────── */

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}
function endOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x
}
function startOfWeek(d: Date): Date {
  // 月曜始まり
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7  // 月=0, 火=1, ... 日=6
  x.setDate(x.getDate() - dow)
  return x
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
}
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}
function ymdJp(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
function makeLabel(start: Date, end: Date, today: Date): string {
  if (sameDay(start, end)) {
    if (sameDay(start, today)) return `今日 ${start.getMonth()+1}/${start.getDate()}`
    const yest = new Date(today); yest.setDate(yest.getDate() - 1)
    if (sameDay(start, yest)) return `昨日 ${start.getMonth()+1}/${start.getDate()}`
    return `${start.getFullYear()}/${start.getMonth()+1}/${start.getDate()}`
  }
  // 範囲
  return `${start.getMonth()+1}/${start.getDate()} 〜 ${end.getMonth()+1}/${end.getDate()}`
}

function buildMonthCells(viewMonth: Date): Array<{ date: Date; inMonth: boolean }> {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const last = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0)
  const startOffset = (first.getDay() + 6) % 7  // 月曜始まり
  const cells: Array<{ date: Date; inMonth: boolean }> = []
  // 前月
  for (let i = startOffset; i > 0; i--) {
    const d = new Date(first); d.setDate(d.getDate() - i)
    cells.push({ date: d, inMonth: false })
  }
  // 当月
  for (let i = 0; i < last.getDate(); i++) {
    const d = new Date(first); d.setDate(d.getDate() + i)
    cells.push({ date: d, inMonth: true })
  }
  // 翌月（6行 = 42セル になるまで）
  while (cells.length < 42) {
    const lastCell = cells[cells.length - 1].date
    const d = new Date(lastCell); d.setDate(d.getDate() + 1)
    cells.push({ date: d, inMonth: false })
  }
  return cells
}

/* ─── スタイル ──────────────────────────────────────── */

const presetBtnStyle: React.CSSProperties = {
  height: 30, padding: '0 12px',
  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  background: '#ffffff', border: '1.5px solid #e8e4df',
  borderRadius: 8, color: '#3d3654', cursor: 'pointer',
}

const navBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  border: 'none', background: '#f3f1ee', cursor: 'pointer',
  fontSize: 11, fontWeight: 700, color: '#5c5470',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const cancelBtnStyle: React.CSSProperties = {
  flex: 1, height: 38,
  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: '#ffffff', border: '1.5px solid #e8e4df',
  borderRadius: 10, color: '#5c5470', cursor: 'pointer',
}

const applyBtnStyle: React.CSSProperties = {
  flex: 2, height: 38,
  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
  background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
  border: 'none', borderRadius: 10, color: '#ffffff', cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
}
