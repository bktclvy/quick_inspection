/**
 * InspectionPage — The Core Experience
 *
 * Design: "Precision Clinical"
 * A high-end measurement instrument display.
 * The judgment moment is the star — OK fills green, NG dominates red.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { useInspectionWS } from '@/hooks/useInspectionWS'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { useKeyboard } from '@/hooks/useKeyboard'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ROICanvas } from '@/components/camera/ROICanvas'
import { cn } from '@/lib/utils'
import type { InspectionState } from '@/types/ws'
import type { HistoryEntry, ROIResult } from '@/types'

/* ================================================================
   Page Component
   ================================================================ */

export function InspectionPage() {
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

  const manualTrigger = useCallback(() => {
    if (inspecting && triggerMode === 'manual') send({ action: 'manual_trigger' })
  }, [inspecting, triggerMode, send])
  useKeyboard('Space', manualTrigger, inspecting && triggerMode === 'manual')

  const vs = visualState(state, judgment)
  const showRoi = (state === 'judged' || state === 'waiting_removal') && roiResults.length > 0

  return (
    <div className="h-full flex gap-0 bg-[#f5f5f3]">

      {/* ═══════ LEFT: Camera Viewport ═══════════════ */}
      <div className="flex-1 min-w-0 p-3 pr-0">
        <div className="relative h-full rounded-2xl overflow-hidden bg-[#0a0d12] ring-1 ring-black/5 shadow-2xl">
          <CameraFeed onImgRef={setImgEl} />
          <ROICanvas imgEl={imgEl} rois={rois} readOnly />
          {/* Subtle inner vignette */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ boxShadow: 'inset 0 0 100px 20px rgba(0,0,0,0.08)' }} />
        </div>
      </div>

      {/* ═══════ RIGHT: Instrument Panel ═════════════ */}
      <div className="w-[380px] shrink-0 p-3 flex flex-col gap-2.5 overflow-y-auto">

        {/* ─── Counters ─────────────────────────────── */}
        <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm overflow-hidden">
          <div className="grid grid-cols-3">
            <Counter value={counters.total} label="TOTAL" color="text-gray-800" />
            <Counter value={counters.ok}    label="OK"    color="text-emerald-600" border />
            <Counter value={counters.ng}    label="NG"    color="text-red-500" border />
          </div>
          <button
            onClick={() => productId && resetCounters(productId)}
            className="w-full py-1.5 text-[11px] font-medium text-gray-400 border-t border-gray-100
                       hover:text-red-500 hover:bg-red-50/50 transition-colors duration-150"
          >
            リセット
          </button>
        </div>

        {/* ─── Judgment Display ──────────────────────── */}
        <JudgmentCard vs={vs} state={state} judgment={judgment} confidence={confidence}
          triggerMode={triggerMode} bgDiff={bgDiff} frameDiff={frameDiff}
          stabCount={stabCount} stabReq={stabReq}
          trigCount={trigCount} trigReq={trigReq} remainMs={remainMs} />

        {/* ─── ROI Results ──────────────────────────── */}
        {showRoi && <ROIResultsPanel results={roiResults} />}

        {/* ─── History ──────────────────────────────── */}
        <HistoryPanel entries={history} />
      </div>
    </div>
  )
}

/* ================================================================
   Counter Cell
   ================================================================ */

function Counter({ value, label, color, border }: {
  value: number; label: string; color: string; border?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center py-5 px-2', border && 'border-l border-gray-100')}>
      <span className={cn('font-mono text-[32px] font-extrabold tabular-nums leading-none tracking-tight', color)}>
        {value}
      </span>
      <span className="mt-2 text-[9px] font-bold tracking-[0.16em] text-gray-400 uppercase select-none">
        {label}
      </span>
    </div>
  )
}

/* ================================================================
   Judgment Card — The Star of the Show
   ================================================================ */

type VS = 'idle' | 'detecting' | 'ok' | 'ng' | 'waiting'

