/**
 * Inspection Page — Soft Geometric
 *
 * The core experience. Camera feed + real-time judgment.
 * Layout: Camera (left), instrument panel (right).
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { useBoxWorkflowStore } from '@/stores/boxWorkflowStore'
import { useCalibrationStore } from '@/stores/calibrationStore'
import { useInspectionWS } from '@/hooks/useInspectionWS'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useScalePolling } from '@/hooks/useScalePolling'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ROICanvas } from '@/components/camera/ROICanvas'
import { CalibrationWizard } from '@/components/inspection/CalibrationWizard'
import { BoxWorkflowOverlay } from '@/components/inspection/BoxWorkflowOverlay'
import { BoxProgressCard } from '@/components/inspection/BoxProgressCard'
import type { Counters } from '@/types'
import type { InspectionState } from '@/types/ws'

export function InspectPage() {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const rois             = useAppStore((s) => s.rois)
  const productId        = useAppStore((s) => s.selectedProductId)
  const selectedProduct  = useAppStore((s) => s.selectedProduct)
  const inspecting       = useInspectionStore((s) => s.inspecting)
  const state            = useInspectionStore((s) => s.currentState)
  const judgment         = useInspectionStore((s) => s.overallJudgment)
  const confidence       = useInspectionStore((s) => s.overallConfidence)
  const counters         = useInspectionStore((s) => s.counters)
  const roiResults       = useInspectionStore((s) => s.roiResults)
  const triggerMode      = useInspectionStore((s) => s.triggerMode)
  const bgMatch          = useInspectionStore((s) => s.bgMatch)
  const frameDiff        = useInspectionStore((s) => s.frameDiff)
  const stabCount        = useInspectionStore((s) => s.stabilityCount)
  const stabReq          = useInspectionStore((s) => s.stabilityRequired)
  const checkStatus      = useInspectionStore((s) => s.checkStatus)
  const loadCounters     = useInspectionStore((s) => s.loadCounters)
  const resetCounters    = useInspectionStore((s) => s.resetCounters)

  const { send } = useInspectionWS()
  const { play } = useAudioFeedback()
  useScalePolling()

  useEffect(() => { checkStatus() }, [checkStatus])
  useEffect(() => { if (productId) loadCounters(productId) }, [productId, loadCounters])
  useEffect(() => {
    if (state === 'judged' && judgment) play(judgment === 'OK' ? 'ok' : 'ng')
  }, [state, judgment, play])

  const manual = useCallback(() => {
    if (!inspecting) return
    // waiting_confirm (箱完成など) は常に confirm で次へ
    if (state === 'waiting_confirm') {
      send({ action: 'confirm' })
      return
    }
    // manual モード: IDLE → 検査実行、JUDGED / WAITING_REMOVAL → 次へ (confirm)
    if (triggerMode === 'manual') {
      if (state === 'idle') send({ action: 'manual_trigger' })
      else if (state === 'judged' || state === 'waiting_removal') send({ action: 'confirm' })
    }
  }, [inspecting, state, triggerMode, send])
  // overlay (CalibrationWizard / BoxWorkflowOverlay) が出ている間は inspect-page の Space を無効化
  const calibrationOpen = useCalibrationStore((s) => s.isOpen)
  const boxPhaseOverlayShown = useBoxWorkflowStore((s) => s.phase !== 'off' && s.phase !== 'inspecting')
  const keyEnabled = inspecting && !calibrationOpen && !boxPhaseOverlayShown
  useKeyboard('Space', manual, keyEnabled)

  const vs = visualState(state, judgment)
  const hasResults = (state === 'judged' || state === 'waiting_removal' || state === 'waiting_confirm') && roiResults.length > 0
  const confirmReason = useInspectionStore((s) => s.wsData?.confirm_reason)
  const timings       = useInspectionStore((s) => s.wsData?._timings)
  const lastInferMsRef = useRef<number | null>(null)
  if (timings?.infer_ms != null) lastInferMsRef.current = timings.infer_ms
  const isManual = triggerMode === 'manual'
  const isAI = triggerMode === 'ai'

  const boxPhase = useBoxWorkflowStore((s) => s.phase)
  // When packing is active and waiting_confirm is for box_complete, the BoxWorkflowOverlay handles it
  const packingHandlesBoxComplete = boxPhase !== 'off' && state === 'waiting_confirm' && confirmReason === 'box_complete'

  let statusText = ''
  if (isManual && state === 'idle') {
    statusText = 'Space で検査'
  } else if (isAI && state === 'idle') {
    statusText = 'AI 検知中...'
  } else if (state === 'detecting') {
    statusText = `安定 ${stabCount}/${stabReq}`
  } else if (state === 'idle' && bgMatch != null) {
    statusText = `BG ${(bgMatch * 100).toFixed(0)}% | Δ${frameDiff.toFixed(1)}`
  } else if (state === 'waiting_removal') {
    statusText = bgMatch != null ? `取出し待ち BG ${(bgMatch * 100).toFixed(0)}%` : '取出し待ち'
  }

  return (
  <>
    <div style={{
      height: '100%', display: 'flex', gap: 16, padding: 16,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      background: '#f7f5f2',
    }}>

      {/* ═══ Camera ═══ */}
      <div style={{
        flex: 1, minWidth: 0,
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 20, overflow: 'hidden',
        background: '#1a1625',
        boxShadow: '0 4px 32px rgba(0,0,0,0.12)',
        border: '1px solid rgba(0,0,0,0.08)',
      }}>
        <CameraFeed onImgRef={setImgEl} />
        <ROICanvas imgEl={imgEl} rois={rois} readOnly
          results={hasResults ? roiResults.map((r) => ({ roi_id: r.roi_id, judgment: r.judgment })) : undefined} />
        {inspecting && timings && (
          <div style={{
            position: 'absolute', bottom: 8, left: 10,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, lineHeight: 1,
            color: 'rgba(255,255,255,0.35)',
            pointerEvents: 'none', userSelect: 'none',
          }}>
            {`match ${timings.match_ms}ms  infer ${lastInferMsRef.current != null ? lastInferMsRef.current + 'ms' : '—'}  Σ ${timings.total_ms}ms`}
          </div>
        )}
      </div>

      {/* ═══ Panel ═══ */}
      <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>

        {/* ── Flow Indicator ── */}
        <FlowIndicator state={state} />

        {/* ── 箱進捗 + 秤 + 風袋引き (1枚に統合) ── */}
        <BoxProgressCard counters={counters} packing={selectedProduct?.inspection_config?.packing} />

        {/* ── Counters (検査回数累計) ── */}
        <CounterPanel counters={counters} productId={productId}
          resetCounters={resetCounters} />

        {/* ── Judgment ── */}
        <div style={{
          borderRadius: 20, padding: '24px', textAlign: 'center',
          position: 'relative', overflow: 'hidden',
          height: 200, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
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

          {/* Manual trigger button */}
          {isManual && state === 'idle' && (
            <button
              onClick={manual}
              style={{
                marginTop: 12,
                height: 44, padding: '0 32px',
                fontSize: 15, fontWeight: 700,
                fontFamily: "'DM Sans', system-ui, sans-serif",
                border: '2px solid #d4d0dc', borderRadius: 12,
                cursor: 'pointer',
                background: 'rgba(99,102,241,0.08)',
                color: '#6366f1',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#6366f1'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#6366f1' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.borderColor = '#d4d0dc' }}
            >
              検査実行 <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, opacity: 0.6, marginLeft: 8 }}>Space</span>
            </button>
          )}

          {/* Confirm button */}
          {state === 'waiting_confirm' && confirmReason === 'ng' && (
            <div style={{ marginTop: 12 }}>
              <p style={{
                fontSize: 12, fontWeight: 600, marginBottom: 8,
                color: 'rgba(255,255,255,0.7)',
              }}>
                NG品を確認してください
              </p>
              <button
                onClick={() => send({ action: 'confirm' })}
                style={{
                  height: 36, padding: '0 24px',
                  fontSize: 13, fontWeight: 700,
                  fontFamily: "'DM Sans', system-ui, sans-serif",
                  border: 'none', borderRadius: 10, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.25)',
                  color: '#fff',
                }}
              >
                確認して次へ <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, opacity: 0.7, marginLeft: 6 }}>Space</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Box Complete Banner (non-packing products only) ── */}
        {state === 'waiting_confirm' && confirmReason === 'box_complete' && !packingHandlesBoxComplete && (
          <div style={{
            borderRadius: 16, padding: '24px 20px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            textAlign: 'center',
            boxShadow: '0 4px 20px rgba(99,102,241,0.3)',
            animation: 'jPop 0.4s cubic-bezier(0.16,1,0.3,1)',
          }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
              📦 箱が完成しました
            </p>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>
              箱を入れ替えてから次の検査に進んでください
            </p>
            <button
              onClick={() => send({ action: 'confirm' })}
              style={{
                height: 44, padding: '0 32px',
                fontSize: 15, fontWeight: 700,
                fontFamily: "'DM Sans', system-ui, sans-serif",
                border: '2px solid rgba(255,255,255,0.4)', borderRadius: 12,
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            >
              入れ替え完了 <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, opacity: 0.7, marginLeft: 8 }}>Space</span>
            </button>
          </div>
        )}

      </div>

      {/* keyframes are in layout.css */}
    </div>
    <CalibrationWizard />
    <BoxWorkflowOverlay />
  </>
  )
}

