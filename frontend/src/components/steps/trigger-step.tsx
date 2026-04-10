/**
 * Trigger Step — Two rectangles:
 *   1. Search area (large) — where to look each frame
 *   2. Template (small) — what to match within the search area
 */

import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { Toast } from '@/components/layout/Toast'
import { api } from '@/api/client'

export type TriggerDrawMode = 'search' | 'template' | null

interface Props {
  imgEl: HTMLImageElement | null
  onStartDrawing: (mode: TriggerDrawMode) => void
  drawMode: TriggerDrawMode
}

export function TriggerStep({ onStartDrawing, drawMode }: Props) {
  const productId = useAppStore((s) => s.selectedProductId)
  const selectedProduct = useAppStore((s) => s.selectedProduct)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

  const [searchRegion, setSearchRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [templateCount, setTemplateCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!selectedProduct) return
    setSearchRegion(selectedProduct.trigger_search_region ?? null)
    setTemplateCount(selectedProduct.trigger_template_count || 0)
  }, [selectedProduct])

  const deleteTemplate = useCallback(async (index: number) => {
    if (!productId) return
    try {
      const res = await api<{ remaining: number }>(`/products/${productId}/trigger-template/${index}`).delete()
      setTemplateCount(res.remaining)
      setRefreshKey((k) => k + 1)
    } catch { Toast.error('削除に失敗しました') }
  }, [productId])

  const deleteSearchRegion = async () => {
    if (!productId) return
    try {
      await api(`/products/${productId}/trigger-search-region`).delete()
      setSearchRegion(null)
      await refreshROIs()
    } catch { Toast.error('失敗') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Step 1: Search Area ── */}
      <Panel title="① 検索エリア" accent="#6366f1">
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 12, lineHeight: 1.6 }}>
          毎フレーム監視する範囲をカメラ上で指定してください。
        </p>
        {searchRegion ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 10,
            background: '#eef2ff', border: '1px solid #e0e7ff',
          }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#6366f1' }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#3730a3' }}>設定済み</span>
            <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#6366f1' }}>
              {(searchRegion.w * 100).toFixed(0)}% × {(searchRegion.h * 100).toFixed(0)}%
            </span>
            <button onClick={() => onStartDrawing('search')} style={smallBtn}>再設定</button>
            <button onClick={deleteSearchRegion} style={{ ...smallBtn, color: '#dc2626' }}>削除</button>
          </div>
        ) : (
          <button onClick={() => onStartDrawing('search')} style={{
            ...drawBtn,
            borderColor: drawMode === 'search' ? '#6366f1' : '#d8d3cc',
            background: drawMode === 'search' ? '#eef2ff' : 'transparent',
            color: drawMode === 'search' ? '#4338ca' : '#9994a8',
          }}>
            {drawMode === 'search' ? 'カメラ上でドラッグ...' : 'カメラ上で検索エリアを選択'}
          </button>
        )}
      </Panel>

      {/* ── Step 2: Template ── */}
      <Panel title="② テンプレート" accent="#f59e0b">
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 12, lineHeight: 1.6 }}>
          製品の特徴的な部分をカメラ上で矩形選択してください。複数登録可能です。
        </p>
        <button onClick={() => onStartDrawing('template')} style={{
          ...drawBtn,
          borderColor: drawMode === 'template' ? '#f59e0b' : '#d8d3cc',
          background: drawMode === 'template' ? '#fffbeb' : 'transparent',
          color: drawMode === 'template' ? '#b45309' : '#9994a8',
          marginBottom: 12,
        }}>
          {drawMode === 'template' ? 'カメラ上でドラッグ...' : '＋ カメラ上でテンプレートを選択'}
        </button>

        {templateCount > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: 8,
          }}>
            {Array.from({ length: templateCount }, (_, i) => (
              <div key={`t-${i}-${refreshKey}`} style={{
                position: 'relative', borderRadius: 10, overflow: 'hidden',
                border: '1px solid #fef3c7', background: '#fffbeb',
                aspectRatio: '4/3',
              }}>
                <img
                  src={`/api/products/${productId}/trigger-template?index=${i}&t=${refreshKey}`}
                  alt={`#${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <span style={{
                  position: 'absolute', top: 4, left: 4,
                  fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                  color: '#fff', background: 'rgba(0,0,0,0.5)',
                  padding: '1px 5px', borderRadius: 4,
                }}>#{i + 1}</span>
                <button onClick={() => deleteTemplate(i)} style={thumbDelete}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(220,38,38,0.8)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)' }}
                >×</button>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: '#ccc8d4', textAlign: 'center', padding: '16px 0' }}>
            テンプレートがありません
          </p>
        )}
      </Panel>
    </div>
  )
}

function Panel({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
      borderLeft: accent ? `3px solid ${accent}` : undefined,
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

const drawBtn: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 12,
  border: '2px dashed #d8d3cc', background: 'transparent',
  fontSize: 14, fontWeight: 600, color: '#9994a8',
  cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
  transition: 'all 0.15s ease',
}

const smallBtn: React.CSSProperties = {
  height: 28, padding: '0 10px', fontSize: 11, fontWeight: 600,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#5c5470', background: '#fff',
  border: '1.5px solid #e0dcd7', borderRadius: 7, cursor: 'pointer',
}

const thumbDelete: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 22, height: 22, borderRadius: 6,
  background: 'rgba(0,0,0,0.5)', border: 'none',
  color: '#fff', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
