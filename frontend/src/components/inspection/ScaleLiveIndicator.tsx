import { useScaleStore } from '@/stores/scaleStore'

export function ScaleLiveIndicator() {
  const portOpen = useScaleStore((s) => s.portOpen)
  const live     = useScaleStore((s) => s.live)
  const value_g  = useScaleStore((s) => s.value_g)
  const stable   = useScaleStore((s) => s.stable)
  const overload = useScaleStore((s) => s.overload)

  // 何も表示しない条件: ポート未開通かつライブ値も無し
  if (!portOpen && !live) return null

  const color = !live ? '#b0a9bc' : overload ? '#dc2626' : stable ? '#059669' : '#d97706'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px',
      borderRadius: 8,
      background: live ? (stable ? 'rgba(5,150,105,0.08)' : 'rgba(217,119,6,0.08)') : 'rgba(176,169,188,0.1)',
      border: `1.5px solid ${color}22`,
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color,
      }}>
        {!portOpen
          ? '秤未接続'
          : !live
            ? '受信待ち'
            : overload
              ? '計量オーバー'
              : value_g != null
                ? `${value_g.toFixed(1)} g`
                : '---'
        }
      </span>
      {live && !overload && (
        <span style={{
          fontSize: 10, fontWeight: 600, color, opacity: 0.75,
        }}>
          {stable ? '安定' : '測定中'}
        </span>
      )}
    </div>
  )
}
