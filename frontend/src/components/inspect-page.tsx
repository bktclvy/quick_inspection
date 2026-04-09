/**
 * Inspection Page — Soft Geometric
 *
 * The core experience. Camera feed + real-time judgment.
 * Layout: Camera (left), instrument panel (right).
 */

import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { useInspectionWS } from '@/hooks/useInspectionWS'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { useKeyboard } from '@/hooks/useKeyboard'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ROICanvas } from '@/components/camera/ROICanvas'
import type { InspectionState } from '@/types/ws'
// types used inline

export function InspectPage() {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const rois             = useAppStore((s) => s.rois)
  const productId        = useAppStore((s) => s.selectedProductId)
  const inspecting       = useInspectionStore((s) => s.inspecting)
  const state            = useInspectionStore((s) => s.currentState)
  const judgment         = useInspectionStore((s) => s.overallJudgment)
  const confidence       = useInspectionStore((s) => s.overallConfidence)
  const counters         = useInspectionStore((s) => s.counters)
  const roiResults       = useInspectionStore((s) => s.roiResults)
  const history          = useInspectionStore((s) => s.history)
  const triggerMode      = useInspectionStore((s) => s.triggerMode)
  const bgDiff           = useInspectionStore((s) => s.bgDiff)
  const frameDiff        = useInspectionStore((s) => s.frameDiff)
  const stabCount        = useInspectionStore((s) => s.stabilityCount)
  const stabReq          = useInspectionStore((s) => s.stabilityRequired)
  const trigCount        = useInspectionStore((s) => s.triggerCount)
  const trigReq          = useInspectionStore((s) => s.triggerRequired)
  const remainMs         = useInspectionStore((s) => s.remainingMs)
  const checkStatus      = useInspectionStore((s) => s.checkStatus)
  const loadCounters     = useInspectionStore((s) => s.loadCounters)
  const resetCounters    = useInspectionStore((s) => s.resetCounters)

  const { send } = useInspectionWS()
  const { play } = useAudioFeedback()

  useEffect(() => { checkStatus() }, [checkStatus])
  useEffect(() => { if (productId) loadCounters(productId) }, [productId, loadCounters])
  useEffect(() => {
    if (state === 'judged' && judgment) play(judgment === 'OK' ? 'ok' : 'ng')
  }, [state, judgment, play])

  const manual = useCallback(() => {
    if (inspecting && triggerMode === 'manual') send({ action: 'manual_trigger' })
  }, [inspecting, triggerMode, send])
  useKeyboard('Space', manual, inspecting && triggerMode === 'manual')

  const vs = visualState(state, judgment)
  const showRoi = (state === 'judged' || state === 'waiting_removal') && roiResults.length > 0

  let statusText = ''
  if (state === 'detecting') {
    statusText = triggerMode === 'auto_background'
      ? `安定 ${stabCount}/${stabReq}` : `トリガー ${trigCount}/${trigReq}`
  } else if (state === 'idle' && triggerMode === 'auto_background' && bgDiff != null) {
    statusText = `Δ ${bgDiff.toFixed(1)} | ${frameDiff.toFixed(1)}`
  } else if (state === 'waiting_removal') {
    statusText = `取出し ${(remainMs / 1000).toFixed(1)}s`
  }

  return (
    <div style={{
      height: '100%', display: 'flex', gap: 16, padding: 16,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      background: '#f7f5f2',
    }}>

      {/* ═══ Camera ═══ */}
      <div style={{
        flex: 1, minWidth: 0,
        position: 'relative',
        borderRadius: 20, overflow: 'hidden',
        background: '#0c1218',
        boxShadow: '0 4px 32px rgba(0,0,0,0.12)',
        border: '1px solid rgba(0,0,0,0.08)',
      }}>
        <CameraFeed onImgRef={setImgEl} />
        <ROICanvas imgEl={imgEl} rois={rois} readOnly />
      </div>

      {/* ═══ Panel ═══ */}
      <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>

        {/* ── Counters ── */}
        <div style={{
          background: '#fff', borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
            {[
              { v: counters.total, l: 'TOTAL', c: '#1a1625' },
              { v: counters.ok,    l: 'OK',    c: '#059669' },
              { v: counters.ng,    l: 'NG',    c: '#dc2626' },
            ].map((item, i) => (
              <div key={item.l} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '20px 12px',
                borderLeft: i > 0 ? '1px solid #f0ede9' : 'none',
              }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 32, fontWeight: 800, color: item.c,
                  lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                }}>
                  {item.v}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
                  color: '#b0a9bc', textTransform: 'uppercase', marginTop: 8,
                }}>
                  {item.l}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => productId && resetCounters(productId)}
            style={{
              width: '100%', padding: '7px 0',
              fontSize: 11, fontWeight: 600, color: '#b0a9bc',
              background: 'none', border: 'none', borderTop: '1px solid #f0ede9',
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#b0a9bc' }}
          >
            カウンターリセット
          </button>
        </div>

        {/* ── Judgment ── */}
        <div style={{
          borderRadius: 20, padding: '48px 24px', textAlign: 'center',
          position: 'relative', overflow: 'hidden',
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          ...(vs === 'idle' ? {
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
          } : vs === 'detecting' ? {
            background: 'linear-gradient(180deg, #fffbeb 0%, #fff 60%)',
            boxShadow: '0 0 0 2px #f59e0b, 0 4px 20px rgba(245,158,11,0.15)',
          } : vs === 'ok' ? {
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            boxShadow: '0 0 0 2px #059669, 0 8px 40px rgba(5,150,105,0.4)',
            animation: 'jPop 0.4s cubic-bezier(0.16,1,0.3,1)',
          } : vs === 'ng' ? {
            background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
            boxShadow: '0 0 0 2px #dc2626, 0 8px 40px rgba(220,38,38,0.45)',
            animation: 'jShake 0.4s ease, jPop 0.4s cubic-bezier(0.16,1,0.3,1)',
          } : {
            background: '#fff', opacity: 0.7,
            boxShadow: '0 0 0 2px #f59e0b, 0 4px 16px rgba(245,158,11,0.1)',
          }),
        }}>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: (vs === 'ok' || vs === 'ng') ? 'rgba(255,255,255,0.6)' :
                   vs === 'detecting' ? '#b45309' : '#b0a9bc',
          }}>
            {LABELS[state]}
          </p>

          <p style={{
            marginTop: 8,
            fontSize: vs === 'ok' || vs === 'ng' ? 88 : 72,
            fontWeight: 900, lineHeight: 1, letterSpacing: '-0.04em',
            color: (vs === 'ok' || vs === 'ng') ? '#fff' :
                   vs === 'detecting' ? '#d97706' : '#e0dcd7',
            ...(vs === 'detecting' ? { animation: 'pulse 1.2s ease-in-out infinite' } : {}),
          }}>
            {vs === 'ok' ? 'OK' : vs === 'ng' ? 'NG' : vs === 'detecting' ? '···' : 'IDLE'}
          </p>

          {state === 'judged' && confidence != null && (
            <p style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 28, fontWeight: 700, marginTop: 12,
              color: (vs === 'ok' || vs === 'ng') ? 'rgba(255,255,255,0.85)' : '#7c7494',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {(confidence * 100).toFixed(1)}
              <span style={{ fontSize: 16, marginLeft: 2 }}>%</span>
            </p>
          )}

          {statusText && (
            <p style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13, marginTop: 8, fontVariantNumeric: 'tabular-nums',
              color: (vs === 'ok' || vs === 'ng') ? 'rgba(255,255,255,0.5)' : '#b0a9bc',
            }}>
              {statusText}
            </p>
          )}
        </div>

        {/* ── ROI Results ── */}
        {showRoi && (
          <Panel title="ROI 結果">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {roiResults.map((r) => (
                <div key={r.roi_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 10,
                  background: r.judgment === 'ok' ? '#ecfdf5' : '#fef2f2',
                  border: `1px solid ${r.judgment === 'ok' ? '#d1fae5' : '#fee2e2'}`,
                }}>
                  <JudgeBadge j={r.judgment} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1625' }}>
                    {r.roi_name}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    color: r.judgment === 'ok' ? '#059669' : '#dc2626',
                  }}>
                    {(r.confidence * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── History ── */}
        <Panel title="判定履歴" style={{ flex: 1, minHeight: 0 }}>
          {history.length === 0 ? (
            <p style={{ fontSize: 13, color: '#ccc8d4', textAlign: 'center', padding: '32px 0' }}>
              判定を待っています
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'auto', maxHeight: 300 }}>
              {history.map((e, i) => (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 12px', borderRadius: 8,
                  background: '#faf9f7',
                  ...(i < 3 ? { animation: `fadeUp 0.25s ${i * 60}ms both ease` } : {}),
                }}>
                  <JudgeBadge j={e.judgment} />
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12, fontWeight: 600, color: '#7c7494',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {(e.confidence * 100).toFixed(1)}%
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, color: '#ccc8d4', marginLeft: 'auto',
                  }}>
                    {e.timestamp.toLocaleTimeString('ja-JP', { hour12: false })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <style>{`
        @keyframes jPop { 0% { transform: scale(.93); } 60% { transform: scale(1.02); } 100% { transform: scale(1); } }
        @keyframes jShake { 0%,100% { transform: translateX(0); } 15% { transform: translateX(-7px); } 30% { transform: translateX(7px); } 45% { transform: translateX(-4px); } 60% { transform: translateX(4px); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

/* ── Sub-components ── */

function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
      display: 'flex', flexDirection: 'column',
      ...style,
    }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid #f0ede9', flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#7c7494', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {title}
        </span>
      </div>
      <div style={{ padding: '12px 18px', flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  )
}

function JudgeBadge({ j }: { j: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
      padding: '2px 7px', borderRadius: 5, color: '#fff', lineHeight: '1.4',
      background: j === 'ok' ? '#10b981' : '#ef4444',
    }}>
      {j.toUpperCase()}
    </span>
  )
}

/* ── Helpers ── */

const LABELS: Record<InspectionState, string> = {
  idle: '待機中', detecting: '検知中', inspecting: '推論中',
  judged: '判定完了', waiting_removal: '取出し待ち',
}

function visualState(s: InspectionState, j: 'OK' | 'NG' | null) {
  if (s === 'judged' && j) return j.toLowerCase() as 'ok' | 'ng'
  if (s === 'detecting' || s === 'inspecting') return 'detecting' as const
  if (s === 'waiting_removal') return 'waiting' as const
  return 'idle' as const
}
