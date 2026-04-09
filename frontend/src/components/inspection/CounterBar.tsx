import { useInspectionStore } from '@/stores/inspectionStore'
import { useAppStore } from '@/stores/appStore'
import { Card } from '@/components/ui/card'

export function CounterBar() {
  const counters = useInspectionStore((s) => s.counters)
  const resetCounters = useInspectionStore((s) => s.resetCounters)
  const productId = useAppStore((s) => s.selectedProductId)

  return (
    <div>
      <Card className="p-0 overflow-hidden">
        <div className="grid grid-cols-3 divide-x">
          <CounterCell value={counters.total} label="TOTAL" className="text-foreground" />
          <CounterCell value={counters.ok} label="OK" className="text-emerald-600" />
          <CounterCell value={counters.ng} label="NG" className="text-red-500" />
        </div>
      </Card>
      <button
        className="w-full py-1.5 text-xs font-medium text-muted-foreground bg-card border border-t-0 rounded-b-lg shadow-xs hover:text-red-500 hover:bg-red-50 transition-colors"
        onClick={() => productId && resetCounters(productId)}
      >
        リセット
      </button>
    </div>
  )
}

function CounterCell({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div className="flex flex-col items-center py-4 px-3">
      <span className={`font-mono text-[28px] font-bold leading-none tabular-nums ${className}`}>
        {value}
      </span>
      <span className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mt-1.5">
        {label}
      </span>
    </div>
  )
}
