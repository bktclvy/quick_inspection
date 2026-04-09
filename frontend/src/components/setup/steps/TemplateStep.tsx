import { useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/button'

export function TemplateStep() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)
  const [busy, setBusy] = useState<string | null>(null)

  const capture = async (roiId: string) => {
    if (!productId) return
    setBusy(roiId)
    try { await productsApi.captureTemplate(productId, roiId); await refreshROIs(); Toast.success('撮影完了') }
    catch { Toast.error('失敗') }
    finally { setBusy(null) }
  }

  if (rois.length === 0) {
    return <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
      <p className="text-[13px] text-gray-300 text-center py-6">先にROIを設定してください</p>
    </div>
  }

  return (
    <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
      <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-1">テンプレート管理</h3>
      <p className="text-[13px] text-gray-400 mb-4">各ROIの基準画像を撮影します。</p>
      <div className="space-y-2">
        {rois.map((roi) => (
          <div key={roi.id} className="flex items-center gap-3 p-3 rounded-lg ring-1 ring-gray-100">
            {roi.has_template && productId ? (
              <img className="w-20 h-14 rounded object-cover bg-gray-100 ring-1 ring-gray-200/50 shrink-0"
                src={`${productsApi.templateUrl(productId, roi.id)}?t=${Date.now()}`} alt={roi.name} />
            ) : (
              <div className="w-20 h-14 rounded bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center shrink-0">
                <span className="text-[10px] text-gray-300">未撮影</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold truncate">{roi.name}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{roi.has_template ? '撮影済み' : '未撮影'}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => capture(roi.id)} disabled={busy === roi.id}>
              {busy === roi.id ? '撮影中...' : '基準撮影'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
