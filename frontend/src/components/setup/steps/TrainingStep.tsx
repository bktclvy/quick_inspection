import { useState, useEffect, useCallback } from 'react'
import { Line } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js'
import { useAppStore } from '@/stores/appStore'
import { useTrainingStore } from '@/stores/trainingStore'
import { useTrainingWS } from '@/hooks/useTrainingWS'
import { trainingApi } from '@/api/training'
import { Toast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AugmentationConfig } from '@/types'

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

export function TrainingStep() {
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
  const [epochs, setEpochs] = useState(20)
  const [lr, setLr] = useState(0.001)
  const [bs, setBs] = useState(32)
  const [vs, setVs] = useState(0.2)
  const [imgSize, setImgSize] = useState(224)
  const [freeze, setFreeze] = useState(true)
  const [showAug, setShowAug] = useState(false)
  const [aug, setAug] = useState<AugmentationConfig>({ horizontal_flip: true, vertical_flip: false, rotation: 0.1, zoom: 0.1, brightness: 0.1, contrast: 0.1 })
  const [previews, setPreviews] = useState<string[]>([])

  useEffect(() => { if (productId) loadModels(productId) }, [productId, loadModels, isRunning])

  const start = async () => {
    if (!productId) return; resetCharts()
    try { await trainingApi.start(productId, { model_name: name, roi_id: roiId, epochs, learning_rate: lr, batch_size: bs, validation_split: vs, image_size: imgSize, freeze_base: freeze, augmentation: aug }) }
    catch (e) { Toast.error(`失敗: ${e}`) }
  }

  const startBatch = async () => {
    if (!productId) return; resetCharts()
    try { await trainingApi.startBatch(productId, { epochs, learning_rate: lr, batch_size: bs, validation_split: vs, image_size: imgSize, freeze_base: freeze, augmentation: aug }) }
    catch (e) { Toast.error(`失敗: ${e}`) }
  }

  const preview = useCallback(async () => {
    if (!productId) return
    try { const r = await trainingApi.augmentationPreview(productId, { augmentation: aug, image_size: imgSize, roi_id: roiId }); setPreviews([r.original, ...r.samples]) }
    catch { Toast.error('プレビュー失敗') }
  }, [productId, aug, imgSize, roiId])

  const pct = total > 0 ? (epoch / total) * 100 : 0
  const co = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' as const, labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { x: { display: true }, y: { display: true } } }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: '340px 1fr' }}>
      {/* Left: Params */}
      <div className="space-y-3">
        <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
          <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">学習パラメータ</h3>
          <div className="space-y-3">
            <Field label="対象ROI">
              <select className="w-full h-8 px-2 text-[13px] border rounded-lg shadow-sm" value={roiId ?? ''} onChange={(e) => setRoiId(e.target.value || null)}>
                <option value="">全体</option>
                {rois.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="モデル名"><Input className="h-8 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="エポック"><Input type="number" className="h-8 text-[13px]" min={1} max={200} value={epochs} onChange={(e) => setEpochs(+e.target.value)} /></Field>
              <Field label="学習率"><Input type="number" className="h-8 text-[13px]" min={0.00001} max={0.1} step={0.0001} value={lr} onChange={(e) => setLr(+e.target.value)} /></Field>
              <Field label="バッチ">
                <select className="w-full h-8 px-2 text-[13px] border rounded-lg shadow-sm" value={bs} onChange={(e) => setBs(+e.target.value)}>
                  {[8,16,32,64].map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="検証分割"><Input type="number" className="h-8 text-[13px]" min={0.1} max={0.5} step={0.05} value={vs} onChange={(e) => setVs(+e.target.value)} /></Field>
              <Field label="画像サイズ">
                <select className="w-full h-8 px-2 text-[13px] border rounded-lg shadow-sm" value={imgSize} onChange={(e) => setImgSize(+e.target.value)}>
                  {[128,160,192,224].map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-[13px] font-medium text-gray-700 cursor-pointer">
                  <input type="checkbox" className="rounded" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} />
                  ベース固定
                </label>
              </div>
            </div>

            <button onClick={() => setShowAug(!showAug)} className="text-[12px] font-medium text-gray-400 hover:text-gray-600">
              データ拡張 {showAug ? '▲' : '▼'}
            </button>

            {showAug && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={aug.horizontal_flip} onChange={(e) => setAug({...aug, horizontal_flip: e.target.checked})} /> 水平反転</label>
                <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={aug.vertical_flip} onChange={(e) => setAug({...aug, vertical_flip: e.target.checked})} /> 垂直反転</label>
                {(['rotation','zoom','brightness','contrast'] as const).map((k) => (
                  <div key={k} className="flex items-center gap-2 text-[12px]">
                    <span className="w-20 text-gray-500">{k}</span>
                    <input type="range" className="flex-1 h-1 accent-gray-700" min={0} max={0.3} step={0.01} value={aug[k]} onChange={(e) => setAug({...aug, [k]: +e.target.value})} />
                    <span className="font-mono text-[11px] w-8 text-right">{aug[k].toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={preview}>プレビュー</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setAug({ horizontal_flip: true, vertical_flip: false, rotation: 0.1, zoom: 0.1, brightness: 0.1, contrast: 0.1 })}>リセット</Button>
                </div>
                {previews.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 pt-2">
                    {previews.map((b, i) => <img key={i} src={`data:image/jpeg;base64,${b}`} className="w-full aspect-square object-cover rounded" />)}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={start} disabled={isRunning}>学習開始</Button>
            <Button size="sm" variant="outline" onClick={startBatch} disabled={isRunning}>全ROI一括</Button>
            <Button size="sm" variant="destructive" onClick={() => trainingApi.stop()} disabled={!isRunning}>停止</Button>
          </div>
          {batch && <p className="text-[12px] text-blue-600 bg-blue-50 rounded-md px-3 py-1.5 mt-2">ROI {batch.index+1}/{batch.total}: {batch.roiName}</p>}
        </div>
      </div>

      {/* Right: Progress + Charts */}
      <div className="space-y-3">
        <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
          <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">学習進捗</h3>
          {total > 0 ? (<>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-gray-900 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-center font-mono text-[12px] text-gray-500 mb-4">{epoch} / {total}</p>
            <div className="grid grid-cols-4 gap-2">
              <Metric label="Loss" value={tLoss?.toFixed(4)} />
              <Metric label="精度" value={tAcc != null ? `${(tAcc*100).toFixed(1)}%` : undefined} />
              <Metric label="Val Loss" value={vLoss?.toFixed(4)} />
              <Metric label="Val精度" value={vAcc != null ? `${(vAcc*100).toFixed(1)}%` : undefined} />
            </div>
          </>) : <p className="text-[13px] text-gray-300 text-center py-6">学習を開始してください</p>}
        </div>

        <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
          <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-2">損失</h3>
          <div className="h-[200px]">
            <Line data={{ labels: chart.labels, datasets: [
              { label: 'Train', data: chart.loss, borderColor: '#1e40af', borderWidth: 1.5, pointRadius: 0, tension: .3 },
              { label: 'Val', data: chart.valLoss, borderColor: '#d97706', borderWidth: 1.5, pointRadius: 0, tension: .3 },
            ]}} options={co} />
          </div>
        </div>

        <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
          <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-2">精度</h3>
          <div className="h-[200px]">
            <Line data={{ labels: chart.labels, datasets: [
              { label: 'Train', data: chart.accuracy, borderColor: '#059669', borderWidth: 1.5, pointRadius: 0, tension: .3 },
              { label: 'Val', data: chart.valAccuracy, borderColor: '#d97706', borderWidth: 1.5, pointRadius: 0, tension: .3 },
            ]}} options={co} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>{children}</div>
}

function Metric({ label, value }: { label: string; value?: string }) {
  return (
    <div className="text-center py-3 bg-gray-50 rounded-lg">
      <p className="text-[9px] font-bold tracking-wider text-gray-400 uppercase">{label}</p>
      <p className="font-mono text-[15px] font-bold text-gray-800 mt-1 tabular-nums">{value ?? '--'}</p>
    </div>
  )
}
