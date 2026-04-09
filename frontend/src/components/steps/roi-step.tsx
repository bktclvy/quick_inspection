/**
 * ROI Setup Step — Define inspection regions
 *
 * Layout: ROI list at top, parameters below
 * Actions: Add ROI (toggles edit mode on canvas), delete ROI
 * Parameters: trigger mode, thresholds, background capture
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'
import type { InspectionConfig, TriggerMode } from '@/types'

interface Props {
  editMode: boolean
  onToggleEdit: () => void
}

export function ROIStep({ editMode, onToggleEdit }: Props) {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

  const [config, setConfig] = useState<Partial<InspectionConfig>>({})
  const [hasBg, setHasBg] = useState(false)
  const [showParams, setShowParams] = useState(false)

  useEffect(() => {
    if (!productId) return
    productsApi.getConfig(productId).then(setConfig).catch(() => {})
    productsApi.backgroundStatus(productId).then((r) => setHasBg(r.has_background)).catch(() => {})
  }, [productId])

  const save = useCallback(async (u: Partial<InspectionConfig>) => {
    if (!productId) return
    const merged = { ...config, ...u }
    setConfig(merged)
    try { await productsApi.saveConfig(productId, merged) }
    catch { Toast.error('設定の保存に失敗しました') }
  }, [productId, config])

  const deleteROI = async (id: string, name: string) => {
    if (!productId || !confirm(`${name} を削除しますか？`)) return
    try { await productsApi.deleteROI(productId, id); await refreshROIs(); Toast.success('削除しました') }
    catch { Toast.error('削除に失敗しました') }
  }

  const captureBg = async () => {
    if (!productId) return
    try { await productsApi.captureBackground(productId); setHasBg(true); Toast.success('背景を撮影しました') }
    catch { Toast.error('背景撮影に失敗しました') }
  }

  const mode = (config.trigger_mode || 'auto_background') as TriggerMode

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── ROI List ── */}
      <Panel title="検査領域 (ROI)">
        {rois.length === 0 ? (
          <p style={emptyStyle}>カメラ映像上でドラッグしてROIを描画してください</p>
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

      {/* ── Parameters ── */}
      <Panel
        title="検査パラメータ"
        collapsible
        collapsed={!showParams}
        onToggle={() => setShowParams(!showParams)}
      >
        {showParams && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Trigger mode */}
            <Field label="トリガーモード">
              <select
                value={mode}
                onChange={(e) => save({ trigger_mode: e.target.value as TriggerMode })}
                style={selectStyle}
              >
                <option value="auto_background">自動（背景差分）</option>
                <option value="auto_template">自動（テンプレート）</option>
                <option value="manual">手動（Spaceキー）</option>
              </select>
            </Field>

            {mode === 'auto_background' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={captureBg} style={ghostBtnStyle}>背景を撮影</button>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: hasBg ? '#059669' : '#b0a9bc',
                  }}>
                    {hasBg ? '✓ 撮影済み' : '未撮影'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Slider label="存在閾値" min={5} max={80} step={1}
                    value={config.presence_threshold ?? 25}
                    onChange={(v) => save({ presence_threshold: v })} />
                  <Slider label="安定閾値" min={1} max={30} step={0.5}
                    value={config.stability_threshold ?? 5}
                    onChange={(v) => save({ stability_threshold: v })}
                    format={(v) => v.toFixed(1)} />
                  <Field label="安定フレーム数">
                    <input type="number" min={2} max={30}
                      value={config.stability_frames ?? 8}
                      onChange={(e) => save({ stability_frames: +e.target.value })}
                      style={inputStyle} />
                  </Field>
                  <Slider label="除去差分閾値" min={3} max={50} step={1}
                    value={config.removal_diff_threshold ?? 15}
                    onChange={(v) => save({ removal_diff_threshold: v })} />
                </div>
              </>
            )}

            {mode === 'auto_template' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Slider label="マッチ閾値" min={0.5} max={0.99} step={0.01}
                  value={config.match_threshold ?? 0.8}
                  onChange={(v) => save({ match_threshold: v })}
                  format={(v) => v.toFixed(2)} />
                <Field label="トリガーフレーム">
                  <input type="number" min={1} max={30}
                    value={config.trigger_frames ?? 3}
                    onChange={(e) => save({ trigger_frames: +e.target.value })}
                    style={inputStyle} />
                </Field>
                <Slider label="除去閾値" min={0.1} max={0.8} step={0.01}
                  value={config.removal_threshold ?? 0.5}
                  onChange={(v) => save({ removal_threshold: v })}
                  format={(v) => v.toFixed(2)} />
              </div>
            )}

            <Field label="結果表示時間 (ms)">
              <input type="number" min={500} max={10000} step={100}
                value={config.judged_display_ms ?? 2000}
                onChange={(e) => save({ judged_display_ms: +e.target.value })}
                style={inputStyle} />
            </Field>
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ================================================================
   Shared sub-components
   ================================================================ */

function Panel({ title, children, collapsible, collapsed, onToggle }: {
  title: string; children: React.ReactNode
  collapsible?: boolean; collapsed?: boolean; onToggle?: () => void
}) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
    }}>
      <div
        onClick={collapsible ? onToggle : undefined}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          cursor: collapsible ? 'pointer' : 'default',
          borderBottom: collapsed ? 'none' : '1px solid #f0ede9',
        }}
      >
        <span style={{
          fontSize: 12, fontWeight: 700, color: '#7c7494',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {title}
        </span>
        {collapsible && (
          <span style={{ fontSize: 12, color: '#b0a9bc', transition: 'transform 0.2s ease',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}>
            ▼
          </span>
        )}
      </div>
      {(!collapsible || !collapsed) && (
        <div style={{ padding: '14px 18px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600,
        color: '#9994a8', marginBottom: 5,
        letterSpacing: '0.03em',
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange, format }: {
  label: string; min: number; max: number; step: number
  value: number; onChange: (v: number) => void; format?: (v: number) => string
}) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(+e.target.value)}
          style={{
            flex: 1, height: 4, accentColor: '#6366f1',
            WebkitAppearance: 'none', appearance: 'none',
            background: '#ebe7e2', borderRadius: 2, outline: 'none',
          }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, fontWeight: 600, color: '#5c5470',
          minWidth: 36, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {format ? format(value) : value}
        </span>
      </div>
    </Field>
  )
}

/* ── Shared styles ── */

const emptyStyle: React.CSSProperties = {
  fontSize: 13, color: '#b0a9bc', textAlign: 'center', padding: '24px 0',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#d4d0dc', padding: 4, borderRadius: 6,
  transition: 'color 0.15s ease',
}

const selectStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 14px',
  fontSize: 13, fontWeight: 500,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3d3654', background: '#faf9f7',
  border: '1.5px solid #e8e4df', borderRadius: 10,
  appearance: 'none', outline: 'none', cursor: 'pointer',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 14px',
  fontSize: 13, fontWeight: 500,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3d3654', background: '#faf9f7',
  border: '1.5px solid #e8e4df', borderRadius: 10,
  outline: 'none',
}

const ghostBtnStyle: React.CSSProperties = {
  height: 34, padding: '0 16px',
  fontSize: 12, fontWeight: 600,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#5c5470', background: '#fff',
  border: '1.5px solid #e0dcd7', borderRadius: 10,
  cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}
