/**
 * Training Step — Configure and run model training
 * Camera is hidden. Full width for params + charts.
 */

import { useState, useEffect, useCallback } from 'react'
import { Line } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js'
import { useAppStore } from '@/stores/appStore'
import { useTrainingStore } from '@/stores/trainingStore'
import { useTrainingWS } from '@/hooks/useTrainingWS'
import { trainingApi } from '@/api/training'
import { Toast } from '@/components/layout/Toast'
import type { AugmentationConfig } from '@/types'

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

export function TrainingStepNew() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const loadModels = useTrainingStore((s) => s.loadModels)
  const isRunning = useTrainingStore((s) => s.isRunning)
  const epoch = useTrainingStore((s) => s.epoch)
  const total = useTrainingStore((s) => s.totalEpochs)
  const tLoss = useTrainingStore((s) => s.trainLoss)
  const tAcc = useTrainingStore((s) => s.trainAccuracy)
  const vLoss = useTrainingStore((s) => s.valLoss)
  const vAcc = useTrainingStore((s) => s.valAccuracy)
  const chart = useTrainingStore((s) => s.chartData)
  const batch = useTrainingStore((s) => s.batchProgress)
  const resetCharts = useTrainingStore((s) => s.resetCharts)

  useTrainingWS(true)

  const [name, setName] = useState('model_v1')
  const [roiId, setRoiId] = useState<string | null>(null)

  // ROI選択時にモデル名を自動設定
  const handleRoiChange = (id: string | null) => {
    setRoiId(id)
    if (id) {
      const roi = rois.find((r) => r.id === id)
      if (roi) setName(roi.name)
    } else {
      setName('model_v1')
    }
  }
  const [epochs, setEpochs] = useState(20)
  const [lr, setLr] = useState(0.001)
  const [bs, setBs] = useState(32)
  const [vs, setVs] = useState(0.2)
  const [imgSize, setImgSize] = useState(224)
  const [freeze, setFreeze] = useState(true)
  const [earlyStop, setEarlyStop] = useState(5)  // 0=無効
  const [augEnabled, setAugEnabled] = useState(true)
  const [aug, setAug] = useState<AugmentationConfig>({
    horizontal_flip: true, vertical_flip: false,
    rotation: 0.1, zoom: 0.1, brightness: 0.1, contrast: 0.1,
  })
  const [previews, setPreviews] = useState<string[]>([])

  useEffect(() => { if (productId) loadModels(productId) }, [productId, loadModels, isRunning])

  const start = async () => {
    if (!productId) return; resetCharts()
    try { await trainingApi.start(productId, { model_name: name, roi_id: roiId, epochs, learning_rate: lr, batch_size: bs, validation_split: vs, image_size: imgSize, freeze_base: freeze, augmentation: augEnabled ? aug : false, early_stop_patience: earlyStop } as Record<string, unknown>) }
    catch (e) { Toast.error(`学習開始に失敗: ${e}`) }
  }

  const startBatch = async () => {
    if (!productId) return; resetCharts()
    try { await trainingApi.startBatch(productId, { epochs, learning_rate: lr, batch_size: bs, validation_split: vs, image_size: imgSize, freeze_base: freeze, augmentation: augEnabled ? aug : false, early_stop_patience: earlyStop } as Record<string, unknown>) }
    catch (e) { Toast.error(`一括学習に失敗: ${e}`) }
  }

  const preview = useCallback(async () => {
    if (!productId) return
    try {
      const r = await trainingApi.augmentationPreview(productId, { augmentation: aug, image_size: imgSize, roi_id: roiId })
      setPreviews([r.original, ...r.samples])
    } catch { Toast.error('プレビューに失敗しました') }
  }, [productId, aug, imgSize, roiId])

  const pct = total > 0 ? (epoch / total) * 100 : 0

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top' as const, labels: { boxWidth: 10, font: { size: 11, family: "'DM Sans'" } } } },
    scales: {
      x: { grid: { color: '#f0ede9' }, ticks: { font: { size: 10 } } },
      y: { grid: { color: '#f0ede9' }, ticks: { font: { size: 10 } } },
    },
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>

      {/* ── Left: Parameters ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Panel title="学習パラメータ">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="対象ROI">
              <select value={roiId ?? ''} onChange={(e) => handleRoiChange(e.target.value || null)} style={selStyle}>
                <option value="">全体</option>
                {rois.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="モデル名">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inpStyle} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="エポック">
                <input type="number" min={1} max={200} value={epochs} onChange={(e) => setEpochs(+e.target.value)} style={inpStyle} />
              </Field>
              <Field label="学習率">
                <input type="number" min={0.00001} max={0.1} step={0.0001} value={lr} onChange={(e) => setLr(+e.target.value)} style={inpStyle} />
              </Field>
              <Field label="バッチサイズ">
                <select value={bs} onChange={(e) => setBs(+e.target.value)} style={selStyle}>
                  {[8, 16, 32, 64].map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="検証分割">
                <input type="number" min={0.1} max={0.5} step={0.05} value={vs} onChange={(e) => setVs(+e.target.value)} style={inpStyle} />
              </Field>
              <Field label="画像サイズ">
                <select value={imgSize} onChange={(e) => setImgSize(+e.target.value)} style={selStyle}>
                  {[128, 160, 192, 224].map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <div style={{ display: 'flex', alignItems: 'end', paddingBottom: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#3d3654', cursor: 'pointer' }}>
                  <input type="checkbox" checked={freeze} onChange={(e) => setFreeze(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#6366f1' }} />
                  ベース固定
                </label>
              </div>
            </div>

            {/* Augmentation toggle */}
            {/* Early stopping */}
            <Field label="アーリーストップ (patience)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min={0} max={50} value={earlyStop}
                  onChange={(e) => setEarlyStop(+e.target.value)} style={{ ...inpStyle, width: 80 }} />
                <span style={{ fontSize: 11, color: '#9994a8' }}>
                  {earlyStop > 0 ? `${earlyStop}エポック改善なしで停止` : '無効'}
                </span>
              </div>
            </Field>

            {/* Data augmentation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#3d3654', cursor: 'pointer' }}>
                <input type="checkbox" checked={augEnabled} onChange={(e) => setAugEnabled(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#6366f1' }} />
                データ拡張
              </label>
            </div>

            {augEnabled && (
              <div style={{ background: '#faf9f7', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={checkStyle}><input type="checkbox" checked={aug.horizontal_flip} onChange={(e) => setAug({ ...aug, horizontal_flip: e.target.checked })} style={cbStyle} /> 水平反転</label>
                <label style={checkStyle}><input type="checkbox" checked={aug.vertical_flip} onChange={(e) => setAug({ ...aug, vertical_flip: e.target.checked })} style={cbStyle} /> 垂直反転</label>
                {(['rotation', 'zoom', 'brightness', 'contrast'] as const).map((k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 72, fontSize: 12, color: '#7c7494' }}>{k}</span>
                    <input type="range" min={0} max={0.3} step={0.01} value={aug[k]}
                      onChange={(e) => setAug({ ...aug, [k]: +e.target.value })}
                      style={{ flex: 1, height: 4, accentColor: '#6366f1' }} />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#7c7494', width: 32, textAlign: 'right' }}>
                      {aug[k].toFixed(2)}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={preview} style={{ ...ghostBtn, fontSize: 11, height: 30, padding: '0 12px' }}>プレビュー</button>
                  <button onClick={() => setAug({ horizontal_flip: true, vertical_flip: false, rotation: 0.1, zoom: 0.1, brightness: 0.1, contrast: 0.1 })}
                    style={{ ...ghostBtn, fontSize: 11, height: 30, padding: '0 12px' }}>リセット</button>
                </div>
                {previews.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 4 }}>
                    {previews.map((b, i) => (
                      <img key={i} src={`data:image/jpeg;base64,${b}`} alt=""
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, border: '1px solid #ebe7e2' }} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={start} disabled={isRunning} style={{ ...actionBtn, opacity: isRunning ? 0.4 : 1 }}>学習開始</button>
            <button onClick={startBatch} disabled={isRunning} style={{ ...ghostBtn, opacity: isRunning ? 0.4 : 1 }}>全ROI一括</button>
            <button onClick={() => trainingApi.stop()} disabled={!isRunning} style={{
              ...ghostBtn, color: isRunning ? '#dc2626' : '#d4d0dc',
              borderColor: isRunning ? '#fca5a5' : '#e0dcd7',
            }}>停止</button>
          </div>

          {batch && (
            <div style={{
              marginTop: 10, padding: '8px 14px', borderRadius: 8,
              background: '#eef2ff', color: '#4338ca',
              fontSize: 12, fontWeight: 600,
            }}>
              ROI {batch.index + 1}/{batch.total}: {batch.roiName}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Right: Progress + Charts ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Progress */}
        <Panel title="学習進捗">
          {total > 0 ? (
            <>
              <div style={{ height: 6, background: '#ebe7e2', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  width: `${pct}%`, transition: 'width 0.3s ease',
                }} />
              </div>
              <p style={{ textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#7c7494', marginBottom: 16 }}>
                {epoch} / {total}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <Metric label="Loss" value={tLoss?.toFixed(4)} />
                <Metric label="精度" value={tAcc != null ? `${(tAcc * 100).toFixed(1)}%` : undefined} />
                <Metric label="Val Loss" value={vLoss?.toFixed(4)} />
                <Metric label="Val精度" value={vAcc != null ? `${(vAcc * 100).toFixed(1)}%` : undefined} />
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: '#b0a9bc', textAlign: 'center', padding: '28px 0' }}>
              学習を開始してください
            </p>
          )}
        </Panel>

        {/* Loss chart */}
        <Panel title="損失">
          <div style={{ height: 220 }}>
            <Line data={{
              labels: chart.labels,
              datasets: [
                { label: 'Train', data: chart.loss, borderColor: '#6366f1', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                { label: 'Val', data: chart.valLoss, borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, tension: 0.3 },
              ],
            }} options={chartOpts} />
          </div>
        </Panel>

        {/* Accuracy chart */}
        <Panel title="精度">
          <div style={{ height: 220 }}>
            <Line data={{
              labels: chart.labels,
              datasets: [
                { label: 'Train', data: chart.accuracy, borderColor: '#10b981', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                { label: 'Val', data: chart.valAccuracy, borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, tension: 0.3 },
              ],
            }} options={chartOpts} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

/* ── Shared ── */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0ede9' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#7c7494', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {title}
        </span>
      </div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#9994a8', marginBottom: 5, letterSpacing: '0.03em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Metric({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '14px 8px', background: '#faf9f7', borderRadius: 10, border: '1px solid #ebe7e2' }}>
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#b0a9bc', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700, color: '#1a1625', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '--'}
      </p>
    </div>
  )
}

const selStyle: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans'", color: '#3d3654', background: '#faf9f7', border: '1.5px solid #e8e4df', borderRadius: 10, appearance: 'none', outline: 'none', cursor: 'pointer', backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }
const inpStyle: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans'", color: '#3d3654', background: '#faf9f7', border: '1.5px solid #e8e4df', borderRadius: 10, outline: 'none' }
const actionBtn: React.CSSProperties = { height: 36, padding: '0 18px', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans'", border: 'none', borderRadius: 10, cursor: 'pointer', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', boxShadow: '0 2px 8px rgba(99,102,241,0.25)' }
const ghostBtn: React.CSSProperties = { height: 36, padding: '0 16px', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans'", color: '#5c5470', background: '#fff', border: '1.5px solid #e0dcd7', borderRadius: 10, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#3d3654', cursor: 'pointer' }
const cbStyle: React.CSSProperties = { width: 15, height: 15, accentColor: '#6366f1' }
