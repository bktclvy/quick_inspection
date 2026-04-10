/**
 * Setup Page — Product tab bar + wizard
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { SetupWizard } from '@/components/setup-wizard'
import { Toast } from '@/components/layout/Toast'

export function SetupPageNew() {
  const products     = useAppStore((s) => s.products)
  const productId    = useAppStore((s) => s.selectedProductId)
  const selectProduct = useAppStore((s) => s.selectProduct)
  const loadProducts = useAppStore((s) => s.loadProducts)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => { loadProducts() }, [loadProducts])

  const product = products.find((p) => p.id === productId)

  const handleAdd = async () => {
    const n = newName.trim()
    if (!n) return
    try {
      const p = await productsApi.create({ name: n })
      setNewName(''); setAdding(false)
      await loadProducts()
      selectProduct(p.id)
      Toast.success(`${n} を作成しました`)
    } catch { Toast.error('作成に失敗しました') }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`${name} を削除しますか？`)) return
    try {
      await productsApi.delete(id)
      if (productId === id) selectProduct(null)
      await loadProducts()
    } catch { Toast.error('削除に失敗しました') }
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      background: '#f7f5f2',
    }}>
      {/* ── Product Tab Bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '8px 16px',
        borderBottom: '1px solid #ebe7e2',
        background: '#faf9f7',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {products.map((p) => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px',
            borderRadius: 10,
            fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            ...(p.id === productId ? {
              background: '#1a1625', color: '#fff',
            } : {
              background: 'transparent', color: '#7c7494',
            }),
          }}
            onClick={() => selectProduct(p.id)}
          >
            {p.name}
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: p.id === productId ? 'rgba(255,255,255,0.4)' : '#d4d0dc',
                fontSize: 14, lineHeight: 1, padding: 0,
                marginLeft: 2,
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = p.id === productId ? 'rgba(255,255,255,0.8)' : '#ef4444'}
              onMouseLeave={(e) => e.currentTarget.style.color = p.id === productId ? 'rgba(255,255,255,0.4)' : '#d4d0dc'}
            >×</button>
          </div>
        ))}

        {/* Add button / input */}
        {adding ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setAdding(false); setNewName('') }
              }}
              placeholder="製品名"
              style={{
                height: 32, width: 120, padding: '0 10px',
                fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                border: '1.5px solid #6366f1', borderRadius: 8,
                outline: 'none',
              }}
            />
            <button onClick={handleAdd} style={{
              height: 32, padding: '0 12px',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              background: '#6366f1', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}>追加</button>
            <button onClick={() => { setAdding(false); setNewName('') }} style={{
              height: 32, padding: '0 8px',
              fontSize: 12, fontFamily: 'inherit',
              background: 'none', color: '#9994a8',
              border: 'none', cursor: 'pointer',
            }}>×</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            padding: '6px 12px', borderRadius: 10,
            fontSize: 13, fontWeight: 600,
            background: 'none', border: '1.5px dashed #d4d0dc',
            color: '#b0a9bc', cursor: 'pointer',
            fontFamily: 'inherit', whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d4d0dc'; e.currentTarget.style.color = '#b0a9bc' }}
          >
            ＋ 新規
          </button>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {product ? (
          <SetupWizard productName={product.name} />
        ) : (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <p style={{ fontSize: 14, color: '#b0a9bc' }}>
              製品を選択、または新規作成してください
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
