import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useBoxWorkflowStore } from '@/stores/boxWorkflowStore'
import { useScaleStore } from '@/stores/scaleStore'
import { useInspectionWS } from '@/hooks/useInspectionWS'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { scaleApi } from '@/api/scale'

export function BoxWorkflowOverlay() {
  const phase  = useBoxWorkflowStore((s) => s.phase)

  const visible = phase !== 'off' && phase !== 'inspecting'
  if (!visible) return null

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(26,22,37,0.65)',
      backdropFilter: 'blur(8px)',
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <OverlayContent />
      <style>{`
        @keyframes calibPop { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
        @keyframes spin { to { transform:rotate(360deg); } }
      `}</style>
    </div>,
    document.body
  )
}

function OverlayContent() {
  const phase         = useBoxWorkflowStore((s) => s.phase)
  const packingConfig = useBoxWorkflowStore((s) => s.packingConfig)
  const currentBoxQty = useBoxWorkflowStore((s) => s.currentBoxQty)
  const weighResult   = useBoxWorkflowStore((s) => s.weighResult)
  const error         = useBoxWorkflowStore((s) => s.error)
  const { onTareOk, onTareError, startMeasuring, onWeighOk, onWeighNg,
          toTareNextBox } = useBoxWorkflowStore()

  const scaleValue  = useScaleStore((s) => s.value_g)
  const scaleStable = useScaleStore((s) => s.stable)
  const scalePort   = useScaleStore((s) => s.portOpen)
  const scaleLive   = useScaleStore((s) => s.live)

  const { send }  = useInspectionWS()
  const { play }  = useAudioFeedback()
  const [taring, setTaring] = useState(false)

  const handleTare = useCallback(async () => {
    if (taring) return
    setTaring(true)
    try {
      const result = await scaleApi.tare()
      if (result.ok) {
        play('tare_ok')
        onTareOk()
      } else {
        onTareError('風袋リセットが完了しませんでした。もう一度お試しください。')
      }
    } catch {
      onTareError('秤との通信に失敗しました。')
    } finally {
      setTaring(false)
    }
  }, [taring, onTareOk, onTareError, play])

  const handleWeigh = useCallback(async () => {
    if (!packingConfig) return
    if (!currentBoxQty || currentBoxQty <= 0) return  // box_qty が無いと期待重量が計算できない
    startMeasuring()
    const expectedG = packingConfig.unit_weight_g * currentBoxQty
    try {
      const result = await scaleApi.weigh({
        expected_g: expectedG,
        tolerance_g: packingConfig.tolerance_g,
        box_qty: currentBoxQty || undefined,
      })
      const local = { ...result, expected_g: expectedG, tolerance_g: packingConfig.tolerance_g }
      if (result.ok) {
        play('box_ok')
        onWeighOk(local)
      } else {
        play('box_ng')
        onWeighNg(local)
      }
    } catch {
      onWeighNg({ ok: false, measured_g: 0, deviation_g: 0, estimated_qty_delta: null, expected_g: expectedG, tolerance_g: packingConfig.tolerance_g })
    }
  }, [packingConfig, currentBoxQty, startMeasuring, onWeighOk, onWeighNg, play])

  // 員数 OK → confirm 送信 + box_log 書込 + 次の箱の風袋準備へ
  const handleConfirmOk = useCallback(() => {
    if (!weighResult) return
    const now = new Date().toISOString()
    send({
      action: 'confirm',
      box_result: {
        box_id: `box_${Date.now()}`,
        completed_at: now,
        status: 'OK',
        final_weight_g: weighResult.measured_g,
        expected_weight_g: weighResult.expected_g,
        box_qty: currentBoxQty,
        tolerance_g: weighResult.tolerance_g,
      },
    })
    toTareNextBox()
  }, [weighResult, currentBoxQty, send, toTareNextBox])

  return (
    <div style={{
      width: 480,
      background: '#faf9f7',
      borderRadius: 24,
      boxShadow: '0 24px 80px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.1)',
      overflow: 'hidden',
      animation: 'calibPop 0.25s ease',
    }}>
      {/* ── Tare Phase ── */}
      {phase === 'tare' && (
        <TarePanel
          scaleValue={scaleValue}
          scaleStable={scaleStable}
          scalePort={scalePort}
          scaleLive={scaleLive}
          taring={taring}
          error={error}
          onTare={handleTare}
        />
      )}

      {/* ── Weighing CTA ── */}
      {phase === 'weighing' && (
        <WeighingPanel
          boxQty={currentBoxQty}
          scaleValue={scaleValue}
          scaleStable={scaleStable}
          scaleLive={scaleLive}
          onWeigh={handleWeigh}
        />
      )}

      {/* ── Measuring spinner ── */}
      {phase === 'weighing_measuring' && (
        <MeasuringPanel scaleValue={scaleValue} scaleStable={scaleStable} scaleLive={scaleLive} />
      )}

      {/* ── Weigh OK ── */}
      {phase === 'weigh_ok' && weighResult && (
        <WeighOkPanel result={weighResult} boxQty={currentBoxQty} onNext={handleConfirmOk} />
      )}

      {/* ── Weigh NG ── */}
      {phase === 'weigh_ng' && weighResult && (
        <WeighNgPanel result={weighResult} boxQty={currentBoxQty} onRetry={handleWeigh} />
      )}
    </div>
  )
}

