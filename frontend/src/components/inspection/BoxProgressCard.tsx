/**
 * 検査画面の箱進捗カード
 *
 * B = カメラ派生 (current_box_progress / pieces_per_box) — リアルタイム整数
 * C = 秤実測   (重量 ÷ 単重) — 秤あり (packing.enabled) 製品のみ、安定時のみ更新
 *
 * B と C のズレが整数 1 個以上出たら警告（取り落とし・二重投入の即時検知）
 *
 * pieces_per_box <= 0 の製品では何も表示しない
 */
import { useEffect, useState } from 'react'
import type { Counters, PackingConfig } from '@/types'
import { useScaleStore } from '@/stores/scaleStore'

interface Props {
  counters: Counters
  packing?: PackingConfig | null
}

export function BoxProgressCard({ counters, packing }: Props) {
  const ppb = counters.pieces_per_box ?? 0
  const progress = counters.current_box_progress ?? 0
  const boxes = counters.completed_boxes ?? 0
  const currentBoxNo = boxes + 1

  const scaleLive   = useScaleStore((s) => s.live)
  const scaleStable = useScaleStore((s) => s.stable)
  const scaleValue  = useScaleStore((s) => s.value_g)

  // 秤実測表示を出すか (packing.enabled かつ単重が校正済み)
  const usePacking = !!packing?.enabled && (packing.unit_weight_g ?? 0) > 0
  const unitW = packing?.unit_weight_g ?? 0

  // 秤実測個数 C (安定時のみ更新する。不安定中は前の値を保持)
  const [estimate, setEstimate] = useState<number | null>(null)
  useEffect(() => {
    if (!usePacking) { setEstimate(null); return }
    if (!scaleLive || !scaleStable) return
    if (scaleValue == null) return
    if (unitW <= 0) return
    const est = Math.round(scaleValue / unitW)
    if (est < 0) return
    setEstimate(est)
  }, [usePacking, scaleLive, scaleStable, scaleValue, unitW])

  if (ppb <= 0) return null

  const pct = Math.min(100, (progress / ppb) * 100)
  const justCompleted = progress === 0 && boxes > 0

  // ズレ判定 (秤実測がある場合のみ)
  const haveEstimate = usePacking && scaleLive && estimate != null
  const delta = haveEstimate ? estimate! - progress : 0
  const mismatch = haveEstimate && Math.abs(delta) >= 1

  return (
    <div style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
    }}>
      {justCompleted && (
        <div style={{
          padding: '6px 16px',
          background: 'linear-gradient(90deg, #10b981, #059669)',
          color: '#fff',
          fontSize: 12, fontWeight: 700, textAlign: 'center',
        }}>
          ✓ {boxes} 箱目が完成しました
        </div>
      )}

      <div style={{ padding: '12px 16px 4px' }}>
        {/* 上段: 箱番号 + 大きい進捗数字 + 完成数 */}
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#9994a8',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>箱</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 16, fontWeight: 800, color: '#5b21b6',
              fontVariantNumeric: 'tabular-nums',
            }}>#{currentBoxNo}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 24, fontWeight: 800, color: '#1a1625',
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            }}>{progress}</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14, fontWeight: 500, color: '#9994a8',
            }}>/ {ppb}</span>
          </div>
          <div style={{ fontSize: 10, color: '#9994a8' }}>
            完成 <span style={{ color: '#059669', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{boxes}</span> 箱
          </div>
        </div>

        {/* バー */}
        <div style={{
          height: 8, borderRadius: 4,
          background: '#f0ede9', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
            width: `${pct}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* 秤実測行 (packing 有効・単重校正済みの製品のみ) */}
      {usePacking && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px 12px',
          marginTop: 4,
          borderTop: '1px solid #f0ede9',
          background: mismatch ? '#fff7ed' : 'transparent',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: mismatch ? '#c2410c' : '#9994a8',
              letterSpacing: '0.06em',
            }}>秤実測</span>
            {haveEstimate ? (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 16, fontWeight: 800,
                color: mismatch ? '#c2410c' : '#059669',
                fontVariantNumeric: 'tabular-nums',
              }}>{estimate} 個</span>
            ) : (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13, color: '#b0a9bc',
              }}>—</span>
            )}
          </div>
          {mismatch && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#c2410c',
            }}>
              ⚠ {delta > 0 ? `+${delta}` : delta} 個ズレ
            </span>
          )}
          {haveEstimate && !mismatch && (
            <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>
              ✓ カメラと一致
            </span>
          )}
        </div>
      )}
    </div>
  )
}
