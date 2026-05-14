import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBoxWorkflowStore } from '@/stores/boxWorkflowStore'
import { useScaleStore } from '@/stores/scaleStore'
import { useInspectionWS } from '@/hooks/useInspectionWS'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { useKeyboard } from '@/hooks/useKeyboard'
import { scaleApi } from '@/api/scale'

export function BoxWorkflowOverlay() {
  const phase = useBoxWorkflowStore((s) => s.phase)
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
        @keyframes resultFlash { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.6); } 100% { box-shadow: 0 0 0 24px rgba(16,185,129,0); } }
      `}</style>
    </div>,
    document.body
  )
}

function OverlayContent() {
  const phase         = useBoxWorkflowStore((s) => s.phase)
  const packingConfig = useBoxWorkflowStore((s) => s.packingConfig)
  const currentBoxQty = useBoxWorkflowStore((s) => s.currentBoxQty)
  const snapshot      = useBoxWorkflowStore((s) => s.snapshot)
  const error         = useBoxWorkflowStore((s) => s.error)
  const setVerifyOk = useBoxWorkflowStore((s) => s.setVerifyOk)
  const onTareOk      = useBoxWorkflowStore((s) => s.onTareOk)
  const onTareError   = useBoxWorkflowStore((s) => s.onTareError)
  const toTareNextBox = useBoxWorkflowStore((s) => s.toTareNextBox)

  const scaleValue  = useScaleStore((s) => s.value_g)
  const scaleStable = useScaleStore((s) => s.stable)
  const scalePort   = useScaleStore((s) => s.portOpen)
  const scaleLive   = useScaleStore((s) => s.live)

  const { send } = useInspectionWS()
  const { play } = useAudioFeedback()
  const [taring, setTaring] = useState(false)

  // 風袋引き (initial / next box)
  const handleTare = useCallback(async () => {
    if (taring) return
    setTaring(true)
    try {
      const result = await scaleApi.tare()
      if (result.ok) {
        play('tare_ok')
        onTareOk()
      } else {
        onTareError('風袋引きが完了しませんでした。空箱を載せた状態でもう一度押してください。')
      }
    } catch {
      onTareError('秤との通信に失敗しました。')
    } finally {
      setTaring(false)
    }
  }, [taring, onTareOk, onTareError, play])

  // result_ok での「箱完了 → 風袋」: confirm + box_result 送信 → tare API
  const handleConfirmAndTare = useCallback(async () => {
    if (taring) return
    if (!snapshot) return
    setTaring(true)
    try {
      send({
        action: 'confirm',
        box_result: {
          box_id: `box_${Date.now()}`,
          completed_at: new Date().toISOString(),
          status: 'OK',
          final_weight_g: snapshot.measuredG,
          expected_weight_g: snapshot.expectedG,
          box_qty: currentBoxQty,
          tolerance_g: packingConfig?.tolerance_g ?? 0,
        },
      })
      toTareNextBox()
      const r = await scaleApi.tare()
      if (r.ok) {
        play('tare_ok')
        onTareOk()
      } else {
        onTareError('風袋引きが完了しませんでした。空箱を載せた状態でもう一度押してください。')
      }
    } catch {
      onTareError('秤との通信に失敗しました。')
    } finally {
      setTaring(false)
    }
  }, [taring, snapshot, currentBoxQty, packingConfig, send, toTareNextBox, onTareOk, onTareError, play])

  // ── 秤一致の自動検知 ──────────────────────────────────────
  // verifying 中、秤が「同じ値で 1.5 秒以上 ST 継続」かつカメラ個数と一致した
  // 瞬間に result_ok へ。 一致しなければ何も起こらない（NG は明示しない）。
  // 1.5 秒のウィンドウは、達成瞬間に作業者の手に部品が残っているケースで誤検知しないため。
  const lastVerifiedRef = useRef<number | null>(null)
  useEffect(() => {
    if (phase !== 'verifying') return
    if (!scaleLive || !scaleStable) return
    if (scaleValue == null) return
    if (!packingConfig || !packingConfig.unit_weight_g || packingConfig.unit_weight_g <= 0) return
    if (currentBoxQty <= 0) return

    const last = lastVerifiedRef.current
    if (last !== null && Math.abs(last - scaleValue) < 0.1) return

    const timer = setTimeout(() => {
      const estimateFloat = scaleValue / packingConfig.unit_weight_g
      const scaleCount = Math.round(estimateFloat)
      const cameraCount = currentBoxQty
      lastVerifiedRef.current = scaleValue
      if (scaleCount !== cameraCount) return  // 不一致は無視。verifying のまま待ち続ける
      setVerifyOk({
        cameraCount,
        scaleCount,
        scaleEstimate: estimateFloat,
        measuredG: scaleValue,
        expectedG: packingConfig.unit_weight_g * cameraCount,
      })
      play('box_ok')
    }, 1500)

    return () => clearTimeout(timer)
  }, [phase, scaleLive, scaleStable, scaleValue, packingConfig, currentBoxQty, setVerifyOk, play])

  // verifying 突入時に判定履歴をクリア（前の箱の値を引き継がない）
  useEffect(() => {
    if (phase === 'verifying') {
      lastVerifiedRef.current = null
    }
  }, [phase])

  // Space で風袋引き (overlay 表示中のみ。inspect-page 側の Space は overlay 中は無効化されている)
  const onSpace = useCallback(() => {
    if (taring) return
    if (phase === 'tare' && scaleLive) {
      handleTare()
    } else if (phase === 'result_ok' && scaleLive && scaleStable) {
      handleConfirmAndTare()
    }
  }, [phase, taring, scaleLive, scaleStable, handleTare, handleConfirmAndTare])
  useKeyboard('Space', onSpace, phase === 'tare' || phase === 'result_ok')

  return (
    <div style={{
      width: 480,
      background: '#faf9f7',
      borderRadius: 24,
      boxShadow: '0 24px 80px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.1)',
      overflow: 'hidden',
      animation: 'calibPop 0.25s ease',
    }}>
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

      {phase === 'verifying' && (
        <VerifyingPanel
          cameraCount={currentBoxQty}
          scaleValue={scaleValue}
          scaleStable={scaleStable}
          scaleLive={scaleLive}
          unitWeight={packingConfig?.unit_weight_g ?? 0}
        />
      )}

      {phase === 'result_ok' && snapshot && (
        <ResultOkPanel
          snapshot={snapshot}
          scaleValue={scaleValue}
          scaleStable={scaleStable}
          scaleLive={scaleLive}
          taring={taring}
          error={error}
          onConfirmAndTare={handleConfirmAndTare}
        />
      )}

    </div>
  )
}

/* ────── Sub-panels ────────────────────────────────────────────── */

function PanelHeader({ emoji, title, subtitle, tone }: {
  emoji: string; title: string; subtitle?: string
  tone?: 'neutral' | 'ok' | 'ng'
}) {
  const titleColor = tone === 'ok' ? '#047857' : tone === 'ng' ? '#b91c1c' : '#1a1625'
  return (
    <div style={{
      padding: '28px 32px 20px',
      borderBottom: '1px solid #f0ede9',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{emoji}</div>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: titleColor, margin: 0 }}>{title}</h2>
      {subtitle && (
        <p style={{ fontSize: 14, color: '#7c7494', marginTop: 6, marginBottom: 0 }}>{subtitle}</p>
      )}
    </div>
  )
}

// 秤の小さなライブインジケータ。 グラム値は補助情報として小さく出す
function ScaleStatusBadge({ value, stable, live }: {
  value: number | null; stable: boolean; live: boolean
}) {
  let dotColor = '#b0a9bc'
  let label = '受信待ち'
  if (live && stable) { dotColor = '#10b981'; label = '安定' }
  else if (live && !stable) { dotColor = '#f59e0b'; label = '測定中' }
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 999,
      background: '#fff', border: '1px solid #ebe7e2',
      fontSize: 12, color: '#5c5470', fontWeight: 600,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 4, background: dotColor,
        boxShadow: live && stable ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none',
      }} />
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
        {live && value != null ? `${value.toFixed(1)} g` : '---'}
      </span>
      <span style={{ opacity: 0.6 }}>· {label}</span>
    </div>
  )
}

function CountBox({ label, value, tone, dimmed }: {
  label: string
  value: number | null
  tone: 'neutral' | 'ok' | 'ng'
  dimmed?: boolean  // 値変動中 (確定値ではない) の控えめ表示
}) {
  const palette = tone === 'ok'
    ? { bg: '#f0fdf4', border: '#86efac', text: '#047857', subText: '#059669' }
    : tone === 'ng'
      ? { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c', subText: '#dc2626' }
      : { bg: '#fafaf9', border: '#ebe7e2', text: '#1a1625', subText: '#7c7494' }
  return (
    <div style={{
      flex: 1, textAlign: 'center', padding: '14px 12px',
      background: palette.bg, border: `1.5px solid ${palette.border}`,
      borderRadius: 12,
      opacity: dimmed ? 0.65 : 1,
      transition: 'opacity 0.2s ease',
    }}>
      <p style={{
        margin: 0, fontSize: 11, fontWeight: 700,
        color: palette.subText, letterSpacing: '0.08em',
      }}>{label}</p>
      <p style={{
        margin: '4px 0 0', fontFamily: "'JetBrains Mono', monospace",
        fontSize: 32, fontWeight: 800, color: palette.text,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>
        {value !== null ? value : '—'}
        <span style={{ fontSize: 14, fontWeight: 600, marginLeft: 2 }}>個</span>
      </p>
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
      <PanelHeader emoji="⚖" title="秤の準備" subtitle="空箱を秤に載せて、風袋引きを押してください" />
      <div style={{ padding: '20px 32px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <ScaleStatusBadge value={scaleValue} stable={scaleStable} live={scaleLive} />
        </div>

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
          {taring ? '風袋引き中…' : '風袋引き'}
          {canTare && !taring && <KeyHint />}
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

// ボタン内に「Space」ヒントを小さく表示
function KeyHint() {
  return (
    <span style={{
      marginLeft: 10, padding: '2px 8px', borderRadius: 6,
      background: 'rgba(255,255,255,0.22)',
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      verticalAlign: 'middle',
    }}>
      Space
    </span>
  )
}

function VerifyingPanel({ cameraCount, scaleValue, scaleStable, scaleLive, unitWeight }: {
  cameraCount: number
  scaleValue: number | null
  scaleStable: boolean
  scaleLive: boolean
  unitWeight: number
}) {
  // 秤の現在の個数 (live)。 値が無いか単重未設定なら null
  const liveScaleCount = scaleLive && scaleValue != null && unitWeight > 0
    ? Math.round(scaleValue / unitWeight)
    : null
  const status = !scaleLive
    ? '秤の応答を待っています…'
    : !scaleStable
      ? '秤を確認中… (測定中)'
      : '秤を確認中…'
  return (
    <>
      <PanelHeader emoji="📦" title={`${cameraCount} 個 完成`} subtitle="秤で確認します" />
      <div style={{ padding: '20px 32px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <CountBox label="カメラ" value={cameraCount} tone="ok" />
          <span style={{
            fontSize: 22, fontWeight: 700, color: '#b0a9bc',
            fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
          }}>⋯</span>
          <CountBox label="秤" value={liveScaleCount} tone="neutral" dimmed={!scaleStable} />
        </div>
        <p style={{
          textAlign: 'center', fontSize: 13, color: '#7c7494',
          margin: 0, fontWeight: 600,
        }}>
          {status}
        </p>
        {scaleLive && scaleValue != null && (
          <p style={{
            textAlign: 'center', fontSize: 11, color: '#9994a8',
            margin: '4px 0 0', fontFamily: "'JetBrains Mono', monospace",
            fontVariantNumeric: 'tabular-nums',
          }}>
            {scaleValue.toFixed(1)} g
          </p>
        )}
      </div>
    </>
  )
}

function ResultOkPanel({ snapshot, scaleValue, scaleStable, scaleLive, taring, error, onConfirmAndTare }: {
  snapshot: { cameraCount: number; scaleCount: number; measuredG: number; expectedG: number }
  scaleValue: number | null; scaleStable: boolean; scaleLive: boolean
  taring: boolean; error: string | null
  onConfirmAndTare: () => void
}) {
  // 風袋引きは作業者の責任で押す (重量ガードは誤判定が多く外す)
  const canTare = scaleLive && scaleStable && !taring
  const reason = !scaleLive ? '秤が応答していません'
    : !scaleStable ? '秤が安定するのを待っています'
    : null
  return (
    <>
      <PanelHeader emoji="✓" title="員数 OK" tone="ok" />
      <div style={{ padding: '20px 32px 28px' }}>
        {/* B vs C の対応を見せる: カメラ N 個 = 秤 N 個 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
          animation: 'resultFlash 0.8s ease-out',
          borderRadius: 12,
        }}>
          <CountBox label="カメラ" value={snapshot.cameraCount} tone="ok" />
          <span style={{
            fontSize: 24, fontWeight: 800, color: '#10b981',
            fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
          }}>=</span>
          <CountBox label="秤" value={snapshot.scaleCount} tone="ok" />
        </div>
        <p style={{
          textAlign: 'center', fontSize: 12, color: '#059669', fontWeight: 600,
          marginTop: 0, marginBottom: 20,
        }}>
          2系統で個数が一致しました
        </p>

        {/* 次の箱へ向けた案内 */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 14,
          border: '1px solid #ebe7e2',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: '#5c5470', textAlign: 'center' }}>
            満箱を下ろして、空箱を載せ替えてください
          </p>
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <ScaleStatusBadge value={scaleValue} stable={scaleStable} live={scaleLive} />
          </div>
        </div>

        {error && (
          <p style={{ fontSize: 13, color: '#dc2626', textAlign: 'center', marginBottom: 12 }}>{error}</p>
        )}

        <button
          onClick={onConfirmAndTare}
          disabled={!canTare}
          style={{
            width: '100%', height: 52,
            fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
            border: 'none', borderRadius: 14, cursor: canTare ? 'pointer' : 'default',
            background: canTare ? 'linear-gradient(135deg, #059669, #047857)' : '#e8e4df',
            color: canTare ? '#fff' : '#b0a9bc',
            boxShadow: canTare ? '0 4px 16px rgba(5,150,105,0.35)' : 'none',
          }}
        >
          {taring ? '風袋引き中…' : '風袋引き'}
          {canTare && !taring && <KeyHint />}
        </button>
        {!canTare && !taring && reason && (
          <p style={{
            fontSize: 12, color: '#c2410c', textAlign: 'center',
            marginTop: 10, marginBottom: 0, fontWeight: 600,
          }}>
            {reason}
          </p>
        )}
      </div>
    </>
  )
}

