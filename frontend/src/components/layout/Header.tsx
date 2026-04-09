import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/stores/appStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { cameraApi } from '@/api/camera'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function Header() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const page = pathname === '/setup' ? 'setup' : 'inspection'

  const products         = useAppStore((s) => s.products)
  const selectedProductId = useAppStore((s) => s.selectedProductId)
  const selectProduct    = useAppStore((s) => s.selectProduct)
  const loadProducts     = useAppStore((s) => s.loadProducts)

  const inspecting       = useInspectionStore((s) => s.inspecting)
  const startInspection  = useInspectionStore((s) => s.startInspection)
  const stopInspection   = useInspectionStore((s) => s.stopInspection)

  const [cameras, setCameras] = useState<number[]>([0])
  const [camIdx, setCamIdx]   = useState(0)

  useEffect(() => {
    loadProducts()
    cameraApi.list().then(setCameras).catch(() => {})
  }, [loadProducts])

  return (
    <header className="h-14 bg-white border-b flex items-center px-4 gap-5 shrink-0 relative z-50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {/* Accent line */}
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-blue-600 via-emerald-500 to-blue-600 opacity-80" />

      {/* Logo */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </div>
        <span className="text-[15px] font-bold tracking-[-0.02em] text-gray-900">
          Quick Inspection
        </span>
      </div>

      {/* Nav */}
      <nav className="flex gap-1 ml-2">
        {([
          { id: 'inspection', label: '検査', path: '/', icon: CheckCircle },
          { id: 'setup',      label: '設定', path: '/setup', icon: Gear },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => navigate(tab.path)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-semibold rounded-lg transition-all duration-150',
              page === tab.id
                ? 'bg-gray-900 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
            )}
          >
            <tab.icon />
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Product */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">製品</span>
        <select
          className="h-8 min-w-[140px] px-3 text-[13px] bg-white border border-gray-200 rounded-lg shadow-sm
                     appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                     bg-[length:10px_6px] bg-[position:right_10px_center] bg-no-repeat"
          style={{ backgroundImage: chevronSvg }}
          value={selectedProductId ?? ''}
          onChange={(e) => selectProduct(e.target.value || null)}
        >
          <option value="">-- 選択 --</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Inspection controls */}
      {page === 'inspection' && (
        <>
          <Sep />
          {!inspecting ? (
            <Button size="sm" onClick={() => selectedProductId && startInspection(selectedProductId)} disabled={!selectedProductId}>
              検査開始
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={stopInspection}>
              停止
            </Button>
          )}
        </>
      )}

      <Sep />

      {/* Camera */}
      <div className="flex items-center gap-1.5">
        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <select
          className="h-7 px-2 text-[12px] bg-white border rounded-md shadow-sm appearance-none cursor-pointer
                     bg-[length:8px_5px] bg-[position:right_6px_center] bg-no-repeat"
          style={{ backgroundImage: chevronSvg, paddingRight: 22 }}
          value={camIdx}
          onChange={(e) => { const v = Number(e.target.value); setCamIdx(v); cameraApi.configure(v).catch(() => {}) }}
        >
          {cameras.map((i) => <option key={i} value={i}>Cam {i}</option>)}
        </select>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <div className="w-[7px] h-[7px] rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
        <span className="text-[12px] font-medium text-gray-400">接続中</span>
      </div>
    </header>
  )
}

/* ── Small bits ───────────────────────────────────── */

function Sep() { return <div className="w-px h-5 bg-gray-200" /> }

const chevronSvg = `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`

function CheckCircle() {
  return (
    <svg className="w-[14px] h-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
    </svg>
  )
}
function Gear() {
  return (
    <svg className="w-[14px] h-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}
