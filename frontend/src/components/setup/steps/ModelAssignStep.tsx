import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../../stores/appStore'
import { useTrainingStore } from '../../../stores/trainingStore'
import { productsApi } from '../../../api/products'
import { useKeyboard } from '../../../hooks/useKeyboard'
import { Toast } from '../../layout/Toast'
import type { ROIResult } from '../../../types'

export function ModelAssignStep() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)
  const savedModels = useTrainingStore((s) => s.savedModels)
  const loadModels = useTrainingStore((s) => s.loadModels)

  const [testResults, setTestResults] = useState<ROIResult[] | null>(null)

  useEffect(() => {
    if (productId) loadModels(productId)
  }, [productId, loadModels])

  const handleAssign = async (roiId: string, modelName: string | null) => {
    if (!productId) return
    try {
      await productsApi.assignModel(productId, roiId, modelName)
      await refreshROIs()
    } catch {
      Toast.error('モデル割当に失敗しました')
    }
  }

  const handleTest = useCallback(async () => {
    if (!productId) return
    try {
      const result = await productsApi.predictOnce(productId) as { results: ROIResult[] }
      setTestResults(result.results || [])
    } catch {
      Toast.error('テスト失敗')
    }
  }, [productId])

  useKeyboard('Space', handleTest, true)

  const handleDeleteModel = async (name: string) => {
    if (!productId) return
    if (!confirm(`${name} を削除しますか？`)) return
    try {
      await productsApi.deleteModel(productId, name)
      await loadModels(productId)
      Toast.success('モデルを削除しました')
    } catch {
      Toast.error('削除に失敗しました')
    }
  }

  return (
    <div className="step-panel">
      <div className="card">
        <div className="card-title">モデル割当</div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-3)' }}>
          各ROIに学習済みモデルを割り当てます。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {rois.map((roi) => (
            <div key={roi.id} className="assign-item">
              <span className="assign-name">{roi.name}</span>
              <select
                className="select select-sm"
                style={{ width: 160 }}
                value={roi.model_name || ''}
                onChange={(e) => handleAssign(roi.id, e.target.value || null)}
              >
                <option value="">-- なし --</option>
                {savedModels.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="assign-test-section">
          <kbd>Space</kbd>
          <button className="btn btn-ghost btn-sm" onClick={handleTest}>検査テスト</button>
        </div>
        {testResults && (
          <div className="assign-test-results">
            {testResults.map((r) => (
              <div key={r.roi_id} className="roi-result-item" data-judgment={r.judgment}>
                <span className={`badge badge-${r.judgment}`}>{r.judgment.toUpperCase()}</span>
                <span className="roi-result-name">{r.roi_name}</span>
                <span className="roi-result-conf">{(r.confidence * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved models */}
      <div className="card">
        <div className="card-title">保存済みモデル</div>
        {savedModels.length === 0 ? (
          <div className="empty-state">モデルがありません</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            {savedModels.map((m) => (
              <div key={m.name} className="model-list-item">
                <span className="model-list-name">{m.name}</span>
                {m.meta && <span className="model-list-acc">{(m.meta.best_val_accuracy * 100).toFixed(1)}%</span>}
                <button className="btn-icon" onClick={() => handleDeleteModel(m.name)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