/* ── Sub-panels ──────────────────────────────────────── */

function ScaleReadout({ value, stable, live }: { value: number | null; stable: boolean; live: boolean }) {
  const color = !live ? '#b0a9bc' : stable ? '#059669' : '#d97706'
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'center',
      padding: '12px 0',
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 36, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums',
      }}>
        {!live ? '---' : value != null ? value.toFixed(1) : '---'}
      </span>
      <span style={{ fontSize: 16, color, fontWeight: 600 }}>g</span>
      <span style={{
        fontSize: 12, fontWeight: 600, color, opacity: 0.75, marginLeft: 6,
      }}>
        {!live ? '受信待ち' : stable ? '安定' : '測定中'}
      </span>
    </div>
  )
}

function PanelHeader({ emoji, title, subtitle }: { emoji: string; title: string; subtitle?: string }) {
  return (
    <div style={{
      padding: '28px 32px 20px',
      borderBottom: '1px solid #f0ede9',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{emoji}</div>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1a1625', margin: 0 }}>{title}</h2>
      {subtitle && (
        <p style={{ fontSize: 14, color: '#7c7494', marginTop: 6, marginBottom: 0 }}>{subtitle}</p>
      )}
    </div>
  )
}

function TarePanel({ scaleValue, scaleStable, scalePort, scaleLive, taring, error, onTare }: {
  scaleValue: number | null; scaleStable: boolean; scalePort: boolean; scaleLive: boolean
  taring: boolean; error: string | null; onTare: () => void
}) {
  const canTare = scaleLive && !taring
  return (
    <>
      <PanelHeader emoji="⚖" title="秤の準備" subtitle="空の箱を秤に載せて、風袋リセットを行ってください" />
      <div style={{ padding: '20px 32px 28px' }}>
        <ol style={{ margin: '0 0 16px', padding: '0 0 0 20px', color: '#5c5470', fontSize: 14, lineHeight: 2 }}>
          <li>空の箱を秤に載せてください</li>
          <li>下のボタンで風袋リセットを行ってください</li>
        </ol>

        <ScaleReadout value={scaleValue} stable={scaleStable} live={scaleLive} />

        {error && (
          <p style={{ fontSize: 13, color: '#dc2626', textAlign: 'center', marginBottom: 12 }}>{error}</p>
        )}

        <button
          onClick={onTare}
          disabled={!canTare}
          style={{
            width: '100%', height: 52,
            fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
            border: 'none', borderRadius: 14, cursor: canTare ? 'pointer' : 'default',
            background: canTare ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : '#e8e4df',
            color: canTare ? '#fff' : '#b0a9bc',
            boxShadow: canTare ? '0 4px 16px rgba(99,102,241,0.35)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          {taring ? '風袋リセット中…' : '風袋リセット'}
        </button>
        {!scaleLive && (
          <p style={{ fontSize: 12, color: scalePort ? '#c2410c' : '#dc2626', textAlign: 'center', marginTop: 10 }}>
            {scalePort ? '秤からデータが届いていません。' : '秤が接続されていません。'}
          </p>
        )}
      </div>
    </>
  )
}

function WeighingPanel({ boxQty, scaleValue, scaleStable, scaleLive, onWeigh }: {
  boxQty: number; scaleValue: number | null; scaleStable: boolean; scaleLive: boolean; onWeigh: () => void
}) {
  const canWeigh = scaleLive
  return (
    <>
      <PanelHeader
        emoji="📦"
        title={`${boxQty} 個完成`}
        subtitle="重量で員数を確認します"
      />
      <div style={{ padding: '20px 32px 28px', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: '#5c5470', marginBottom: 4 }}>
          現在の秤
        </p>
        <ScaleReadout value={scaleValue} stable={scaleStable} live={scaleLive} />
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 20 }}>
          箱を秤の上に置いた状態で「計量する」を押してください
        </p>
        <button
          onClick={onWeigh}
          disabled={!canWeigh}
          style={{
            width: '100%', height: 52,
            fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
            border: 'none', borderRadius: 14, cursor: canWeigh ? 'pointer' : 'default',
            background: canWeigh ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : '#e8e4df',
            color: canWeigh ? '#fff' : '#b0a9bc',
            boxShadow: canWeigh ? '0 4px 16px rgba(99,102,241,0.35)' : 'none',
          }}
        >
          計量する
        </button>
        {!canWeigh && (
          <p style={{ fontSize: 12, color: '#dc2626', marginTop: 10 }}>
            秤からデータが届いていません。接続を確認してください。
          </p>
        )}
      </div>
    </>
  )
}

function MeasuringPanel({ scaleValue, scaleStable, scaleLive }: { scaleValue: number | null; scaleStable: boolean; scaleLive: boolean }) {
  return (
    <>
      <PanelHeader emoji="⏳" title="員数チェック中…" subtitle="秤が安定するまでお待ちください" />
      <div style={{ padding: '20px 32px 28px', textAlign: 'center' }}>
        <ScaleReadout value={scaleValue} stable={scaleStable} live={scaleLive} />
        <div style={{
          width: 40, height: 40, margin: '8px auto 0',
          borderRadius: '50%',
          border: '3px solid #e8e4df',
          borderTopColor: '#6366f1',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    </>
  )
}

function WeighOkPanel({ result, boxQty, onNext }: {
  result: { measured_g: number; expected_g: number; deviation_g: number; estimated_qty_delta: number | null }
  boxQty: number; onNext: () => void
}) {
  return (
    <>
      <PanelHeader emoji="✓" title="員数 OK" />
      <div style={{ padding: '20px 32px 28px' }}>
        {/* 個数主役 */}
        <div style={{
          background: '#f0fdf4', borderRadius: 14, padding: '24px 20px', marginBottom: 14,
          border: '1.5px solid #86efac', textAlign: 'center',
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#059669', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>
            合格
          </p>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 44, fontWeight: 800, color: '#047857',
            lineHeight: 1, margin: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {boxQty} 個
          </p>
          <p style={{ fontSize: 13, color: '#059669', marginTop: 6, marginBottom: 0 }}>
            期待 {boxQty} 個と一致
          </p>
        </div>
        {/* グラム補助 */}
        <div style={{
          background: '#fafaf9', borderRadius: 10, padding: '10px 14px', marginBottom: 18,
          border: '1px solid #ebe7e2',
          display: 'flex', justifyContent: 'space-around',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, color: '#7c7494',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>実測 {result.measured_g.toFixed(1)} g</span>
          <span>期待 {result.expected_g.toFixed(1)} g</span>
          <span>差 {result.deviation_g >= 0 ? '+' : ''}{result.deviation_g.toFixed(1)} g</span>
        </div>
        <button
          onClick={onNext}
          style={{
            width: '100%', height: 52,
            fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
            border: 'none', borderRadius: 14, cursor: 'pointer',
            background: 'linear-gradient(135deg, #059669, #047857)',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(5,150,105,0.35)',
          }}
        >
          次の箱へ
        </button>
      </div>
    </>
  )
}

function WeighNgPanel({ result, boxQty, onRetry }: {
  result: { measured_g: number; expected_g: number; deviation_g: number; estimated_qty_delta: number | null }
  boxQty: number; onRetry: () => void
}) {
  const delta = result.estimated_qty_delta
  // 推定実個数 = box_qty + delta (delta が正なら多い、負なら少ない)
  const estimatedQty = delta != null ? boxQty + delta : null
  const diffText = delta == null ? null
    : delta > 0 ? `${Math.abs(delta).toFixed(1)} 個多い`
    : delta < 0 ? `${Math.abs(delta).toFixed(1)} 個不足`
    : '誤差範囲外'
  return (
    <>
      <PanelHeader emoji="⚠" title="員数不一致" subtitle="中身を確認してから再計量してください" />
      <div style={{ padding: '20px 32px 28px' }}>
        {/* 個数主役 */}
        <div style={{
          background: '#fef2f2', borderRadius: 14, padding: '24px 20px', marginBottom: 14,
          border: '1.5px solid #fca5a5', textAlign: 'center',
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>
            推定 個数
          </p>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 44, fontWeight: 800, color: '#b91c1c',
            lineHeight: 1, margin: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {estimatedQty != null ? `約 ${estimatedQty.toFixed(1)} 個` : '計算不能'}
          </p>
          <p style={{ fontSize: 13, color: '#dc2626', marginTop: 6, marginBottom: 0 }}>
            期待 {boxQty} 個{diffText ? ` — ${diffText}` : ''}
          </p>
        </div>
        {/* グラム補助 */}
        <div style={{
          background: '#fafaf9', borderRadius: 10, padding: '10px 14px', marginBottom: 18,
          border: '1px solid #ebe7e2',
          display: 'flex', justifyContent: 'space-around',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, color: '#7c7494',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>実測 {result.measured_g.toFixed(1)} g</span>
          <span>期待 {result.expected_g.toFixed(1)} g</span>
          <span>差 {result.deviation_g >= 0 ? '+' : ''}{result.deviation_g.toFixed(1)} g</span>
        </div>
        <button
          onClick={onRetry}
          style={{
            width: '100%', height: 52,
            fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
            border: 'none', borderRadius: 14, cursor: 'pointer',
            background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
          }}
        >
          もう一度計量する
        </button>
      </div>
    </>
  )
}