/* ── Sub-components ── */

/* ── Helpers ── */

/* ================================================================
   Flow Indicator — Shows current step in the inspection flow
   ================================================================ */

const FLOW_STEPS = [
  { label: '設置' },
  { label: '検査' },
  { label: '取出' },
] as const

/**
 * Flow step mapping:
 *   IDLE/DETECTING → step 0 (設置) is active, nothing completed
 *   INSPECTING     → step 0 done, step 1 (検査) active
 *   JUDGED         → step 0 done, step 1 active (result shown)
 *   WAITING_REMOVAL→ step 0,1 done, step 2 (取出) active
 *   → back to IDLE → all reset
 */
function FlowIndicator({ state }: { state: InspectionState }) {
  const [allDone, setAllDone] = useState(false)
  const prevStateRef = useRef<InspectionState>(state)

  // 取出し完了を検知: WAITING_REMOVAL → IDLE に遷移したら全完了表示
  useEffect(() => {
    if ((prevStateRef.current === 'waiting_removal' || prevStateRef.current === 'waiting_confirm') && state === 'idle') {
      setAllDone(true)
      const timer = setTimeout(() => setAllDone(false), 2000)
      return () => clearTimeout(timer)
    }
    prevStateRef.current = state
  }, [state])

  const completed = new Set<number>()
  let active = 0

  if (allDone) {
    // 全ステップ完了表示
    completed.add(0)
    completed.add(1)
    completed.add(2)
    active = -1
  } else {
    switch (state) {
      case 'idle':
      case 'detecting':
        active = 0
        break
      case 'inspecting':
      case 'judged':
        completed.add(0)
        active = 1
        break
      case 'waiting_removal':
        completed.add(0)
        completed.add(1)
        active = 2
        break
      case 'waiting_confirm':
        completed.add(0)
        completed.add(1)
        completed.add(2)
        active = -1  // 全完了、確認待ち
        break
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: '#fff', borderRadius: 14, padding: '12px 20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
      flexShrink: 0,
    }}>
      {FLOW_STEPS.map((step, i) => {
        const isDone = completed.has(i)
        const isActive = i === active && !isDone

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flex: 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                transition: 'all 0.3s ease',
                background: isDone ? '#10b981' : '#f0ede9',
                color: isDone ? '#fff' : isActive ? '#1a1625' : '#b0a9bc',
                boxShadow: 'none',
              }}>
                {isDone ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                color: isDone ? '#059669' : isActive ? '#1a1625' : '#b0a9bc',
                transition: 'all 0.3s ease',
              }}>
                {step.label}
              </span>
            </div>
            {i < FLOW_STEPS.length - 1 && (
              <div style={{
                height: 2, flex: '0 0 24px', borderRadius: 1,
                background: isDone ? '#10b981' : '#f0ede9',
                transition: 'background 0.3s ease',
                marginTop: -18,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ================================================================
   Box Progress — pieces per box setting + display
   ================================================================ */

function CounterPanel({ counters, productId, resetCounters }: {
  counters: Counters; productId: string | null
  resetCounters: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<string | null>(null) // 'total' | 'ok' | 'ng'
  const [editVal, setEditVal] = useState('')
  const savingRef = useRef(false)

  const saveCounter = async (key: string, val: number) => {
    if (!productId || savingRef.current) return
    savingRef.current = true
    try {
      const { api } = await import('@/api/client')
      const updates: Record<string, number> = { [key]: val }
      // TOTALも自動更新
      if (key === 'ok') updates.total = val + counters.ng
      if (key === 'ng') updates.total = counters.ok + val
      const result = await api(`/products/${productId}/counters`).put(updates)
      if (result && typeof result === 'object') {
        useInspectionStore.setState({ counters: result as Counters })
      }
      setEditing(null)
    } catch { /* ignore */ } finally {
      savingRef.current = false
    }
  }

  const items = [
    { key: 'total', v: counters.total, l: 'TOTAL', c: '#1a1625', editable: false },
    { key: 'ok',    v: counters.ok,    l: 'OK',    c: '#059669', editable: true },
    { key: 'ng',    v: counters.ng,    l: 'NG',    c: '#dc2626', editable: true },
  ]

  return (
    <div style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
        {items.map((item, i) => (
          <div key={item.l} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '20px 12px',
            borderLeft: i > 0 ? '1px solid #f0ede9' : 'none',
            cursor: item.editable ? 'pointer' : 'default',
          }}
            onClick={() => {
              if (!item.editable) return
              setEditing(item.key)
              setEditVal(String(item.v))
            }}
          >
            {editing === item.key ? (
              <input
                autoFocus
                type="number" min={0}
                value={editVal}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCounter(item.key, Number(editVal))
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={() => saveCounter(item.key, Number(editVal))}
                style={{
                  width: 60, textAlign: 'center',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 28, fontWeight: 800, color: item.c,
                  border: `2px solid ${item.c}`, borderRadius: 8,
                  outline: 'none', background: '#faf9f7',
                }}
              />
            ) : (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 32, fontWeight: 800, color: item.c,
                lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}>
                {item.v}
              </span>
            )}
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
        リセット
      </button>
    </div>
  )
}


const LABELS: Record<InspectionState, string> = {
  idle: '待機中', detecting: '検知中', inspecting: '推論中',
  judged: '判定完了', waiting_removal: '取出し待ち', waiting_confirm: '確認待ち',
}

function visualState(s: InspectionState, j: 'OK' | 'NG' | null) {
  if ((s === 'judged' || s === 'waiting_removal' || s === 'waiting_confirm') && j) return j.toLowerCase() as 'ok' | 'ng'
  if (s === 'detecting' || s === 'inspecting') return 'detecting' as const
  return 'idle' as const
}
