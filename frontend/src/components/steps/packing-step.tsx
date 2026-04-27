import { useState, useCallback, useRef, useEffect } from 'react'
import { useScaleStore } from '@/stores/scaleStore'
import { useScalePolling } from '@/hooks/useScalePolling'
import { scaleApi } from '@/api/scale'
import { productsApi } from '@/api/products'
import type { PackingConfig } from '@/types'

interface Props {
  productId: string
  piecesPerBox: number
  initialConfig?: PackingConfig | null
  onSaved?: (config: PackingConfig | null) => void
}

const DEFAULT_SAMPLE_COUNT = 10

// サンプリングの内部フェーズ
type SamplingPhase =
  | 'idle'           // 開始前
  | 'taring'         // ゼロ調整中（API呼び出し中）
  | 'baseline_wait'  // ゼロ確認中（最初の安定値を待っている）
  | 'item_wait'      // 次の部品を待っている
  | 'measuring'      // 部品を載せた、安定待ち
  | 'just_recorded'  // 記録完了フラッシュ
  | 'done'           // 全サンプル完了

export function PackingStep({ productId, piecesPerBox: piecesPerBoxProp, initialConfig, onSaved }: Props) {
  const [phase, setPhase]       = useState<SamplingPhase>('idle')
  // サンプリング中はポーリングを速くする (安定遷移の取りこぼし防止)
  const pollInterval = phase === 'idle' || phase === 'done' ? 500 : 200
  useScalePolling(pollInterval)

  const scaleValue  = useScaleStore((s) => s.value_g)
  const scaleStable = useScaleStore((s) => s.stable)
  const scalePort   = useScaleStore((s) => s.portOpen)
  const scaleLive   = useScaleStore((s) => s.live)

  const [piecesPerBox, setPiecesPerBox] = useState(piecesPerBoxProp)
  const [enabled, setEnabled]           = useState(initialConfig?.enabled ?? false)
  const [sampleCount, setSampleCount]   = useState(initialConfig?.sample_count ?? DEFAULT_SAMPLE_COUNT)
  const [toleranceG, setToleranceG]     = useState(initialConfig?.tolerance_g ?? 0)
  const [zeroTolG, setZeroTolG]         = useState(initialConfig?.zero_tolerance_g ?? 0.5)

  useEffect(() => {
    productsApi.getConfig(productId).then((cfg) => {
      if (cfg.pieces_per_box != null) setPiecesPerBox(cfg.pieces_per_box)
      if (cfg.packing) {
        setEnabled(cfg.packing.enabled)
        setSampleCount(cfg.packing.sample_count || DEFAULT_SAMPLE_COUNT)
        setToleranceG(cfg.packing.tolerance_g || 0)
        setZeroTolG(cfg.packing.zero_tolerance_g ?? 0.5)
      }
    }).catch(() => {})
  }, [productId])

  const [samples, setSamples]   = useState<number[]>([])
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [lastRecordedG, setLastRecordedG] = useState<number | null>(null)

  const lastStableRef    = useRef<number | null>(null)
  const prevStableRef    = useRef(scaleStable)
  const waitingRef       = useRef(false)

  // サンプリング中は短周期ポーリングに切り替え（安定遷移取りこぼし防止）。
  // useScalePolling を 200ms で上書き起動する効果を、グローバルな intervalMs 変更で行う。
  useEffect(() => {
    // phase ごとに ポーリング間隔は useScalePolling(500) 既定のまま。
    // 安定遷移の取りこぼし対策は scaleStable の履歴監視で担保する。
  }, [phase])

  // 安定→不安定→安定の遷移を検出してサンプルを記録
  useEffect(() => {
    if (phase !== 'baseline_wait' && phase !== 'item_wait' && phase !== 'measuring') return
    const wasUnstable = !prevStableRef.current
    prevStableRef.current = scaleStable

    if (!scaleStable) {
      // 不安定になった = 部品が載った
      if (phase === 'item_wait' && waitingRef.current) {
        waitingRef.current = false
        setPhase('measuring')
      }
      return
    }

    // stable になった
    if (!wasUnstable) return  // 安定のまま → 無視

    const currentVal = scaleValue
    if (currentVal == null) return

    if (phase === 'baseline_wait') {
      // ゼロ確認完了
      lastStableRef.current = currentVal
      setPhase('item_wait')
      waitingRef.current = true
      return
    }

    if (phase === 'measuring') {
      const prev = lastStableRef.current
      if (prev == null) return
      const delta = currentVal - prev
      if (delta > 0.3) {
        lastStableRef.current = currentVal
        setLastRecordedG(delta)
        setPhase('just_recorded')
        setSamples((s) => [...s, delta])
      } else {
        // 重量変化なし（部品を取り除いた可能性）→ item_wait に戻す
        setPhase('item_wait')
        waitingRef.current = true
      }
    }
  }, [scaleStable, scaleValue, phase])

  // just_recorded → 1秒後に次のステップへ
  useEffect(() => {
    if (phase !== 'just_recorded') return
    const timer = setTimeout(() => {
      setSamples((s) => {
        if (s.length >= sampleCount) {
          setPhase('done')
        } else {
          setPhase('item_wait')
          waitingRef.current = true
        }
        return s
      })
    }, 1200)
    return () => clearTimeout(timer)
  }, [phase, sampleCount])

  const handleStart = useCallback(async () => {
    setError(null)
    setPhase('taring')
    try {
      const result = await scaleApi.tare()
      if (!result.ok) {
        setError('ゼロ調整が完了しませんでした。秤を確認してもう一度お試しください。')
        setPhase('idle')
        return
      }
      lastStableRef.current = null
      prevStableRef.current = false
      waitingRef.current = false
      setSamples([])
      setLastRecordedG(null)
      setPhase('baseline_wait')
    } catch {
      setError('秤との通信に失敗しました。')
      setPhase('idle')
    }
  }, [])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setSamples([])
    lastStableRef.current = null
    waitingRef.current = false
    setLastRecordedG(null)
    setError(null)
  }, [])

  const handleRemoveLast = useCallback(() => {
    if (samples.length === 0) return
    const removed = samples[samples.length - 1]
    if (lastStableRef.current != null) {
      lastStableRef.current -= removed
    }
    setSamples((s) => s.slice(0, -1))
    setPhase('item_wait')
    waitingRef.current = true
  }, [samples])

  const stats = computeStats(samples, piecesPerBox)

  useEffect(() => {
    if (phase === 'done' && stats) {
      setToleranceG(parseFloat(stats.recommended.toFixed(1)))
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      let config: PackingConfig | null = null
      if (enabled && stats) {
        config = {
          enabled: true,
          unit_weight_g: parseFloat(stats.mean.toFixed(3)),
          unit_weight_stddev_g: parseFloat(stats.stddev.toFixed(3)),
          sample_count: sampleCount,
          tolerance_g: parseFloat(toleranceG.toFixed(1)),
          zero_tolerance_g: zeroTolG,
        }
      } else if (!enabled) {
        config = { enabled: false, unit_weight_g: 0, unit_weight_stddev_g: 0, sample_count: 0, tolerance_g: 0, zero_tolerance_g: zeroTolG }
      }
      await productsApi.saveConfig(productId, { packing: config ?? undefined })
      setSaved(true)
      onSaved?.(config)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }, [enabled, stats, sampleCount, toleranceG, zeroTolG, productId, onSaved])

  // ─── レンダリング ─────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ON/OFF トグル */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '16px 20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#1a1625', margin: 0 }}>
            計量チェック機能を使う
          </p>
          <p style={{ fontSize: 12, color: '#9994a8', marginTop: 2, marginBottom: 0 }}>
            箱完成時に秤で員数を自動検証します
          </p>
        </div>
        <button
          onClick={() => { setEnabled((e) => !e); setSaved(false) }}
          style={{
            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
            background: enabled ? '#6366f1' : '#d4d0dc',
            position: 'relative', transition: 'background 0.2s ease', flexShrink: 0,
          }}
        >
          <div style={{
            position: 'absolute', top: 3, left: enabled ? 23 : 3,
            width: 18, height: 18, borderRadius: 9, background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            transition: 'left 0.2s ease',
          }} />
        </button>
      </div>

      {!enabled && (
        <button onClick={handleSave} disabled={saving} style={primaryBtnStyle(saving)}>
          {saving ? '保存中…' : saved ? '✓ 保存しました' : '保存'}
        </button>
      )}

      {enabled && (
        <>
          {/* 秤の接続・通信警告 */}
          {!scalePort && (
            <div style={{
              background: '#fef2f2', borderRadius: 12, padding: '12px 16px',
              border: '1.5px solid #fca5a5',
              fontSize: 13, color: '#dc2626', fontWeight: 600,
            }}>
              秤が接続されていません。画面上部の「秤 未接続」ボタンから接続してください。
            </div>
          )}
          {scalePort && !scaleLive && (
            <div style={{
              background: '#fff7ed', borderRadius: 12, padding: '12px 16px',
              border: '1.5px solid #fed7aa',
              fontSize: 13, color: '#c2410c', fontWeight: 600,
            }}>
              秤からデータが届いていません。電源・ケーブル・通信設定 (COMポート/ボーレート) を確認してください。
            </div>
          )}

          {/* サンプル数・箱入数 */}
          <div style={cardStyle}>
            <SectionLabel>基本設定</SectionLabel>
            <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>採取するサンプル数</label>
                <input
                  key={sampleCount}
                  type="number" min={3} max={30}
                  defaultValue={sampleCount}
                  onBlur={(e) => {
                    const n = parseInt(e.target.value, 10)
                    setSampleCount(isNaN(n) ? DEFAULT_SAMPLE_COUNT : Math.max(3, Math.min(30, n)))
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  style={inputStyle}
                />
                <p style={{ fontSize: 11, color: '#b0a9bc', marginTop: 4 }}>
                  多いほど精度が上がります（推奨: 10個）
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>箱入数</label>
                <div style={{
                  height: 38, padding: '0 12px',
                  border: '1.5px solid #e8e4df', borderRadius: 10,
                  display: 'flex', alignItems: 'center',
                  fontSize: 14, fontWeight: 600, color: '#1a1625',
                  background: '#f8f6f4',
                }}>
                  {piecesPerBox > 0 ? `${piecesPerBox} 個` : '基本設定で設定してください'}
                </div>
              </div>
            </div>
          </div>

          {/* ── フェーズ: 開始前 ── */}
          {phase === 'idle' && (
            <div style={cardStyle}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1625', margin: '0 0 12px' }}>
                空の箱（または何も載せない状態）で秤を準備したら、ゼロ調整を開始してください
              </p>

              <ScaleDisplay value={scaleValue} stable={scaleStable} live={scaleLive} />

              {error && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#dc2626' }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleStart}
                disabled={!scaleLive}
                style={{ ...primaryBtnStyle(!scaleLive), marginTop: 14 }}
              >
                ゼロ調整して開始
              </button>
            </div>
          )}

          {/* ── フェーズ: ゼロ調整中 ── */}
          {phase === 'taring' && (
            <div style={cardStyle}>
              <SectionLabel>ゼロ調整中</SectionLabel>
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <Spinner />
                <p style={{ fontSize: 14, color: '#5c5470', marginTop: 12 }}>
                  秤を 0 g にリセットしています…
                </p>
              </div>
              <ScaleDisplay value={scaleValue} stable={scaleStable} live={scaleLive} />
            </div>
          )}

          {/* ── フェーズ: ゼロ確認中 ── */}
          {phase === 'baseline_wait' && (
            <div style={cardStyle}>
              <SectionLabel>ゼロ確認中</SectionLabel>
              <ScaleDisplay value={scaleValue} stable={scaleStable} live={scaleLive} large />
              <div style={{ marginTop: 12, padding: '12px 14px', background: '#fafaf9', borderRadius: 10, border: '1px solid #e8e4df' }}>
                <p style={{ fontSize: 13, color: '#7c7494', margin: 0, textAlign: 'center' }}>
                  秤が安定するまでお待ちください
                </p>
              </div>
            </div>
          )}

          {/* ── フェーズ: 部品追加待ち ── */}
          {phase === 'item_wait' && (
            <SamplingCard
              samples={samples}
              sampleCount={sampleCount}
              scaleValue={scaleValue}
              scaleStable={scaleStable}
              scaleLive={scaleLive}
              onRemoveLast={handleRemoveLast}
              onReset={handleReset}
            >
              <div style={{
                padding: '14px 18px', borderRadius: 12,
                background: 'linear-gradient(135deg, #eef2ff, #f0fdf4)',
                border: '2px solid #6366f1',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: '#6366f1', margin: '0 0 4px' }}>
                  第 {samples.length + 1} 個目
                </p>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1625', margin: 0 }}>
                  OK 品を 1 個、秤に追加してください
                </p>
              </div>
            </SamplingCard>
          )}

          {/* ── フェーズ: 安定待ち（測定中） ── */}
          {phase === 'measuring' && (
            <SamplingCard
              samples={samples}
              sampleCount={sampleCount}
              scaleValue={scaleValue}
              scaleStable={scaleStable}
              scaleLive={scaleLive}
              onRemoveLast={handleRemoveLast}
              onReset={handleReset}
            >
              <div style={{
                padding: '14px 18px', borderRadius: 12,
                background: '#f8f6f4', border: '2px solid #e8e4df',
                textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <Spinner small />
                <p style={{ fontSize: 14, color: '#7c7494', margin: 0 }}>
                  測定中…しばらくお待ちください
                </p>
              </div>
            </SamplingCard>
          )}

          {/* ── フェーズ: 記録完了フラッシュ ── */}
          {phase === 'just_recorded' && (
            <SamplingCard
              samples={samples}
              sampleCount={sampleCount}
              scaleValue={scaleValue}
              scaleStable={scaleStable}
              scaleLive={scaleLive}
              onRemoveLast={handleRemoveLast}
              onReset={handleReset}
            >
              <div style={{
                padding: '14px 18px', borderRadius: 12,
                background: '#f0fdf4', border: '2px solid #86efac',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: 22, margin: '0 0 4px' }}>✓</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#059669', margin: '0 0 2px' }}>
                  記録しました
                </p>
                {lastRecordedG != null && (
                  <p style={{ fontSize: 13, color: '#34d399', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                    {lastRecordedG.toFixed(2)} g
                  </p>
                )}
              </div>
            </SamplingCard>
          )}

          {/* ── フェーズ: 完了 → 結果表示 ── */}
          {phase === 'done' && stats && (
            <div style={cardStyle}>
              <SectionLabel>校正結果</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, marginBottom: 16 }}>
                <StatCell label="サンプル数" value={`${samples.length} 個`} />
                <StatCell label="平均単重" value={`${stats.mean.toFixed(2)} g`} />
                <StatCell label="標準偏差 σ" value={`${stats.stddev.toFixed(3)} g`} />
                <StatCell label="最小 / 最大" value={`${stats.min.toFixed(2)} / ${stats.max.toFixed(2)} g`} />
              </div>

              <div style={{
                background: '#f5f3ff', borderRadius: 10, padding: '12px 14px', marginBottom: 14,
                border: '1.5px solid #c4b5fd',
              }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>
                  推奨許容誤差
                </p>
                <p style={{ fontSize: 22, fontWeight: 800, color: '#6366f1', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                  ± {stats.recommended.toFixed(1)} g
                </p>
                <p style={{ fontSize: 11, color: '#7c7494', margin: '4px 0 0' }}>
                  3σ × √{piecesPerBox} = {stats.recommended.toFixed(2)} g
                </p>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={labelStyle}>許容誤差</label>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 14, fontWeight: 700,
                    color: toleranceG > stats.maxSafe ? '#dc2626' : '#059669',
                  }}>
                    ± {toleranceG.toFixed(1)} g
                  </span>
                </div>
                <input
                  type="range"
                  min={Math.max(0.1, stats.minSafe).toFixed(1)}
                  max={Math.min(stats.maxSafe * 1.5, stats.mean * 0.8).toFixed(1)}
                  step={0.1}
                  value={toleranceG}
                  onChange={(e) => setToleranceG(Number(e.target.value))}
                  style={{ width: '100%', accentColor: toleranceG > stats.maxSafe ? '#ef4444' : '#6366f1' }}
                />
                {toleranceG > stats.maxSafe && (
                  <p style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
                    ⚠ ± {toleranceG.toFixed(1)} g を超えると 1 個不足を見逃すリスクがあります
                  </p>
                )}
                <p style={{ fontSize: 12, color: '#7c7494', marginTop: 4 }}>
                  {getToleranceExplanation(toleranceG, stats.mean)}
                </p>
              </div>

              <button onClick={handleReset} style={{ ...ghostBtnStyle, marginBottom: 8 }}>
                やり直す
              </button>
            </div>
          )}

          {phase === 'done' && stats && (
            <>
              {error && <p style={{ fontSize: 13, color: '#dc2626', textAlign: 'center' }}>{error}</p>}
              <button onClick={handleSave} disabled={saving} style={primaryBtnStyle(saving)}>
                {saving ? '保存中…' : saved ? '✓ 保存しました' : '保存'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ── サンプリング中の共通カード ─────────────────────── */

function SamplingCard({ samples, sampleCount, scaleValue, scaleStable, scaleLive, onRemoveLast, onReset, children }: {
  samples: number[]
  sampleCount: number
  scaleValue: number | null
  scaleStable: boolean
  scaleLive: boolean
  onRemoveLast: () => void
  onReset: () => void
  children: React.ReactNode
}) {
  const progress = samples.length / sampleCount
  return (
    <div style={cardStyle}>
      {/* ヘッダー: 進捗 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1625', whiteSpace: 'nowrap' }}>
          {samples.length} / {sampleCount} 個
        </span>
        <div style={{ flex: 1, height: 6, background: '#f0ede9', borderRadius: 3 }}>
          <div style={{
            height: '100%', borderRadius: 3,
            width: `${progress * 100}%`,
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 12, color: '#b0a9bc', whiteSpace: 'nowrap' }}>
          {Math.round(progress * 100)}%
        </span>
      </div>

      {/* 現在の指示 */}
      {children}

      {/* 秤の値 */}
      <ScaleDisplay value={scaleValue} stable={scaleStable} live={scaleLive} style={{ marginTop: 12 }} />

      {/* 記録済みリスト */}
      {samples.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 120, overflowY: 'auto' }}>
          {[...samples].reverse().map((s, ri) => {
            const i = samples.length - 1 - ri
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '3px 0', borderBottom: '1px solid #f0ede9',
                fontSize: 12, color: '#3d3654',
                fontFamily: "'JetBrains Mono', monospace",
                fontVariantNumeric: 'tabular-nums',
                opacity: ri === 0 ? 1 : 0.6,
              }}>
                <span style={{ color: '#9994a8' }}>{i + 1} 個目</span>
                <span>{s.toFixed(2)} g</span>
              </div>
            )
          })}
        </div>
      )}

      {/* 操作ボタン */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {samples.length > 0 && (
          <button onClick={onRemoveLast} style={ghostBtnStyle}>直前を取り消す</button>
        )}
        <button onClick={onReset} style={{ ...ghostBtnStyle, color: '#dc2626', borderColor: '#fca5a5' }}>
          最初からやり直す
        </button>
      </div>
    </div>
  )
}

/* ── 統計計算 ───────────────────────────────────────── */

interface Stats {
  mean: number
  stddev: number
  min: number
  max: number
  recommended: number
  minSafe: number
  maxSafe: number
}

function computeStats(samples: number[], n: number): Stats | null {
  if (samples.length < 2) return null
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length - 1)
  const stddev = Math.sqrt(variance)
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const recommended = 3 * stddev * Math.sqrt(n)
  return { mean, stddev, min, max, recommended, minSafe: recommended, maxSafe: mean / 2 }
}

function getToleranceExplanation(tol: number, unitW: number): string {
  if (unitW <= 0) return ''
  const detectable = Math.ceil(tol / unitW)
  return `± ${tol.toFixed(1)} g — ${detectable} 個以上の過不足で NG になります`
}

/* ── UI コンポーネント ───────────────────────────────── */


function ScaleDisplay({ value, stable, live, large, style }: {
  value: number | null
  stable: boolean
  live: boolean
  large?: boolean
  style?: React.CSSProperties
}) {
  const color = !live ? '#b0a9bc' : stable ? '#059669' : '#d97706'
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 6,
      padding: large ? '12px 16px' : '8px 12px',
      background: '#f8f6f4', borderRadius: 10,
      ...style,
    }}>
      <span style={{ fontSize: large ? 32 : 24, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
        {!live ? '---' : value != null ? value.toFixed(1) : '---'}
      </span>
      <span style={{ fontSize: large ? 16 : 14, color, fontWeight: 600 }}>g</span>
      {live && !stable && (
        <span style={{ fontSize: 10, color: '#d97706', opacity: 0.8, marginLeft: 4 }}>測定中</span>
      )}
      {live && stable && (
        <span style={{ fontSize: 10, color: '#059669', opacity: 0.7, marginLeft: 4 }}>安定</span>
      )}
      {!live && (
        <span style={{ fontSize: 11, color: '#b0a9bc', marginLeft: 4 }}>受信待ち</span>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, color: '#7c7494', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
      {children}
    </p>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f8f6f4', borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ fontSize: 11, color: '#9994a8', margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: '#1a1625', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
    </div>
  )
}

function Spinner({ small }: { small?: boolean }) {
  const size = small ? 16 : 28
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `${small ? 2 : 3}px solid #e8e4df`,
      borderTopColor: '#6366f1',
      animation: 'spin 0.8s linear infinite',
      display: 'inline-block',
    }} />
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 16, padding: '16px 20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#7c7494', marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 12px',
  border: '1.5px solid #e8e4df', borderRadius: 10,
  fontSize: 13, color: '#3d3654', fontFamily: "'DM Sans', system-ui, sans-serif",
  outline: 'none', background: '#fff', boxSizing: 'border-box',
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%', height: 46,
    fontSize: 15, fontWeight: 700, fontFamily: "'DM Sans', system-ui, sans-serif",
    border: 'none', borderRadius: 14, cursor: disabled ? 'default' : 'pointer',
    background: disabled ? '#e8e4df' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
    color: disabled ? '#b0a9bc' : '#fff',
    boxShadow: disabled ? 'none' : '0 4px 14px rgba(99,102,241,0.3)',
    transition: 'all 0.2s ease',
  }
}

const ghostBtnStyle: React.CSSProperties = {
  flex: 1, height: 36,
  fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', system-ui, sans-serif",
  border: '1.5px solid #e8e4df', borderRadius: 10,
  cursor: 'pointer', background: 'transparent', color: '#7c7494',
}
