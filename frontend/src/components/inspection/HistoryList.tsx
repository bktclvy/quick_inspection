import { useInspectionStore } from '@/stores/inspectionStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ja-JP', { hour12: false })
}

export function HistoryList() {
  const history = useInspectionStore((s) => s.history)

  return (
    <Card className="flex-1 min-h-0 flex flex-col">
      <CardHeader className="pb-2 pt-3 px-4 shrink-0">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
          判定履歴
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 flex-1 min-h-0 overflow-y-auto">
        {history.length === 0 ? (
          <div className="text-[13px] text-muted-foreground text-center py-8">
            まだ判定がありません
          </div>
        ) : (
          <div className="space-y-0.5">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 text-[13px] animate-[hist-in_0.2s_ease]"
              >
                <Badge
                  variant={entry.judgment === 'ok' ? 'default' : 'destructive'}
                  className="text-[10px] px-1.5 py-0 font-mono"
                >
                  {entry.judgment.toUpperCase()}
                </Badge>
                <span className="font-mono font-semibold text-muted-foreground tabular-nums">
                  {(entry.confidence * 100).toFixed(1)}%
                </span>
                <span className="font-mono text-xs text-muted-foreground ml-auto">
                  {formatTime(entry.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <style>{`
        @keyframes hist-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Card>
  )
}
