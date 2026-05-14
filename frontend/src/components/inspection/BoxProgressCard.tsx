/**
 * 検査画面の箱進捗カード (秤情報・風袋引きボタン統合)
 *
 * B = カメラ派生 (current_box_progress / pieces_per_box) — リアルタイム整数
 * C = 秤実測   (重量 ÷ 単重) — 秤あり (packing.enabled) 製品のみ、安定時のみ更新
 * 秤あり製品では下段に 「秤実測 N個 / 秤値 g / [風袋引き] 」 を表示する。
 *
 * pieces_per_box <= 0 の製品では何も表示しない。
 */
import { useEffect, useState } from 'react'
import type { Counters, PackingConfig } from '@/types'
import { useScaleStore } from '@/stores/scaleStore'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { scaleApi } from '@/api/scale'

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
  const { play } = useAudioFeedback()

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

  // 風袋引き
  const [taring, setTaring] = useState(false)
  const [tareError, setTareError] = useState<string | null>(null)
  const [okFlash, setOkFlash] = useState(false)
  const canTare = scaleLive && scaleStable && !taring
  const handleTare = async () => {
    setTaring(true)
    setTareError(null)
    try {
      const r = await scaleApi.tare()
      if (r.ok) {
        play('tare_ok')
        setOkFlash(true)
        setTimeout(() => setOkFlash(false), 1200)
      } else {
        setTareError('風袋引きが完了しませんでした')
      }
    } catch {
      setTareError('秤との通信に失敗しました')
    } finally {
      setTaring(false)
    }
  }

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
      flexShrink: 0,
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

      {/* ── 上段: 箱進捗 ── */}
      <div style={{ padding: '12px 16px 4px' }}>
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

      {/* ── 中段: 秤実測 N個 (packing 有効時のみ) ── */}
      {usePacking && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px',
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

      {/* ── 下段: 秤値 + 風袋引きボタン (packing 有効時のみ) ── */}
      {usePacking && (
        <div style={{
          padding: '10px 16px 12px',
          borderTop: '1px solid #f0ede9',
          background: '#fafaf9',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 16, fontWeight: 700,
                color: scaleLive ? (scaleStable ? '#1a1625' : '#d97706') : '#b0a9bc',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {scaleLive && scaleValue != null ? `${scaleValue.toFixed(1)} g` : '---'}
              </span>
              <span style={{
                fontSize: 10, color: '#9994a8', fontWeight: 600,
              }}>
                {scaleLive ? (scaleStable ? '安定' : '測定中') : '受信待ち'}
              </span>
            </div>
            <button
              onClick={handleTare}
              disabled={!canTare}
              style={{
                height: 32, padding: '0 14px',
                fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                border: 'none', borderRadius: 8, cursor: canTare ? 'pointer' : 'default',
                background: okFlash
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : canTare
                    ? 'linear-gradient(135deg, #6366f1, #7c3aed)'
                    : '#e8e4df',
                color: (canTare || okFlash) ? '#fff' : '#b0a9bc',
                boxShadow: canTare ? '0 2px 6px rgba(99,102,241,0.25)' : 'none',
                transition: 'background 0.2s ease',
                flexShrink: 0,
              }}
            >
              {taring ? '風袋引き中…' : okFlash ? '完了 ✓' : '風袋引き'}
            </button>
          </div>
          {tareError && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
              {tareError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