function JudgmentCard({ vs, state, judgment, confidence, triggerMode, bgDiff, frameDiff,
  stabCount, stabReq, trigCount, trigReq, remainMs }: {
  vs: VS; state: InspectionState; judgment: 'OK' | 'NG' | null; confidence: number | null
  triggerMode: string; bgDiff: number | null; frameDiff: number
  stabCount: number; stabReq: number; trigCount: number; trigReq: number; remainMs: number
}) {
  const prevVs = useRef<VS>('idle')
  const shouldAnimate = vs !== prevVs.current && (vs === 'ok' || vs === 'ng')
  useEffect(() => { prevVs.current = vs }, [vs])

  const mainLabel = vs === 'ok' ? 'OK' : vs === 'ng' ? 'NG' : vs === 'detecting' ? '···' :
                    vs === 'waiting' ? (judgment ?? '—') : 'IDLE'

  let sub = ''
  if (state === 'detecting') {
    sub = triggerMode === 'auto_background' ? `${stabCount} / ${stabReq} 安定` : `${trigCount} / ${trigReq}`
  } else if (state === 'idle' && triggerMode === 'auto_background' && bgDiff != null) {
    sub = `Δ ${bgDiff.toFixed(1)} | ${frameDiff.toFixed(1)}`
  } else if (state === 'waiting_removal') {
    sub = `取出し ${(remainMs / 1000).toFixed(1)}s`
  }

  return (
    <div className={cn(
      'relative rounded-2xl overflow-hidden transition-all duration-300 ease-out',
      /* ── IDLE ── */
      vs === 'idle' && 'bg-white ring-1 ring-gray-200/80 shadow-sm py-14',
      /* ── DETECTING ── */
      vs === 'detecting' && [
        'py-14 ring-1 ring-amber-300 shadow-md',
        'bg-gradient-to-b from-amber-50/80 via-white to-white',
      ],
      /* ── OK ── */
      vs === 'ok' && [
        'py-16',
        'bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700',
        'shadow-[0_12px_60px_-8px_rgba(5,150,105,0.5)]',
        'ring-1 ring-emerald-400/50',
      ],
      /* ── NG ── */
      vs === 'ng' && [
        'py-16',
        'bg-gradient-to-br from-red-500 via-red-600 to-rose-700',
        'shadow-[0_12px_60px_-8px_rgba(220,38,38,0.55)]',
        'ring-1 ring-red-400/50',
      ],
      /* ── WAITING ── */
      vs === 'waiting' && 'bg-white ring-1 ring-amber-200 shadow-sm py-14 opacity-70',
    )}
      style={{
        animation: shouldAnimate
          ? vs === 'ng' ? 'jShake .4s ease, jPop .35s cubic-bezier(.16,1,.3,1)' : 'jPop .35s cubic-bezier(.16,1,.3,1)'
          : undefined,
      }}
    >
      {/* State tag */}
      <p className={cn(
        'text-center text-[10px] font-bold font-mono tracking-[0.2em] uppercase',
        (vs === 'ok' || vs === 'ng') ? 'text-white/60' : vs === 'detecting' ? 'text-amber-600' : 'text-gray-400',
      )}>
        {LABELS[state]}
      </p>

      {/* Main label — THE number */}
      <p className={cn(
        'text-center mt-3 font-extrabold leading-[0.85] tracking-[-0.04em]',
        (vs === 'ok' || vs === 'ng') ? 'text-white text-[5.5rem]' :
        vs === 'detecting' ? 'text-amber-400 text-[4.5rem] animate-pulse' : 'text-gray-300 text-[4.5rem]',
      )}>
        {mainLabel}
      </p>

      {/* Confidence */}
      {state === 'judged' && confidence != null && (
        <p className={cn(
          'text-center font-mono text-[26px] font-bold tabular-nums mt-4',
          (vs === 'ok' || vs === 'ng') ? 'text-white/80' : 'text-gray-500',
        )}>
          {(confidence * 100).toFixed(1)}
          <span className="text-[16px] ml-0.5">%</span>
        </p>
      )}

      {/* Sub info */}
      {sub && (
        <p className={cn(
          'text-center font-mono text-[13px] mt-2 tabular-nums',
          (vs === 'ok' || vs === 'ng') ? 'text-white/50' : 'text-gray-400',
        )}>
          {sub}
        </p>
      )}

      {/* Decorative corner marks (precision instrument feel) */}
      {vs === 'idle' && (
        <>
          <Corner pos="top-left" /><Corner pos="top-right" />
          <Corner pos="bottom-left" /><Corner pos="bottom-right" />
        </>
      )}
    </div>
  )
}

