/**
 * App Header — Soft Geometric
 *
 * Warm, approachable precision.
 * Gentle radii, warm neutrals, subtle depth.
 * No harsh borders. Shadows create separation.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/stores/appStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { cameraApi } from '@/api/camera'

export function AppHeader() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const page = pathname === '/setup' ? 'setup' : 'inspection'

  const products          = useAppStore((s) => s.products)
  const selectedProductId = useAppStore((s) => s.selectedProductId)
  const selectProduct     = useAppStore((s) => s.selectProduct)
  const loadProducts      = useAppStore((s) => s.loadProducts)

  const starting        = useInspectionStore((s) => s.starting)
  const inspecting      = useInspectionStore((s) => s.inspecting)
  const startInspection = useInspectionStore((s) => s.startInspection)
  const stopInspection  = useInspectionStore((s) => s.stopInspection)

  const [cameras, setCameras] = useState<number[]>([0])
  const [camIdx, setCamIdx]   = useState(0)

  useEffect(() => {
    loadProducts()
    cameraApi.list().then(setCameras).catch((e) => console.warn('カメラ一覧取得失敗:', e))
  }, [loadProducts])

  return (
    <header style={{
      height: 56,
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      padding: '0 24px',
      background: 'linear-gradient(180deg, #ffffff 0%, #faf9f7 100%)',
      boxShadow: '0 1px 8px rgba(0,0,0,0.04), 0 0.5px 0 rgba(0,0,0,0.06)',
      position: 'relative',
      zIndex: 50,
      flexShrink: 0,
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* ── Logo ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 8 }}>
        <div style={{
          width: 32, height: 32,
          borderRadius: 10,
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" fill="white" stroke="none" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" strokeWidth="1.5" />
          </svg>
        </div>
        <span style={{
          fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em',
          color: '#1a1625',
        }}>
          Quick Inspection
        </span>
      </div>

      {/* ── Nav Tabs ── */}
      <nav style={{
        display: 'flex', gap: 4,
        background: '#f3f1ee',
        borderRadius: 12, padding: 3,
      }}>
        {[
          { id: 'inspection', label: '検査', path: '/' },
          { id: 'setup', label: 'セットアップ', path: '/setup' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => navigate(tab.path)} style={{
            padding: '7px 20px',
            borderRadius: 9,
            border: 'none',
            fontSize: 13, fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            ...(page === tab.id ? {
              background: '#ffffff',
              color: '#1a1625',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08), 0 0.5px 1px rgba(0,0,0,0.06)',
            } : {
              background: 'transparent',
              color: '#9994a8',
            }),
          }}>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── Product Selector (inspection page only) ── */}
      <div style={{ display: page === 'setup' ? 'none' : 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#b0a9bc',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          製品
        </span>
        <select
          value={selectedProductId ?? ''}
          onChange={(e) => selectProduct(e.target.value || null)}
          style={{
            height: 34, padding: '0 32px 0 12px',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
            color: '#3d3654',
            background: '#ffffff',
            border: '1.5px solid #e8e4df',
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 10px center',
            cursor: 'pointer',
            outline: 'none',
            minWidth: 140,
          }}
        >
          <option value="">選択してください</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* ── Divider ── */}
      <div style={{ width: 1, height: 24, background: '#ebe7e2', borderRadius: 1 }} />

      {/* ── Inspection Controls ── */}
      {page === 'inspection' && (
        <>
          {!inspecting ? (
            <button onClick={() => selectedProductId && !starting && startInspection(selectedProductId)}
              disabled={!selectedProductId || starting}
              style={{
                height: 34, padding: '0 18px',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                color: '#ffffff',
                background: !selectedProductId || starting
                  ? '#d4d0dc'
                  : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                border: 'none', borderRadius: 10,
                boxShadow: selectedProductId && !starting
                  ? '0 2px 8px rgba(99,102,241,0.3)'
                  : 'none',
                cursor: selectedProductId && !starting ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
                opacity: starting ? 0.8 : 1,
              }}>
              {starting ? 'モデル読込中…' : '検査開始'}
            </button>
          ) : (
            <button onClick={stopInspection} style={{
              height: 34, padding: '0 18px',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              color: '#ffffff',
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              border: 'none', borderRadius: 10,
              boxShadow: '0 2px 8px rgba(239,68,68,0.3)',
              cursor: 'pointer',
            }}>
              停止
            </button>
          )}
          <div style={{ width: 1, height: 24, background: '#ebe7e2', borderRadius: 1 }} />
        </>
      )}

      {/* ── Camera Selector ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b0a9bc" strokeWidth="2">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <select
          value={camIdx}
          onChange={(e) => { const v = +e.target.value; setCamIdx(v); cameraApi.configure(v).catch(() => {}) }}
          style={{
            height: 30, padding: '0 24px 0 8px',
            fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
            color: '#5c5470',
            background: '#ffffff',
            border: '1.5px solid #e8e4df',
            borderRadius: 8,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 7px center',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {cameras.map((i) => <option key={i} value={i}>Cam {i}</option>)}
        </select>
      </div>

      {/* ── Status ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: '#34d399',
          boxShadow: '0 0 6px rgba(52,211,153,0.5)',
        }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: '#b0a9bc' }}>
          接続中
        </span>
      </div>
    </header>
  )
}
