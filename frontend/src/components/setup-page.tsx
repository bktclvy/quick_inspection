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

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      background: '#f7f5f2',
    }}>
      {/* ── Product Selector Bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        borderBottom: '1px solid #ebe7e2',
        background: '#faf9f7',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#9994a8', letterSpacing: '0.06em' }}>
          製品
        </span>
        <select
          value={productId ?? ''}
          onChange={(e) => selectProduct(e.target.value || null)}
          style={{
            height: 36, padding: '0 32px 0 12px', minWidth: 180,
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            color: '#3d3654', background: '#fff',
            border: '1.5px solid #e8e4df', borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 10px center',
            cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="">選択してください</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

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
              placeholder="製品名を入力"
              style={{
                height: 36, width: 160, padding: '0 12px',
                fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                border: '1.5px solid #6366f1', borderRadius: 10,
                outline: 'none',
              }}
            />
            <button onClick={handleAdd} style={{
              height: 36, padding: '0 14px',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              background: '#6366f1', color: '#fff',
              border: 'none', borderRadius: 10, cursor: 'pointer',
            }}>追加</button>
            <button onClick={() => { setAdding(false); setNewName('') }} style={{
              height: 36, padding: '0 10px',
              fontSize: 13, fontFamily: 'inherit',
              background: 'none', color: '#9994a8',
              border: 'none', cursor: 'pointer',
            }}>キャンセル</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            height: 36, padding: '0 14px',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            background: 'none', border: '1.5px solid #d4d0dc',
            color: '#7c7494', borderRadius: 10,
            cursor: 'pointer', whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d4d0dc'; e.currentTarget.style.color = '#7c7494' }}
          >
            + 新規作成
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
