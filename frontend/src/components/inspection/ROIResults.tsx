import { useInspectionStore } from '@/stores/inspectionStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function ROIResults() {
  const roiResults = useInspectionStore((s) => s.roiResults)
  const currentState = useInspectionStore((s) => s.currentState)

  if (currentState !== 'judged' && currentState !== 'waiting_removal') return null
  if (roiResults.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
          ROI別結果
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-1.5">
        {roiResults.map((r) => (
          <div
            key={r.roi_id}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-[13px] ${
              r.judgment === 'ok'
                ? 'bg-emerald-50 border border-emerald-200/50'
                : 'bg-red-50 border border-red-200/50'
            }`}
          >
            <Badge variant={r.judgment === 'ok' ? 'default' : 'destructive'} className="text-[11px] px-2 py-0">
              {r.judgment.toUpperCase()}
            </Badge>
            <span className="flex-1 font-medium">{r.roi_name}</span>
            <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
              {(r.confidence * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
