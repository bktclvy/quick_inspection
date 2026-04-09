/**
 * Template Step — Capture reference images for each ROI
 */

import { useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'

export function TemplateStepNew() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)
  const [busy, setBusy] = useState<string | null>(null)

  const capture = async (roiId: string) => {
    if (!productId) return
    setBusy(roiId)
    try {
      await productsApi.captureTemplate(productId, roiId)
      await refreshROIs()
      Toast.success('テンプレートを撮影しました')
    } catch { Toast.error('撮影に失敗しました') }
    finally { setBusy(null) }
  }

  if (rois.length === 0) {
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 14, color: '#b0a9bc', textAlign: 'center', padding: '40px 0' }}>
          先にROIを設定してください（ステップ1）
        </p>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0ede9' }}>
        <span style={titleStyle}>テンプレート一覧</span>
      </div>
      <div style={{ padding: '14px 18px' }}>
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 16, lineHeight: 1.6 }}>
          各ROIの基準画像を撮影します。テンプレートマッチングによる製品検知に使用されます。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rois.map((roi) => (
            <div key={roi.id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: 14, borderRadius: 12,
              background: '#faf9f7', border: '1px solid #ebe7e2',
            }}>
              {/* Preview */}
              {roi.has_template && productId ? (
                <img
                  src={`${productsApi.templateUrl(productId, roi.id)}?t=${Date.now()}`}
                  alt={roi.name}
                  style={{
                    width: 80, height: 60, borderRadius: 8,
                    objectFit: 'cover', flexShrink: 0,
                    border: '1px solid #e0dcd7',
                  }}
                />
              ) : (
                <div style={{
                  width: 80, height: 60, borderRadius: 8, flexShrink: 0,
                  background: '#f0ede9', border: '1px solid #e0dcd7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ccc8d4" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" fill="#ccc8d4" stroke="none" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </div>
              )}

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1625', marginBottom: 3 }}>
                  {roi.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {roi.has_template ? (
                    <>
                      <div style={{
                        width: 6, height: 6, borderRadius: 3,
                        background: '#10b981',
                        boxShadow: '0 0 4px rgba(16,185,129,0.4)',
                      }} />
                      <span style={{ fontSize: 12, color: '#059669', fontWeight: 500 }}>撮影済み</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: '#b0a9bc' }}>未撮影</span>
                  )}
                </div>
              </div>

              {/* Action */}
              <button
                onClick={() => capture(roi.id)}
                disabled={busy === roi.id}
                style={{
                  height: 34, padding: '0 16px',
                  fontSize: 12, fontWeight: 600,
                  fontFamily: "'DM Sans', system-ui, sans-serif",
                  border: '1.5px solid #e0dcd7', borderRadius: 10,
                  background: '#fff', color: busy === roi.id ? '#d4d0dc' : '#5c5470',
                  cursor: busy === roi.id ? 'default' : 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
              >
                {busy === roi.id ? '撮影中...' : roi.has_template ? '再撮影' : '基準撮影'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: '#ffffff', borderRadius: 14, overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
}

const titleStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#7c7494',
  textTransform: 'uppercase', letterSpacing: '0.08em',
}
