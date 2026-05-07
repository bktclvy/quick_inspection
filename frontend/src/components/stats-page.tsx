import { useEffect, useMemo, useState } from 'react'
import { statsApi } from '@/api/stats'
import type { ProductSummary, WorkerEntry, BoxRow } from '@/api/stats'
import { useAppStore } from '@/stores/appStore'
import { useWorkerStore } from '@/stores/workerStore'
import { PeriodPicker } from '@/components/stats/PeriodPicker'
import type { Period } from '@/components/stats/PeriodPicker'

const STATS_PRODUCT_KEY = 'quick_inspection.stats_product_id'
const STATS_WORKER_KEY  = 'quick_inspection.stats_worker_id'
const STATS_PERIOD_KEY  = 'quick_inspection.stats_period'

function defaultPeriod(): Period {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today); end.setHours(23, 59, 59, 999)
  return {
    from: today.toISOString(),
    to: end.toISOString(),
    label: `今日 ${today.getMonth() + 1}/${today.getDate()}`,
  }
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function fmtPct(rate: number | null): string {
  if (rate == null) return '—'
  return `${(rate * 100).toFixed(1)} %`
}

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch { return iso }
}

export function StatsPage() {
  const products      = useAppStore((s) => s.products)
  const workers       = useWorkerStore((s) => s.workers)
  const loadProducts  = useAppStore((s) => s.loadProducts)
  const loadWorkers   = useWorkerStore((s) => s.loadWorkers)

  const [productId, setProductId] = useState<string>(() => {
    try { return localStorage.getItem(STATS_PRODUCT_KEY) ?? '' } catch { return '' }
  })
  const [workerId, setWorkerId] = useState<string>(() => {
    try { return localStorage.getItem(STATS_WORKER_KEY) ?? '' } catch { return '' }
  })
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const raw = localStorage.getItem(STATS_PERIOD_KEY)
      if (raw) return JSON.parse(raw) as Period
    } catch { /* ignore */ }
    return defaultPeriod()
  })

  const [summary, setSummary] = useState<ProductSummary | null>(null)
  const [workersData, setWorkersData] = useState<WorkerEntry[]>([])
  const [boxes, setBoxes] = useState<BoxRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadProducts().catch(() => {})
    loadWorkers().catch(() => {})
  }, [loadProducts, loadWorkers])

  // 製品リストが読み込まれたら、選択がなければ最初の製品を選ぶ
  useEffect(() => {
    if (!productId && products.length > 0) {
      setProductId(products[0].id)
    }
  }, [products, productId])

  // 作業者リストが読み込まれたら、選択がない/無効なら最初の作業者を選ぶ
  useEffect(() => {
    if (workers.length === 0) return
    if (!workerId || !workers.find((w) => w.id === workerId)) {
      setWorkerId(workers[0].id)
    }
  }, [workers, workerId])

  useEffect(() => {
    try {
      if (productId) localStorage.setItem(STATS_PRODUCT_KEY, productId)
    } catch { /* ignore */ }
  }, [productId])

  useEffect(() => {
    try {
      if (workerId) localStorage.setItem(STATS_WORKER_KEY, workerId)
    } catch { /* ignore */ }
  }, [workerId])

  useEffect(() => {
    try { localStorage.setItem(STATS_PERIOD_KEY, JSON.stringify(period)) } catch { /* ignore */ }
  }, [period])

  const filters = useMemo(() => ({
    product_id: productId,
    from_: period.from,
    to: period.to,
    worker_id: workerId || undefined,
  }), [productId, period, workerId])

  const ready = !!productId && !!workerId

  useEffect(() => {
    if (!ready) return
    setLoading(true)
    Promise.all([
      statsApi.summary(filters),
      statsApi.byWorker({ product_id: productId, from_: period.from, to: period.to }),
      statsApi.boxes({ ...filters, limit: 100 }),
    ]).then(([s, w, b]) => {
      setSummary(s)
      setWorkersData(w.workers)
      setBoxes(b.boxes)
    }).catch(() => {
      setSummary(null); setWorkersData([]); setBoxes([])
    }).finally(() => setLoading(false))
  }, [filters, productId, period, ready])

  const productName = products.find((p) => p.id === productId)?.name ?? productId
  const workerName  = workers.find((w) => w.id === workerId)?.name ?? ''

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: '#f7f5f2',
      padding: '24px 32px',
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1625', margin: '0 0 4px' }}>
          統計
        </h1>
        <p style={{ fontSize: 13, color: '#9994a8', margin: '0 0 20px' }}>
          製品別の生産速度・作業者ごとの実績
        </p>

        {/* フィルタバー */}
        <div style={{
          ...card,
          display: 'flex', flexWrap: 'wrap', gap: 16,
          alignItems: 'flex-end', marginBottom: 16,
        }}>
          <FilterBlock label="製品（必須）">
            <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{
              ...selectStyle, minWidth: 200,
              border: productId ? '1.5px solid #e8e4df' : '1.5px solid #fca5a5',
            }}>
              <option value="">— 選択してください —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FilterBlock>

          <FilterBlock label="期間">
            {ready ? (
              <PeriodPicker productId={productId} workerId={workerId} period={period} onChange={setPeriod} />
            ) : (
              <div style={{ height: 38, padding: '0 14px',
                            display: 'flex', alignItems: 'center',
                            fontSize: 13, color: '#9994a8',
                            background: '#f3f1ee', borderRadius: 10, border: '1.5px solid #ebe7e2' }}>
                製品と作業者を先に選択
              </div>
            )}
          </FilterBlock>

          <FilterBlock label="作業者（必須）">
            <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}
                    style={{ ...selectStyle, minWidth: 160,
                             border: workerId ? '1.5px solid #e8e4df' : '1.5px solid #fca5a5' }}>
              <option value="">— 選択してください —</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </FilterBlock>

          <div style={{ flex: 1 }} />

          {ready && (
            <a
              href={statsApi.boxesCsvUrl(filters)}
              style={{
                height: 38, padding: '0 18px',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                background: '#fff', border: '1.5px solid #e8e4df',
                borderRadius: 10, color: '#5c5470',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                textDecoration: 'none',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              CSV出力
            </a>
          )}
        </div>

        {!ready ? (
          <div style={{ ...card, padding: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#7c7494' }}>
              {workers.length === 0
                ? '作業者がまだ登録されていません。「設定 → 作業者マスタ」から追加してください。'
                : '製品と作業者を選択すると、統計が表示されます。'}
            </div>
          </div>
        ) : (
          <>
            {/* 数字サマリ */}
            <div style={{ ...card, marginBottom: 16 }}>
              <h2 style={cardTitle}>
                {workerName} <span style={{ color: '#9994a8', fontWeight: 600 }}>×</span> {productName}
                <span style={{ color: '#9994a8', fontWeight: 600, marginLeft: 8 }}>（{period.label}）</span>
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 14, marginTop: 4,
              }}>
                <Metric label="平均 1 箱時間" value={fmtDuration(summary?.avg_box_duration_ms)} accent="primary" big />
                <Metric label="中央値" value={fmtDuration(summary?.median_box_duration_ms)} />
                <Metric label="最速" value={fmtDuration(summary?.min_box_duration_ms)} accent="success" />
                <Metric label="最遅" value={fmtDuration(summary?.max_box_duration_ms)} accent="warn" />
                <Metric label="完成箱数" value={`${summary?.completed_boxes ?? 0} 箱`} />
                <Metric label="総判定" value={`${summary?.total ?? 0} 件`} />
                <Metric label="OK 率" value={fmtPct(summary?.ok_rate ?? null)} accent="success" />
              </div>
            </div>

            {/* 1箱完成時間（箱ごとの棒グラフ） */}
            {boxes.length > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <h2 style={cardTitle}>1箱ごとの完成時間</h2>
                <p style={{ fontSize: 12, color: '#7c7494', margin: '0 0 14px' }}>
                  左から完成順（古い→新しい）。ぴょこっと飛び出てる棒が外れ値です。
                </p>
                <BoxDurationBars
                  boxes={boxes}
                  median={summary?.median_box_duration_ms ?? null}
                  avg={summary?.avg_box_duration_ms ?? null}
                />
              </div>
            )}

            {/* 作業者別 */}
            <div style={{ ...card, marginBottom: 16 }}>
              <h2 style={cardTitle}>作業者別の実績（同一製品下）</h2>
              {workersData.length === 0 ? (
                <p style={emptyText}>{loading ? '読み込み中…' : 'まだ作業者ごとの記録がありません。'}</p>
              ) : (
                <WorkerBars rows={workersData} />
              )}
            </div>

            {/* 完成箱履歴 */}
            <div style={card}>
              <h2 style={cardTitle}>完成箱の履歴</h2>
              {boxes.length === 0 ? (
                <p style={emptyText}>{loading ? '読み込み中…' : 'まだ完成した箱がありません。'}</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1.5px solid #ebe7e2' }}>
                      <th style={th}>完成日時</th>
                      <th style={{ ...th, textAlign: 'left' }}>作業者</th>
                      <th style={th}>個数</th>
                      <th style={th}>かかった時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boxes.map((b) => (
                      <tr key={b.id} style={{ borderBottom: '1px solid #f0ede9' }}>
                        <td style={td}>{fmtDateTime(b.completed_at)}</td>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: '#1a1625' }}>
                          {b.worker_name ?? '—'}
                        </td>
                        <td style={td}>{b.pieces_per_box} 個</td>
                        <td style={{ ...td, fontWeight: 700, color: '#1a1625',
                                     fontFamily: "'JetBrains Mono', monospace" }}>
                          {fmtDuration(b.box_duration_ms)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── 1箱ごとの完成時間 棒グラフ ─────────────────── */

function BoxDurationBars({ boxes, median, avg }: {
  boxes: BoxRow[]; median: number | null; avg: number | null
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [mouse, setMouse]       = useState<{ x: number; y: number } | null>(null)

  if (boxes.length === 0) return null

  // 完成順（古い→新しい）に並べ替え
  const sorted = [...boxes].sort((a, b) => a.completed_at.localeCompare(b.completed_at))
  const durations = sorted.map((b) => b.box_duration_ms)
  const maxMs = Math.max(...durations)

  // Y軸の目盛り
  const niceSteps = [10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_200_000]
  const rawStep = maxMs / 5
  const step = niceSteps.find((s) => s >= rawStep) ?? niceSteps[niceSteps.length - 1]
  const yMax = Math.ceil(maxMs / step) * step
  const gridLines: number[] = []
  for (let v = step; v <= yMax; v += step) gridLines.push(v)

  const fmt = (ms: number): string => {
    const s = Math.round(ms / 1000)
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const barColor = (ms: number, hovered: boolean) => {
    if (avg && ms >= avg * 1.3) {
      return hovered
        ? 'linear-gradient(180deg, #fdba74, #c2410c)'
        : 'linear-gradient(180deg, #fb923c, #ea580c)'
    }
    return hovered
      ? 'linear-gradient(180deg, #a5b4fc, #4f46e5)'
      : 'linear-gradient(180deg, #818cf8, #6366f1)'
  }

  const containerHeight = 240

  return (
    <div>
      {/* 凡例 + 統計値 */}
      <div style={{ display: 'flex', gap: 18, fontSize: 11, color: '#7c7494', marginBottom: 10,
                    flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, background: '#6366f1', borderRadius: 2 }} />
          通常
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, background: '#ea580c', borderRadius: 2 }} />
          外れ値（平均の1.3倍以上）
        </span>
        {median != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 18, height: 0, borderTop: '2px dashed #10b981' }} />
            中央値 {fmt(median)}
          </span>
        )}
        {avg != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 18, height: 0, borderTop: '2px dashed #f59e0b' }} />
            平均 {fmt(avg)}
          </span>
        )}
      </div>

      {/* グラフ本体 */}
      <div style={{ display: 'flex', gap: 8, position: 'relative' }} data-chart-root>

        {/* Y軸ラベル */}
        <div style={{ width: 44, height: containerHeight, position: 'relative', flexShrink: 0 }}>
          {gridLines.map((v) => {
            const topPct = 100 - (v / yMax) * 100
            return (
              <div key={v} style={{
                position: 'absolute', top: `${topPct}%`, right: 6,
                transform: 'translateY(-50%)',
                fontSize: 10, color: '#9994a8',
                fontFamily: "'JetBrains Mono', monospace",
              }}>{fmt(v)}</div>
            )
          })}
          <div style={{
            position: 'absolute', bottom: -4, right: 6,
            fontSize: 10, color: '#9994a8',
            fontFamily: "'JetBrains Mono', monospace",
          }}>0:00</div>
        </div>

        {/* プロットエリア */}
        <div
          style={{
            flex: 1, position: 'relative', height: containerHeight,
            borderLeft: '1.5px solid #ebe7e2', borderBottom: '1.5px solid #ebe7e2',
          }}
          onMouseLeave={() => { setHoverIdx(null); setMouse(null) }}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top })
          }}
        >
          {/* グリッドライン */}
          {gridLines.map((v) => (
            <div key={v} style={{
              position: 'absolute',
              top: `${100 - (v / yMax) * 100}%`, left: 0, right: 0,
              borderTop: '1px dashed #f0ede9',
              pointerEvents: 'none',
            }} />
          ))}

          {/* 中央値ライン */}
          {median != null && (
            <DashedLine top={100 - (median / yMax) * 100} color="#10b981" label={`中央値 ${fmt(median)}`} />
          )}

          {/* 平均ライン */}
          {avg != null && (
            <DashedLine top={100 - (avg / yMax) * 100} color="#f59e0b" label={`平均 ${fmt(avg)}`} />
          )}

          {/* マウスのY位置に追従する横線クロスヘア + 値ラベル */}
          {mouse && (() => {
            const yRatio = 1 - mouse.y / containerHeight
            const yValueMs = Math.max(0, yRatio * yMax)
            return (
              <>
                <div style={{
                  position: 'absolute',
                  left: 0, right: 0,
                  top: mouse.y,
                  borderTop: '1px dashed #6366f1',
                  pointerEvents: 'none', zIndex: 4,
                }} />
                <div style={{
                  position: 'absolute',
                  left: -50, top: mouse.y,
                  transform: 'translateY(-50%)',
                  background: '#6366f1', color: '#fff',
                  fontSize: 10, fontWeight: 700,
                  padding: '2px 6px', borderRadius: 4,
                  fontFamily: "'JetBrains Mono', monospace",
                  pointerEvents: 'none', zIndex: 5,
                  whiteSpace: 'nowrap',
                }}>{fmt(yValueMs)}</div>
              </>
            )
          })()}

          {/* バー */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'flex-end',
            gap: Math.min(4, Math.max(1, Math.floor(40 / sorted.length))),
            padding: '0 2px',
          }}>
            {sorted.map((b, i) => {
              const heightPct = (b.box_duration_ms / yMax) * 100
              const hovered = hoverIdx === i
              return (
                <div
                  key={b.id}
                  onMouseEnter={() => setHoverIdx(i)}
                  title={`${fmtDateTimeShort(b.completed_at)} ${b.worker_name ?? ''} — ${fmt(b.box_duration_ms)}`}
                  style={{
                    flex: 1,
                    minWidth: 3,
                    maxWidth: 40,
                    height: `${heightPct}%`,
                    background: barColor(b.box_duration_ms, hovered),
                    borderRadius: '3px 3px 0 0',
                    cursor: 'pointer',
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* X軸ラベル */}
      <div style={{
        marginLeft: 52, marginTop: 6,
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: '#9994a8',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span>{fmtDateTimeShort(sorted[0].completed_at)}</span>
        <span style={{ color: '#b0a9bc' }}>← 完成順 →</span>
        {sorted.length > 1 && (
          <span>{fmtDateTimeShort(sorted[sorted.length - 1].completed_at)}</span>
        )}
      </div>
    </div>
  )
}

function DashedLine({ top, color, label }: { top: number; color: string; label: string }) {
  return (
    <>
      <div style={{
        position: 'absolute', top: `${top}%`, left: 0, right: 0,
        borderTop: `2px dashed ${color}`,
        pointerEvents: 'none', zIndex: 2,
      }} />
      <div style={{
        position: 'absolute', top: `${top}%`, right: 6,
        transform: 'translateY(-50%)',
        background: color, color: '#fff',
        fontSize: 10, fontWeight: 700,
        padding: '2px 6px', borderRadius: 4,
        fontFamily: "'JetBrains Mono', monospace",
        pointerEvents: 'none', zIndex: 3,
        whiteSpace: 'nowrap',
      }}>{label}</div>
    </>
  )
}


function fmtDateTimeShort(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch { return iso }
}

/* ─── 作業者別バー ─────────────────── */

function WorkerBars({ rows }: { rows: WorkerEntry[] }) {
  const maxMs = Math.max(...rows.map((r) => r.avg_box_duration_ms ?? 0), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
      {rows.map((w) => {
        const pct = w.avg_box_duration_ms ? (w.avg_box_duration_ms / maxMs) * 100 : 0
        return (
          <div key={w.worker_id} style={{ display: 'grid',
                                          gridTemplateColumns: '180px 1fr 80px 120px 80px',
                                          alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1625',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {w.worker_name}
            </div>
            <div style={{ height: 22, background: '#f3f1ee', borderRadius: 6, position: 'relative' }}>
              {w.avg_box_duration_ms != null && (
                <div style={{
                  height: '100%', borderRadius: 6,
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  paddingRight: 8,
                  fontSize: 11, fontWeight: 700, color: '#fff',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {fmtDuration(w.avg_box_duration_ms)}
                </div>
              )}
              {w.avg_box_duration_ms == null && (
                <div style={{ padding: '4px 10px', fontSize: 11, color: '#9994a8' }}>
                  完成箱なし
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#5c5470', textAlign: 'right' }}>
              {w.completed_boxes} 箱
            </div>
            <div style={{ fontSize: 12, color: '#5c5470', textAlign: 'right' }}>
              {w.total} 判定
            </div>
            <div style={{ fontSize: 12, color: '#5c5470', textAlign: 'right',
                          fontFamily: "'JetBrains Mono', monospace" }}>
              {fmtPct(w.ok_rate)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── 共通 ─────────────────────── */

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 10, fontWeight: 700, color: '#9994a8',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
      }}>{label}</label>
      {children}
    </div>
  )
}

function Metric({ label, value, accent, big }: {
  label: string; value: string; accent?: 'primary' | 'success' | 'warn'; big?: boolean
}) {
  const color = accent === 'primary' ? '#6366f1'
              : accent === 'success' ? '#059669'
              : accent === 'warn'    ? '#ea580c'
              : '#1a1625'
  return (
    <div style={{
      padding: '12px 14px',
      background: '#faf9f7', borderRadius: 10,
      border: '1px solid #f0ede9',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9994a8',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: big ? 26 : 18, fontWeight: 800,
        color, lineHeight: 1.1,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {value}
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: 14,
  padding: '18px 22px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  border: '1px solid #f0ede9',
}

const cardTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 800, color: '#1a1625', margin: '0 0 14px',
}

const emptyText: React.CSSProperties = {
  fontSize: 13, color: '#9994a8', textAlign: 'center', margin: '24px 0',
}

const selectStyle: React.CSSProperties = {
  height: 34, padding: '0 28px 0 12px',
  fontSize: 13, fontWeight: 500, fontFamily: 'inherit', color: '#1a1625',
  background: '#fff', border: '1.5px solid #e8e4df', borderRadius: 10,
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
  cursor: 'pointer', outline: 'none', minWidth: 130,
}

const th: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 11, fontWeight: 700, color: '#7c7494',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  textAlign: 'center',
}

const td: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13, color: '#3d3654',
  textAlign: 'center',
}
