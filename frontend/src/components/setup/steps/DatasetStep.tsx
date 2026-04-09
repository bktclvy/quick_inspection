import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { datasetApi } from '@/api/dataset'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { useKeyboard } from '@/hooks/useKeyboard'
import { triggerFlash } from '@/components/camera/CameraFeed'
import { Toast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { DatasetClass, Judgment } from '@/types'

export function DatasetStep() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const [roiId, setRoiId] = useState<string | null>(null)
  const [classes, setClasses] = useState<DatasetClass[]>([])
  const [selClass, setSelClass] = useState('')
  const [newName, setNewName] = useState('')
  const [newJudge, setNewJudge] = useState<Judgment>('ng')
  const [thumbs, setThumbs] = useState<Array<{ cls: string; file: string; url: string }>>([])
  const { play } = useAudioFeedback()

  const loadClasses = useCallback(async () => {
    if (!productId) return
    try { setClasses(await datasetApi.listClasses(productId, roiId)) } catch {}
  }, [productId, roiId])

  useEffect(() => { loadClasses() }, [loadClasses])

  const loadImages = useCallback(async (cls: string) => {
    if (!productId || !cls) return
    try {
      const files = await datasetApi.listImages(productId, cls, roiId)
      setThumbs(files.slice(-12).reverse().map((f) => ({ cls, file: f, url: datasetApi.imageUrl(productId, cls, f) })))
    } catch {}
  }, [productId, roiId])

  useEffect(() => { if (selClass) loadImages(selClass) }, [selClass, loadImages])

  const capture = useCallback(async () => {
    if (!productId || !selClass) return
    try {
      await datasetApi.capture(productId, { class_name: selClass, roi_id: roiId })
      play('capture'); triggerFlash(); await loadClasses(); await loadImages(selClass)
    } catch { Toast.error('撮影失敗') }
  }, [productId, selClass, roiId, play, loadClasses, loadImages])

  useKeyboard('Space', capture, !!selClass)

  const addClass = async () => {
    const n = newName.trim()
    if (!n || !productId) return
    try {
      await datasetApi.createClass(productId, { class_name: n, roi_id: roiId, judgment: newJudge })
      setNewName(''); await loadClasses(); setSelClass(n); Toast.success(`${n} 作成`)
    } catch { Toast.error('失敗') }
  }

  const delClass = async (name: string) => {
    if (!productId || !confirm(`${name} を削除？`)) return
    try {
      await datasetApi.deleteClass(productId, name)
      if (selClass === name) { setSelClass(''); setThumbs([]) }
      await loadClasses(); Toast.success('削除')
    } catch { Toast.error('失敗') }
  }

  const delImg = async (cls: string, file: string) => {
    if (!productId) return
    try { await datasetApi.deleteImage(productId, { class_name: cls, filename: file, roi_id: roiId }); await loadClasses(); await loadImages(cls) }
    catch { Toast.error('失敗') }
  }

  const importFolder = async () => {
    if (!productId) return
    try { await datasetApi.importFolder(productId, roiId); await loadClasses(); Toast.success('インポート完了') }
    catch { Toast.error('失敗') }
  }

  return (
    <div className="space-y-3">
      {/* Capture controls */}
      <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
        <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">データ収集</h3>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">対象ROI</label>
            <select className="w-full h-9 px-3 text-[13px] bg-white border rounded-lg shadow-sm"
              value={roiId ?? ''} onChange={(e) => setRoiId(e.target.value || null)}>
              <option value="">全体 (フルフレーム)</option>
              {rois.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">保存先クラス</label>
            <select className="w-full h-9 px-3 text-[13px] bg-white border rounded-lg shadow-sm"
              value={selClass} onChange={(e) => setSelClass(e.target.value)}>
              <option value="">-- 選択 --</option>
              {classes.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={capture} disabled={!selClass}>
            撮影 <kbd className="ml-1 text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono">Space</kbd>
          </Button>
          <Button size="sm" variant="outline" onClick={importFolder}>フォルダから取込</Button>
        </div>
      </div>

      {/* Class list */}
      <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
        <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">クラス一覧</h3>
        {classes.length === 0 ? (
          <p className="text-[13px] text-gray-300 text-center py-6">クラスがありません</p>
        ) : (
          <div className="space-y-1">
            {classes.map((c) => (
              <div key={c.name} onClick={() => setSelClass(c.name)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] cursor-pointer transition-colors',
                  selClass === c.name ? 'bg-gray-900 text-white' : 'hover:bg-gray-50',
                )}>
                <span className={cn(
                  'text-[9px] font-bold font-mono px-1.5 py-0.5 rounded text-white',
                  c.judgment === 'ok' ? 'bg-emerald-500' : 'bg-red-500',
                )}>{c.judgment.toUpperCase()}</span>
                <span className="flex-1 font-medium">{c.name}</span>
                <span className={cn('font-mono text-[11px] tabular-nums', selClass === c.name ? 'text-gray-400' : 'text-gray-400')}>{c.count}</span>
                <button onClick={(e) => { e.stopPropagation(); delClass(c.name) }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-400 hover:text-red-500">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 mt-3 pt-3 border-t border-gray-100">
          <Input className="h-8 text-[13px] flex-1" placeholder="クラス名" value={newName}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addClass()} />
          <select className="h-8 px-2 text-[12px] border rounded-md shadow-sm" value={newJudge}
            onChange={(e) => setNewJudge(e.target.value as Judgment)}>
            <option value="ok">OK</option><option value="ng">NG</option>
          </select>
          <Button size="sm" className="h-8" onClick={addClass}>追加</Button>
        </div>
      </div>

      {/* Thumbnails */}
      <div className="bg-white rounded-xl ring-1 ring-gray-200/80 shadow-sm p-4">
        <h3 className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase mb-3">最近の撮影</h3>
        {thumbs.length === 0 ? (
          <p className="text-[13px] text-gray-300 text-center py-6">まだ撮影がありません</p>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {thumbs.map((t) => (
              <button key={t.file} onClick={() => delImg(t.cls, t.file)}
                className="aspect-square rounded-lg overflow-hidden ring-1 ring-gray-100 hover:ring-red-300 transition-all">
                <img src={t.url} alt={t.file} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
