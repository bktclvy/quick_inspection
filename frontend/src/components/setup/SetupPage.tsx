import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ROICanvas } from '@/components/camera/ROICanvas'
import { Toast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { ROISetupStep } from './steps/ROISetupStep'
import { TemplateStep } from './steps/TemplateStep'
import { DatasetStep } from './steps/DatasetStep'
import { TrainingStep } from './steps/TrainingStep'
import { ModelAssignStep } from './steps/ModelAssignStep'

const STEPS = ['ROI設定', 'テンプレート', 'データ収集', '学習', 'モデル割当'] as const

export function SetupPage() {
  const [step, setStep] = useState(0)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [newName, setNewName] = useState('')

  const products = useAppStore((s) => s.products)
  const productId = useAppStore((s) => s.selectedProductId)
  const selectProduct = useAppStore((s) => s.selectProduct)
  const loadProducts = useAppStore((s) => s.loadProducts)
  const rois = useAppStore((s) => s.rois)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

  const handleAddProduct = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const p = await productsApi.create({ name })
      setNewName('')
      await loadProducts()
      selectProduct(p.id)
      Toast.success(`${name} を作成しました`)
    } catch { Toast.error('作成に失敗しました') }
  }

  const handleDeleteProduct = async (id: string, name: string) => {
    if (!confirm(`${name} を削除しますか？`)) return
    try {
      await productsApi.delete(id)
      if (productId === id) selectProduct(null)
      await loadProducts()
      Toast.success('削除しました')
    } catch { Toast.error('削除に失敗しました') }
  }

  const handleDrawComplete = useCallback(async (rect: { x: number; y: number; w: number; h: number }) => {
    if (!productId) return
    const name = prompt('ROI名を入力:', `ROI ${rois.length + 1}`)
    if (!name) return
    try {
      await productsApi.addROI(productId, { name, ...rect })
      await refreshROIs()
      Toast.success(`${name} を作成しました`)
    } catch { Toast.error('ROI作成に失敗しました') }
  }, [productId, rois.length, refreshROIs])

  const handleROIUpdate = useCallback(async (roiId: string, rect: { x: number; y: number; w: number; h: number }) => {
    if (!productId) return
    try {
      await productsApi.updateROI(productId, roiId, rect)
      await refreshROIs()
    } catch { Toast.error('ROI更新に失敗しました') }
  }, [productId, refreshROIs])

  const showCamera = step !== 3

  return (
    <div className="h-full flex bg-[#f5f5f3]">
      {/* ── Sidebar ── */}
      <div className="w-[220px] shrink-0 p-3 pr-0 flex flex-col">
        <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-3 flex flex-col flex-1 min-h-0">
          <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-2">製品一覧</h3>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
            {products.length === 0 ? (
              <p className="text-[13px] text-gray-300 text-center py-6">製品がありません</p>
            ) : products.map((p) => (
              <div key={p.id}
                onClick={() => selectProduct(p.id)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium cursor-pointer transition-colors',
                  p.id === productId
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-50',
                )}>
                <span className="flex-1 truncate">{p.name}</span>
                <span className={cn(
                  'text-[10px] font-mono tabular-nums',
                  p.id === productId ? 'text-gray-400' : 'text-gray-300',
                )}>
                  {p.roi_count}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteProduct(p.id, p.name) }}
                  className={cn(
                    'opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded transition-opacity',
                    p.id === productId ? 'text-gray-400 hover:text-red-300' : 'text-gray-400 hover:text-red-500',
                  )}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 mt-3 pt-3 border-t border-gray-100">
            <Input
              className="h-8 text-[13px]"
              placeholder="製品名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProduct()}
            />
            <Button size="sm" className="h-8 shrink-0" onClick={handleAddProduct}>追加</Button>
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-3 overflow-y-auto">
        {/* Stepper */}
        <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-1 flex gap-1 shrink-0">
          {STEPS.map((label, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150',
                i === step
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50',
              )}>
              <span className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                i === step ? 'bg-white/20' : 'bg-gray-100',
              )}>
                {i + 1}
              </span>
              {label}
            </button>
          ))}
        </div>

        {/* Camera */}
        {showCamera && (
          <div className="relative rounded-xl overflow-hidden bg-[#0a0d12] ring-1 ring-black/5 shadow-lg shrink-0"
            style={{ aspectRatio: '16/9', maxHeight: '44vh' }}>
            <CameraFeed onImgRef={setImgEl} />
            <ROICanvas imgEl={imgEl} rois={rois} readOnly={step !== 0} editMode={editMode}
              onDrawComplete={handleDrawComplete} onROIUpdate={handleROIUpdate}
              onEditModeExit={() => setEditMode(false)} />
          </div>
        )}

        {/* Step Content */}
        {step === 0 && <ROISetupStep editMode={editMode} onToggleEdit={() => setEditMode((m) => !m)} />}
        {step === 1 && <TemplateStep />}
        {step === 2 && <DatasetStep />}
        {step === 3 && <TrainingStep />}
        {step === 4 && <ModelAssignStep />}
      </div>
    </div>
  )
}