/** Decorative L-shaped corner marks */
function Corner({ pos }: { pos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) {
  const base = 'absolute w-4 h-4 pointer-events-none'
  const border = 'border-gray-200'
  const styles: Record<string, string> = {
    'top-left':     `${base} top-3 left-3 border-t-2 border-l-2 ${border} rounded-tl-sm`,
    'top-right':    `${base} top-3 right-3 border-t-2 border-r-2 ${border} rounded-tr-sm`,
    'bottom-left':  `${base} bottom-3 left-3 border-b-2 border-l-2 ${border} rounded-bl-sm`,
    'bottom-right': `${base} bottom-3 right-3 border-b-2 border-r-2 ${border} rounded-br-sm`,
  }
  return <div className={styles[pos]} />
}

/* ================================================================
   ROI Results
   ================================================================ */

function ROIResultsPanel({ results }: { results: ROIResult[] }) {
  return (
    <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
      <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">ROI 結果</h3>
      <div className="space-y-1.5">
        {results.map((r) => (
          <div key={r.roi_id} className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium',
            r.judgment === 'ok'
              ? 'bg-emerald-50/80 text-emerald-900 ring-1 ring-emerald-100'
              : 'bg-red-50/80 text-red-900 ring-1 ring-red-100',
          )}>
            <span className={cn(
              'shrink-0 w-8 text-center text-[10px] font-extrabold font-mono py-0.5 rounded text-white',
              r.judgment === 'ok' ? 'bg-emerald-500' : 'bg-red-500',
            )}>
              {r.judgment.toUpperCase()}
            </span>
            <span className="flex-1 truncate">{r.roi_name}</span>
            <span className="font-mono text-[12px] font-semibold opacity-50 tabular-nums shrink-0">
              {(r.confidence * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================
   History
   ================================================================ */

function HistoryPanel({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4 flex flex-col flex-1 min-h-0">
      <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3 shrink-0">
        判定履歴
      </h3>
      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-gray-300 select-none">判定を待っています</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
          {entries.map((e, i) => (
            <div key={e.id}
              className="flex items-center gap-2.5 px-3 py-[6px] rounded-md hover:bg-gray-50/80 transition-colors text-[13px]"
              style={{ animation: i < 3 ? `fadeUp .25s ${i * 60}ms both ease` : undefined }}
            >
              <span className={cn(
                'shrink-0 w-7 text-center text-[9px] font-extrabold font-mono py-[3px] rounded text-white leading-none',
                e.judgment === 'ok' ? 'bg-emerald-500' : 'bg-red-500',
              )}>
                {e.judgment.toUpperCase()}
              </span>
              <span className="font-mono text-[12px] font-semibold text-gray-500 tabular-nums">
                {(e.confidence * 100).toFixed(1)}%
              </span>
              <span className="font-mono text-[11px] text-gray-300 ml-auto tabular-nums">
                {e.timestamp.toLocaleTimeString('ja-JP', { hour12: false })}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes jPop {
          0%   { transform: scale(.93); }
          60%  { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
        @keyframes jShake {
          0%,100% { transform: translateX(0); }
          12% { transform: translateX(-7px); }
          24% { transform: translateX(7px); }
          36% { transform: translateX(-5px); }
          48% { transform: translateX(5px); }
          60% { transform: translateX(-2px); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ── Constants ────────────────────────────────────── */

const LABELS: Record<InspectionState, string> = {
  idle: '待機中', detecting: '検知中', inspecting: '推論中',
  judged: '判定完了', waiting_removal: '取出し待ち', waiting_confirm: '確認待ち',
}

function visualState(s: InspectionState, j: 'OK' | 'NG' | null): VS {
  if (s === 'judged' && j) return j.toLowerCase() as 'ok' | 'ng'
  if (s === 'detecting' || s === 'inspecting') return 'detecting'
  if (s === 'waiting_removal') return 'waiting'
  return 'idle'
}
