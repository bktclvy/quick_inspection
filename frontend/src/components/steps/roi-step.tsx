/**
 * ROI Setup Step — Define inspection regions
 *
 * Layout: ROI list at top, parameters below
 * Actions: Add ROI (toggles edit mode on canvas), delete ROI
 * Parameters: trigger mode, thresholds, background capture
 */

import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'

interface Props {
  editMode: boolean
  onToggleEdit: () => void
}

export function ROIStep({ editMode, onToggleEdit }: Props) {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

  const deleteROI = async (id: string, name: string) => {
    if (!productId || !confirm(`${name} を削除しますか？`)) return
    try { await productsApi.deleteROI(productId, id); await refreshROIs(); Toast.success('削除しました') }
    catch { Toast.error('削除に失敗しました') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel title="検査領域 (ROI)">
        {rois.length === 0 ? (
          <p style={{ fontSize: 13, color: '#b0a9bc', textAlign: 'center', padding: '24px 0' }}>
            カメラ映像上でドラッグしてROIを描画してください
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rois.map((r) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 10,
                background: '#faf9f7',
                border: '1px solid #ebe7e2',
                transition: 'border-color 0.15s ease',
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: 5, flexShrink: 0,
                  background: r.color || '#6366f1',
                  boxShadow: `0 0 0 3px ${(r.color || '#6366f1')}22`,
                }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1a1625' }}>
                  {r.name}
                </span>
                {r.model_name && (
                  <span style={{
                    fontSize: 11, fontWeight: 500, color: '#9994a8',
                    background: '#f0ede9', padding: '2px 8px', borderRadius: 6,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {r.model_name}
                  </span>
                )}
                {r.has_template && (
                  <div style={{
                    width: 8, height: 8, borderRadius: 4,
                    background: '#10b981',
                    boxShadow: '0 0 4px rgba(16,185,129,0.4)',
                  }} title="テンプレート撮影済み" />
                )}
                <button
                  onClick={() => deleteROI(r.id, r.name)}
                  style={iconBtnStyle}
                  title="削除"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button onClick={onToggleEdit} style={{
            height: 36, padding: '0 20px',
            fontSize: 13, fontWeight: 600,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            border: 'none', borderRadius: 10, cursor: 'pointer',
            transition: 'all 0.15s ease',
            ...(editMode ? {
              background: '#fee2e2', color: '#dc2626',
            } : {
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
            }),
          }}>
            {editMode ? 'キャンセル' : '＋ ROI追加'}
          </button>
          {editMode && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#9994a8' }}>
              カメラ上でドラッグしてください
            </span>
          )}
        </div>
      </Panel>

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
        <span style={{ fontSize: 12, fontWeight: 700, color: '#7c7494', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {title}
        </span>
      </div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#d4d0dc', padding: 4, borderRadius: 6,
  transition: 'color 0.15s ease',
}
