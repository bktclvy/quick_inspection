import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { InspectionConfig, TriggerMode } from '@/types'

interface Props { editMode: boolean; onToggleEdit: () => void }

export function ROISetupStep({ editMode, onToggleEdit }: Props) {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)
  const [config, setConfig] = useState<Partial<InspectionConfig>>({})
  const [hasBg, setHasBg] = useState(false)

  useEffect(() => {
    if (!productId) return
    productsApi.getConfig(productId).then(setConfig).catch(() => {})
    productsApi.backgroundStatus(productId).then((r) => setHasBg(r.has_background)).catch(() => {})
  }, [productId])

  const save = useCallback(async (u: Partial<InspectionConfig>) => {
    if (!productId) return
    const merged = { ...config, ...u }
    setConfig(merged)
    try { await productsApi.saveConfig(productId, merged) } catch { Toast.error('保存失敗') }
  }, [productId, config])

  const deleteROI = async (id: string) => {
    if (!productId || !confirm('削除しますか？')) return
    try { await productsApi.deleteROI(productId, id); await refreshROIs(); Toast.success('削除') } catch { Toast.error('失敗') }
  }

  const captureBg = async () => {
    if (!productId) return
    try { await productsApi.captureBackground(productId); setHasBg(true); Toast.success('背景撮影完了') } catch { Toast.error('失敗') }
  }

  const mode = (config.trigger_mode || 'auto_background') as TriggerMode

  return (
    <div className="space-y-3">
      {/* ROI List */}
      <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
        <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">ROI一覧</h3>
        {rois.length === 0 ? (
          <p className="text-[13px] text-gray-300 text-center py-6">ROIがありません</p>
        ) : (
          <div className="space-y-1.5">
            {rois.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg ring-1 ring-gray-100 text-[13px]">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color || '#4338ca' }} />
                <span className="flex-1 font-medium">{r.name}</span>
                {r.model_name && <span className="text-[11px] font-mono text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{r.model_name}</span>}
                <button onClick={() => deleteROI(r.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3">
          <Button size="sm" variant={editMode ? 'destructive' : 'default'} onClick={onToggleEdit}>
            {editMode ? 'キャンセル' : 'ROI追加'}
          </Button>
        </div>
      </div>

      {/* Parameters */}
      <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
        <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">検査パラメータ</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="col-span-2">
            <Label>トリガーモード</Label>
            <select className="w-full h-9 px-3 text-[13px] bg-white border rounded-lg shadow-sm"
              value={mode} onChange={(e) => save({ trigger_mode: e.target.value as TriggerMode })}>
              <option value="auto_background">自動 (背景差分)</option>
              <option value="auto_template">自動 (テンプレート)</option>
              <option value="manual">手動 (Space)</option>
            </select>
          </div>

          {mode === 'auto_background' && <>
            <div className="col-span-2 flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={captureBg}>背景撮影</Button>
              <span className={`text-[12px] font-medium ${hasBg ? 'text-emerald-600' : 'text-gray-400'}`}>
                {hasBg ? '撮影済み' : '未撮影'}
              </span>
            </div>
            <Slider label="存在閾値" min={5} max={80} step={1} value={config.presence_threshold ?? 25}
              onChange={(v) => save({ presence_threshold: v })} />
            <Slider label="安定閾値" min={1} max={30} step={0.5} value={config.stability_threshold ?? 5}
              onChange={(v) => save({ stability_threshold: v })} fmt={(v) => v.toFixed(1)} />
            <div>
              <Label>安定フレーム数</Label>
              <Input type="number" className="h-8 text-[13px]" min={2} max={30}
                value={config.stability_frames ?? 8} onChange={(e) => save({ stability_frames: Number(e.target.value) })} />
            </div>
            <Slider label="除去差分閾値" min={3} max={50} step={1} value={config.removal_diff_threshold ?? 15}
              onChange={(v) => save({ removal_diff_threshold: v })} />
          </>}

          {mode === 'auto_template' && <>
            <Slider label="マッチ閾値" min={0.5} max={0.99} step={0.01} value={config.match_threshold ?? 0.8}
              onChange={(v) => save({ match_threshold: v })} fmt={(v) => v.toFixed(2)} />
            <div>
              <Label>トリガーフレーム</Label>
              <Input type="number" className="h-8 text-[13px]" min={1} max={30}
                value={config.trigger_frames ?? 3} onChange={(e) => save({ trigger_frames: Number(e.target.value) })} />
            </div>
            <Slider label="除去閾値" min={0.1} max={0.8} step={0.01} value={config.removal_threshold ?? 0.5}
              onChange={(v) => save({ removal_threshold: v })} fmt={(v) => v.toFixed(2)} />
          </>}

          <div>
            <Label>結果表示 (ms)</Label>
            <Input type="number" className="h-8 text-[13px]" min={500} max={10000} step={100}
              value={config.judged_display_ms ?? 2000} onChange={(e) => save({ judged_display_ms: Number(e.target.value) })} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-semibold text-gray-500 mb-1">{children}</label>
}

function Slider({ label, min, max, step, value, onChange, fmt }: {
  label: string; min: number; max: number; step: number; value: number
  onChange: (v: number) => void; fmt?: (v: number) => string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="range" className="flex-1 h-1.5 accent-gray-900" min={min} max={max} step={step}
          value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="font-mono text-[12px] text-gray-500 w-10 text-right tabular-nums">
          {fmt ? fmt(value) : value}
        </span>
      </div>
    </div>
  )
}
