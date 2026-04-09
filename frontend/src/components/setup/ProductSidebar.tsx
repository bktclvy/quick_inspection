import { useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { productsApi } from '../../api/products'
import { Toast } from '../layout/Toast'

export function ProductSidebar() {
  const products = useAppStore((s) => s.products)
  const selectedProductId = useAppStore((s) => s.selectedProductId)
  const selectProduct = useAppStore((s) => s.selectProduct)
  const loadProducts = useAppStore((s) => s.loadProducts)
  const [newName, setNewName] = useState('')

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const product = await productsApi.create({ name })
      setNewName('')
      await loadProducts()
      selectProduct(product.id)
      Toast.success(`${name} を作成しました`)
    } catch {
      Toast.error('製品の作成に失敗しました')
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`${name} を削除しますか？`)) return
    try {
      await productsApi.delete(id)
      if (selectedProductId === id) selectProduct(null)
      await loadProducts()
      Toast.success(`${name} を削除しました`)
    } catch {
      Toast.error('削除に失敗しました')
    }
  }

  return (
    <div className="setup-sidebar">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="card-title">製品一覧</div>
        <div className="product-list">
          {products.length === 0 ? (
            <div className="empty-state">製品がありません</div>
          ) : (
            products.map((p) => (
              <div
                key={p.id}
                className="product-item"
                data-active={p.id === selectedProductId}
                onClick={() => selectProduct(p.id)}
              >
                <span className="product-item-name">{p.name}</span>
                <span className="product-item-count">{p.roi_count}</span>
                <button
                  className="product-item-delete btn-icon"
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name) }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
        <div className="new-product-form">
          <input
            className="input input-sm"
            placeholder="製品名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn btn-primary btn-sm" onClick={handleAdd}>追加</button>
        </div>
      </div>
    </div>
  )
}
