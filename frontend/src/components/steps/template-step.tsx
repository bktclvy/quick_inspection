/**
 * Template Step — Capture multiple reference images per ROI
 */

import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { triggerFlash } from '@/components/camera/CameraFeed'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { Toast } from '@/components/layout/Toast'

export function TemplateStepNew() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const { play } = useAudioFeedback()

  const capture = useCallback(async (roiId: string) => {
    if (!productId || busy) return
    setBusy(true)
    try {
      await productsApi.captureTemplate(productId, roiId)
      play('capture')
      triggerFlash()
      await refreshROIs()
      setRefreshKey((k) => k + 1)
      Toast.success('テンプレートを追加しました')
    } catch { Toast.error('撮影に失敗しました') }
    finally { setBusy(false) }
  }, [productId, busy, refreshROIs, play])

  const deleteTemplate = useCallback(async (roiId: string, index: number) => {
    if (!productId) return
    try {
      await productsApi.deleteTemplate(productId, roiId, index)
      await refreshROIs()
      setRefreshKey((k) => k + 1)
      Toast.success('テンプレートを削除しました')
    } catch { Toast.error('削除に失敗しました') }
  }, [productId, refreshROIs])

  if (rois.length === 0) {
    return (
      <Panel title="テンプレート管理">
        <p style={{ fontSize: 14, color: '#b0a9bc', textAlign: 'center', padding: '40px 0' }}>
          先にROIを設定してください（ステップ1）
        </p>
      </Panel>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel title="テンプレート管理">
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 16, lineHeight: 1.6 }}>
          各ROIに複数のテンプレートを登録できます。置き方のバリエーションや不良品も登録すると検知精度が上がります。
        </p>
      </Panel>

      {rois.map((roi) => (
        <Panel key={roi.id} title={roi.name}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 5,
                background: roi.color || '#6366f1',
                boxShadow: `0 0 0 3px ${(roi.color || '#6366f1')}22`,
              }} />
              <span style={{
                fontSize: 13, fontWeight: 600, color: '#7c7494',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {roi.template_count || 0} 枚登録済み
              </span>
            </div>
            <button
              onClick={() => capture(roi.id)}
              disabled={busy}
              style={{
                height: 34, padding: '0 16px',
                fontSize: 12, fontWeight: 600,
                fontFamily: "'DM Sans', system-ui, sans-serif",
                border: 'none', borderRadius: 10, cursor: busy ? 'default' : 'pointer',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
                opacity: busy ? 0.5 : 1,
                transition: 'opacity 0.15s ease',
              }}
            >
              {busy ? '撮影中...' : '＋ 撮影追加'}
            </button>
          </div>

          {/* Template thumbnails */}
          {(roi.template_count || 0) > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: 8,
            }}>
              {Array.from({ length: roi.template_count || 0 }, (_, i) => (
                <div key={`${roi.id}-${i}-${refreshKey}`} style={{
                  position: 'relative', borderRadius: 10, overflow: 'hidden',
                  border: '1px solid #ebe7e2',
                  background: '#faf9f7',
                  aspectRatio: '4/3',
                }}>
                  <img
                    src={`${productsApi.templateUrl(productId!, roi.id, i)}&t=${refreshKey}`}
                    alt={`${roi.name} #${i + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  {/* Index label */}
                  <span style={{
                    position: 'absolute', top: 4, left: 4,
                    fontSize: 9, fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#fff', background: 'rgba(0,0,0,0.5)',
                    padding: '1px 5px', borderRadius: 4,
                  }}>
                    #{i + 1}
                  </span>
                  {/* Delete button */}
                  <button
                    onClick={() => deleteTemplate(roi.id, i)}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 22, height: 22, borderRadius: 6,
                      background: 'rgba(0,0,0,0.5)', border: 'none',
                      color: '#fff', fontSize: 12, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: 0.7, transition: 'opacity 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(220,38,38,0.8)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'rgba(0,0,0,0.5)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: '#ccc8d4', textAlign: 'center', padding: '20px 0' }}>
              まだテンプレートがありません
            </p>
          )}
        </Panel>
      ))}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0ede9' }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: '#7c7494',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>{title}</span>
      </div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  )
}
