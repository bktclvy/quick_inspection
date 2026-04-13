import { useInspectionStore } from '@/stores/inspectionStore'
import type { InspectionState } from '@/types/ws'
import { cn } from '@/lib/utils'

const STATE_LABELS: Record<InspectionState, string> = {
  idle: '待機中',
  detecting: '検知中',
  inspecting: '検査中',
  judged: '判定',
  waiting_removal: '取出し待ち',
  waiting_confirm: '確認待ち',
}

function resolveVisualState(currentState: InspectionState, judgment: 'OK' | 'NG' | null): string {
  if (currentState === 'judged' && judgment) return judgment.toLowerCase()
  if (currentState === 'detecting') return 'detecting'
  if (currentState === 'waiting_removal') return 'waiting'
  return 'idle'
}

export function JudgmentDisplay() {
  const currentState = useInspectionStore((s) => s.currentState)
  const judgment = useInspectionStore((s) => s.overallJudgment)
  const confidence = useInspectionStore((s) => s.overallConfidence)
  const bgMatch = useInspectionStore((s) => s.bgMatch)
  const frameDiff = useInspectionStore((s) => s.frameDiff)
  const stabilityCount = useInspectionStore((s) => s.stabilityCount)
  const stabilityRequired = useInspectionStore((s) => s.stabilityRequired)
  const triggerMode = useInspectionStore((s) => s.triggerMode)
  const triggerCount = useInspectionStore((s) => s.triggerCount)
  const triggerRequired = useInspectionStore((s) => s.triggerRequired)
  const remainingMs = useInspectionStore((s) => s.remainingMs)

  const visualState = resolveVisualState(currentState, judgment)

  let label = 'IDLE'
  if (currentState === 'judged' && judgment) label = judgment
  else if (currentState === 'detecting' || currentState === 'inspecting') label = '...'
  else if (currentState === 'waiting_removal') label = judgment || '--'

  let progress = ''
  if (currentState === 'detecting') {
    if (triggerMode === 'auto_background') progress = `安定度 ${stabilityCount}/${stabilityRequired}`
    else if (triggerMode === 'auto_template') progress = `トリガー ${triggerCount}/${triggerRequired}`
  } else if (currentState === 'idle' && triggerMode === 'auto_background' && bgMatch != null) {
    progress = `差分 ${bgMatch.toFixed(1)} / ${frameDiff.toFixed(1)}`
  } else if (currentState === 'waiting_removal') {
    progress = `残り ${(remainingMs / 1000).toFixed(1)}s`
  }

  return (
    <div
      className={cn(
        'relative rounded-2xl px-6 text-center overflow-hidden transition-all duration-300',
        'py-10 border-2',
        // idle
        visualState === 'idle' && 'bg-card border-border shadow-sm',
        // detecting
        visualState === 'detecting' && 'bg-gradient-to-b from-amber-50 to-card border-amber-400 shadow-md',
        // ok
        visualState === 'ok' && 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-transparent shadow-[0_4px_24px_rgba(16,185,129,0.35)] animate-[judgment-pop_0.4s_cubic-bezier(0.16,1,0.3,1)]',
        // ng
        visualState === 'ng' && 'bg-gradient-to-br from-red-500 to-red-600 border-transparent shadow-[0_4px_24px_rgba(239,68,68,0.4)] animate-[judgment-shake_0.35s_ease,judgment-pop_0.4s_cubic-bezier(0.16,1,0.3,1)]',
        // waiting
        visualState === 'waiting' && 'bg-card border-amber-400 opacity-80',
      )}
    >
      <div className={cn(
        'font-mono text-[11px] font-bold tracking-[0.15em] uppercase mb-2',
        visualState === 'ok' || visualState === 'ng' ? 'text-white/80' : 'text-muted-foreground',
        visualState === 'detecting' && 'text-amber-700',
      )}>
        {STATE_LABELS[currentState]}
      </div>

      <div className={cn(
        'text-[clamp(3rem,7vw,5rem)] font-black leading-none tracking-tighter',
        visualState === 'ok' || visualState === 'ng' ? 'text-white' : 'text-foreground',
        visualState === 'detecting' && 'text-amber-600 animate-pulse',
      )}>
        {label}
      </div>

      <div className={cn(
        'font-mono text-xl font-bold mt-3 min-h-[1.5em] tabular-nums',
        visualState === 'ok' || visualState === 'ng' ? 'text-white/90' : 'text-muted-foreground',
      )}>
        {currentState === 'judged' && confidence != null
          ? `${(confidence * 100).toFixed(1)}%`
          : ''}
      </div>

      <div className={cn(
        'font-mono text-[13px] mt-1 min-h-[1em] tabular-nums',
        visualState === 'ok' || visualState === 'ng' ? 'text-white/70' : 'text-muted-foreground',
      )}>
        {progress}
      </div>

      <style>{`
        @keyframes judgment-pop {
          0% { transform: scale(0.95); }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
        @keyframes judgment-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-6px); }
          30% { transform: translateX(6px); }
          45% { transform: translateX(-4px); }
          60% { transform: translateX(4px); }
          75% { transform: translateX(-2px); }
        }
      `}</style>
    </div>
  )
}
