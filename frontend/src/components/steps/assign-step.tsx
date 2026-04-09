/**
 * Model Assignment Step — Assign trained models to ROIs and test
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useTrainingStore } from '@/stores/trainingStore'
import { productsApi } from '@/api/products'
import { useKeyboard } from '@/hooks/useKeyboard'
import { Toast } from '@/components/layout/Toast'
import type { ROIResult } from '@/types'

export function AssignStepNew() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)
  const savedModels = useTrainingStore((s) => s.savedModels)
  const loadModels = useTrainingStore((s) => s.loadModels)

  const [testResults, setTestResults] = useState<ROIResult[] | null>(null)

  useEffect(() => { if (productId) loadModels(productId) }, [productId, loadModels])

  const handleAssign = async (roiId: string, modelName: string | null) => {
    if (!productId) return
    try {
      await productsApi.assignModel(productId, roiId, modelName)
      await refreshROIs()
    } catch { Toast.error('割当に失敗しました') }
  }

  const handleTest = useCallback(async () => {
    if (!productId) return
    try {
      const result = await productsApi.predictOnce(productId) as { results: ROIResult[] }
      setTestResults(result.results || [])
      Toast.success('テスト完了')
    } catch { Toast.error('テストに失敗しました') }
  }, [productId])

  useKeyboard('Space', handleTest, true)

  const handleDeleteModel = async (name: string) => {
    if (!productId || !confirm(`${name} を削除しますか？`)) return
    try {
      await productsApi.deleteModel(productId, name)
      await loadModels(productId)
      Toast.success('削除しました')
    } catch { Toast.error('削除に失敗しました') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Assignment ── */}
      <Panel title="モデル割当">
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 16, lineHeight: 1.6 }}>
          各ROIに学習済みモデルを割り当てます。
        </p>
        {rois.length === 0 ? (
          <p style={{ fontSize: 13, color: '#b0a9bc', textAlign: 'center', padding: '24px 0' }}>
            ROIがありません
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rois.map((roi) => (
              <div key={roi.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 14px', borderRadius: 10,
                background: '#faf9f7', border: '1px solid #ebe7e2',
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: 5,
                  background: roi.color || '#6366f1',
                  boxShadow: `0 0 0 3px ${(roi.color || '#6366f1')}22`,
                  flexShrink: 0,
                }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1a1625' }}>
                  {roi.name}
                </span>
                <select
                  value={roi.model_name || ''}
                  onChange={(e) => handleAssign(roi.id, e.target.value || null)}
                  style={{
                    height: 34, padding: '0 28px 0 12px', width: 180,
                    fontSize: 12, fontWeight: 500, flexShrink: 0,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#3d3654', background: '#fff',
                    border: '1.5px solid #e0dcd7', borderRadius: 8,
                    appearance: 'none', outline: 'none', cursor: 'pointer',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
                  }}
                >
                  <option value="">-- なし --</option>
                  {savedModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        {/* Test section */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0ede9',
        }}>
          <button onClick={handleTest} style={{
            height: 36, padding: '0 18px',
            fontSize: 13, fontWeight: 600,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff', border: 'none', borderRadius: 10,
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            検査テスト
            <span style={{
              fontSize: 10, fontWeight: 500,
              background: 'rgba(255,255,255,0.2)', padding: '2px 7px',
              borderRadius: 5, fontFamily: "'JetBrains Mono', monospace",
            }}>Space</span>
          </button>
        </div>

        {/* Test results */}
        {testResults && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
            {testResults.map((r) => (
              <div key={r.roi_id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 10,
                background: r.judgment === 'ok' ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${r.judgment === 'ok' ? '#d1fae5' : '#fee2e2'}`,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                  padding: '2px 7px', borderRadius: 5, color: '#fff',
                  background: r.judgment === 'ok' ? '#10b981' : '#ef4444',
                }}>
                  {r.judgment.toUpperCase()}
                </span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1625' }}>
                  {r.roi_name}
                </span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12, fontWeight: 600,
                  color: r.judgment === 'ok' ? '#059669' : '#dc2626',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {(r.confidence * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Saved Models ── */}
      <Panel title="保存済みモデル">
        {savedModels.length === 0 ? (
          <p style={{ fontSize: 13, color: '#b0a9bc', textAlign: 'center', padding: '24px 0' }}>
            モデルがありません（ステップ4で学習してください）
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {savedModels.map((m) => (
              <div key={m.name} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 10,
                background: '#faf9f7', border: '1px solid #ebe7e2',
              }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1625' }}>
                  {m.name}
                </span>
                {m.meta && (
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12, fontWeight: 700, color: '#059669',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {(m.meta.best_val_accuracy * 100).toFixed(1)}%
                  </span>
                )}
                <button onClick={() => handleDeleteModel(m.name)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#d4d0dc', padding: 4, borderRadius: 6, lineHeight: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
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
