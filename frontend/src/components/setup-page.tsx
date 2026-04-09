/**
 * Setup Page — Complete Redesign
 *
 * UX Flow:
 *   1. Product selection screen (grid of product cards)
 *   2. Wizard flow (5 steps, one at a time)
 *
 * This file handles: Product selection + routing to wizard.
 * Wizard steps will be added one by one in subsequent files.
 *
 * Aesthetic: Soft Geometric — warm tones, gentle radii, layered shadows
 */

import { useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { SetupWizard } from '@/components/setup-wizard'

export function SetupPageNew() {
  const products    = useAppStore((s) => s.products)
  const productId    = useAppStore((s) => s.selectedProductId)
  const loadProducts = useAppStore((s) => s.loadProducts)

  useEffect(() => { loadProducts() }, [loadProducts])

  const product = products.find((p) => p.id === productId)

  // No product selected → simple prompt (not a full screen)
  if (!productId || !product) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        background: '#f7f5f2',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(99,102,241,0.25)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1a1625', marginBottom: 6 }}>
            製品を選択してください
          </p>
          <p style={{ fontSize: 13, color: '#9994a8' }}>
            ヘッダーの製品セレクターから選択、または新規作成
          </p>
        </div>
      </div>
    )
  }

  // Product selected → wizard
  return <SetupWizard productName={product.name} />
}

