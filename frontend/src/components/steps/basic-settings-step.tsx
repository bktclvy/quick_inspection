/**
 * Basic Settings Step — Product-level configuration
 * Pieces per box, inspection parameters (thresholds, etc.)
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'
import { api } from '@/api/client'
import type { InspectionConfig } from '@/types'

export function BasicSettingsStep() {
  const productId = useAppStore((s) => s.selectedProductId)
  const [config, setConfig] = useState<Partial<InspectionConfig & { pieces_per_box: number }>>({})

  useEffect(() => {
    if (!productId) return
    productsApi.getConfig(productId).then(setConfig).catch(() => {})
  }, [productId])

  const save = useCallback(async (updates: Record<string, unknown>) => {
    if (!productId) return
    const merged = { ...config, ...updates }
    setConfig(merged)
    try { await productsApi.saveConfig(productId, merged as Partial<InspectionConfig>) }
    catch { Toast.error('保存に失敗しました') }
  }, [productId, config])

  const ppb = (config as Record<string, unknown>).pieces_per_box as number ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* カメラ設定 */}
      <CameraSettingsPanel productId={productId} />

      {/* 生産設定 */}
      <Panel title="生産設定">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="1箱あたりの数量（0で無効）">
            <input
              type="number" min={0} max={9999}
              value={ppb}
              onChange={(e) => save({ pieces_per_box: Number(e.target.value) })}
              style={inputStyle}
            />
          </Field>
        </div>
        <p style={{ fontSize: 12, color: '#b0a9bc', marginTop: 10, lineHeight: 1.6 }}>
          設定すると検査画面にOK品の箱詰め進捗と完成箱数が表示されます。
        </p>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#9994a8', marginBottom: 5, letterSpacing: '0.03em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function CameraSettingsPanel({ productId }: { productId: string | null }) {
  const [props, setProps] = useState<Record<string, unknown>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // カメラプロパティ取得 + 製品設定から復元
    const load = async () => {
      try {
        if (productId) {
          const cfg = await productsApi.getConfig(productId) as unknown as Record<string, unknown>
          // 保存済みカメラ設定を適用
          const settings: Record<string, unknown> = {}
          if (cfg.camera_flip_h != null || cfg.camera_flip_v != null) {
            settings.flip_h = cfg.camera_flip_h ?? false
            settings.flip_v = cfg.camera_flip_v ?? false
          }
          if (cfg.camera_autofocus != null) {
            settings.autofocus = cfg.camera_autofocus
            settings.focus_value = cfg.camera_focus_value
          }
          if (cfg.camera_auto_exposure != null) {
            settings.auto_exposure = cfg.camera_auto_exposure
            settings.exposure_value = cfg.camera_exposure_value
          }
          if (Object.keys(settings).length > 0) {
            await api('/camera/settings').post(settings)
          }
        }
        const p = await api<Record<string, unknown>>('/camera/properties').get()
        setProps(p)
      } catch {}
      setLoaded(true)
    }
    load()
  }, [productId])

  const apply = async (settings: Record<string, unknown>) => {
    try {
      const url = productId ? `/camera/settings?product_id=${productId}` : '/camera/settings'
      const result = await api<Record<string, unknown>>(url).post(settings)
      setProps(result)
    } catch { Toast.error('カメラ設定に失敗しました') }
  }

  if (!loaded) return null

  return (
    <Panel title="カメラ設定">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={!!props.flip_h}
              onChange={(e) => apply({ flip_h: e.target.checked, flip_v: !!props.flip_v })}
              style={checkboxStyle} />
            水平反転
          </label>
        </div>
        <div>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={!!props.flip_v}
              onChange={(e) => apply({ flip_h: !!props.flip_h, flip_v: e.target.checked })}
              style={checkboxStyle} />
            垂直反転
          </label>
        </div>
        <div>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={!props.autofocus}
              onChange={(e) => apply({ autofocus: !e.target.checked, focus_value: Number(props.focus) || 0 })}
              style={checkboxStyle} />
            フォーカス固定
          </label>
          {!props.autofocus && (
            <div style={{ marginTop: 8 }}>
              <Field label="フォーカス値">
                <input type="number" min={0} max={255}
                  value={Number(props.focus) || 0}
                  onChange={(e) => apply({ autofocus: false, focus_value: Number(e.target.value) })}
                  style={inputStyle} />
              </Field>
            </div>
          )}
        </div>
        <div>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={Number(props.auto_exposure) !== 3}
              onChange={(e) => apply({ auto_exposure: !e.target.checked, exposure_value: Number(props.exposure) || -6 })}
              style={checkboxStyle} />
            露出固定
          </label>
          {Number(props.auto_exposure) !== 3 && (
            <div style={{ marginTop: 8 }}>
              <Field label="露出値">
                <input type="number" min={-13} max={0}
                  value={Number(props.exposure) || -6}
                  onChange={(e) => apply({ auto_exposure: false, exposure_value: Number(e.target.value) })}
                  style={inputStyle} />
              </Field>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

const checkLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 13, fontWeight: 500, color: '#3d3654', cursor: 'pointer',
}

const checkboxStyle: React.CSSProperties = {
  width: 16, height: 16, accentColor: '#6366f1',
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 14px',
  fontSize: 13, fontWeight: 500,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3d3654', background: '#faf9f7',
  border: '1.5px solid #e8e4df', borderRadius: 10,
  outline: 'none',
}
