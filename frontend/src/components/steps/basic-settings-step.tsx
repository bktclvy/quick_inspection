/**
 * Basic Settings Step — Product-level configuration
 * Pieces per box, inspection parameters (thresholds, etc.)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'
import { api } from '@/api/client'
import type { InspectionConfig } from '@/types'

export function BasicSettingsStep() {
  const productId = useAppStore((s) => s.selectedProductId)
  const selectedProduct = useAppStore((s) => s.selectedProduct)
  const loadProducts = useAppStore((s) => s.loadProducts)
  const selectProduct = useAppStore((s) => s.selectProduct)
  const [config, setConfig] = useState<Partial<InspectionConfig & { pieces_per_box: number }>>({})

  useEffect(() => {
    if (!productId) return
    productsApi.getConfig(productId).then(setConfig).catch((e) => console.warn('設定取得失敗:', e))
  }, [productId])

  const save = useCallback(async (updates: Record<string, unknown>) => {
    if (!productId) return
    const merged = { ...config, ...updates }
    setConfig(merged)
    try { await productsApi.saveConfig(productId, merged as Partial<InspectionConfig>) }
    catch { Toast.error('保存に失敗しました') }
  }, [productId, config])

  const ppb = Number((config as Record<string, unknown>).pieces_per_box) || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* 製品情報 */}
      <ProductInfoPanel
        productId={productId}
        productName={selectedProduct?.name ?? ''}
        onRenamed={loadProducts}
        onDeleted={() => { selectProduct(null); loadProducts() }}
      />

      {/* カメラ設定 */}
      <CameraSettingsPanel productId={productId} />

      {/* 生産設定 */}
      <Panel title="生産設定">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="1箱あたりの数量（0で無効）">
            <input
              key={ppb}
              type="number" min={0} max={9999}
              defaultValue={ppb}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10)
                save({ pieces_per_box: isNaN(n) ? 0 : Math.max(0, Math.min(9999, n)) })
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
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
      } catch (e) { console.warn('カメラ設定読み込み失敗:', e) }
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
            <input type="checkbox" checked={!props.auto_exposure}
              onChange={(e) => apply({ auto_exposure: !e.target.checked, exposure_value: Number(props.exposure) || -6 })}
              style={checkboxStyle} />
            露出固定
          </label>
          {!props.auto_exposure && (
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

function ProductInfoPanel({ productId, productName, onRenamed, onDeleted }: {
  productId: string | null; productName: string
  onRenamed: () => void; onDeleted: () => void
}) {
  const [name, setName] = useState(productName)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const savingRef = useRef(false)

  useEffect(() => { setName(productName) }, [productName])

  const saveName = async () => {
    const trimmed = name.trim()
    if (!productId || !trimmed || trimmed === productName || savingRef.current) return
    savingRef.current = true
    try {
      await productsApi.update(productId, { name: trimmed })
      onRenamed()
      Toast.success('製品名を変更しました')
    } catch { Toast.error('名前の変更に失敗しました') } finally {
      savingRef.current = false
    }
  }

  const handleDelete = async () => {
    if (!productId || deleteInput !== productName) return
    try {
      await productsApi.delete(productId)
      onDeleted()
      Toast.success('製品を削除しました')
    } catch { Toast.error('削除に失敗しました') }
  }

  return (
    <Panel title="製品情報">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="製品名">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName() }}
            style={inputStyle}
          />
        </Field>

        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 14px',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              color: '#b0a9bc', background: 'none',
              border: '1px solid #e8e4df', borderRadius: 8,
              cursor: 'pointer', transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.borderColor = '#fca5a5' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#b0a9bc'; e.currentTarget.style.borderColor = '#e8e4df' }}
          >
            この製品を削除...
          </button>
        ) : (
          <div style={{
            padding: 14, borderRadius: 10,
            background: '#fef2f2', border: '1px solid #fecaca',
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 8 }}>
              この操作は取り消せません。ROI・テンプレート・モデルも全て削除されます。
            </p>
            <p style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>
              確認のため「<strong>{productName}</strong>」と入力してください
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDelete(); if (e.key === 'Escape') { setDeleteConfirm(false); setDeleteInput('') } }}
                placeholder={productName}
                style={{
                  ...inputStyle, flex: 1,
                  borderColor: deleteInput === productName ? '#dc2626' : '#e8e4df',
                }}
              />
              <button
                onClick={handleDelete}
                disabled={deleteInput !== productName}
                style={{
                  height: 38, padding: '0 16px',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                  color: '#fff', border: 'none', borderRadius: 10,
                  cursor: deleteInput === productName ? 'pointer' : 'default',
                  background: deleteInput === productName ? '#dc2626' : '#e8c4c4',
                  transition: 'background 0.15s ease',
                }}
              >
                削除
              </button>
              <button
                onClick={() => { setDeleteConfirm(false); setDeleteInput('') }}
                style={{
                  height: 38, padding: '0 12px',
                  fontSize: 13, fontFamily: 'inherit',
                  color: '#9994a8', background: 'none',
                  border: 'none', cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
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
