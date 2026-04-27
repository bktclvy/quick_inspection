import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/stores/appStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { useCalibrationStore } from '@/stores/calibrationStore'
import { useScaleStore } from '@/stores/scaleStore'
import { useScalePolling } from '@/hooks/useScalePolling'
import { scaleApi } from '@/api/scale'
import { cameraApi } from '@/api/camera'
import { productsApi } from '@/api/products'
import type { TriggerMode } from '@/types'

export function AppHeader() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const page = pathname === '/setup' ? 'setup' : 'inspection'

  const products          = useAppStore((s) => s.products)
  const selectedProductId = useAppStore((s) => s.selectedProductId)
  const selectedProduct   = useAppStore((s) => s.selectedProduct)
  const selectProduct     = useAppStore((s) => s.selectProduct)
  const loadProducts      = useAppStore((s) => s.loadProducts)

  const starting        = useInspectionStore((s) => s.starting)
  const inspecting      = useInspectionStore((s) => s.inspecting)
  const stopInspection  = useInspectionStore((s) => s.stopInspection)
  const openCalibration = useCalibrationStore((s) => s.open)

  const [cameras, setCameras] = useState<number[]>([0])
  const [camIdx, setCamIdx]   = useState(0)

  // 秤状態 (packing enabled 製品の検査開始ゲート用)
  const scalePortOpen = useScaleStore((s) => s.portOpen)
  const scaleLive     = useScaleStore((s) => s.live)

  // ヘッダーは常にマウントされているので、ここでポーリングする
  useScalePolling(1500)

  useEffect(() => {
    loadProducts()
    cameraApi.list().then(setCameras).catch(() => {})
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
          width: 32, height: 32, borderRadius: 10,
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
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1625' }}>
          Quick Inspection
        </span>
      </div>

      {/* ── Nav Tabs ── */}
      <nav style={{ display: 'flex', gap: 4, background: '#f3f1ee', borderRadius: 12, padding: 3 }}>
        {[
          { id: 'inspection', label: '検査', path: '/' },
          { id: 'setup', label: 'セットアップ', path: '/setup' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => navigate(tab.path)} style={{
            padding: '7px 20px', borderRadius: 9, border: 'none',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            transition: 'all 0.2s ease',
            ...(page === tab.id ? {
              background: '#ffffff', color: '#1a1625',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08), 0 0.5px 1px rgba(0,0,0,0.06)',
            } : { background: 'transparent', color: '#9994a8' }),
          }}>
            {tab.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      {/* ── Product Selector ── */}
      <div style={{ display: page === 'setup' ? 'none' : 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#b0a9bc', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          製品
        </span>
        <select
          value={selectedProductId ?? ''}
          onChange={(e) => selectProduct(e.target.value || null)}
          style={{
            height: 34, padding: '0 32px 0 12px',
            fontSize: 13, fontWeight: 500, fontFamily: 'inherit', color: '#3d3654',
            background: '#ffffff', border: '1.5px solid #e8e4df', borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
            cursor: 'pointer', outline: 'none', minWidth: 140,
          }}
        >
          <option value="">選択してください</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div style={{ width: 1, height: 24, background: '#ebe7e2', borderRadius: 1 }} />

      {/* ── Inspection Controls ── */}
      {page === 'inspection' && (
        <>
          {!inspecting ? (
            <button
              onClick={async () => {
                if (!selectedProductId || starting) return
                const packingEnabled = (selectedProduct?.inspection_config?.packing?.enabled) === true
                if (packingEnabled && !(scalePortOpen && scaleLive)) {
                  alert('この製品は秤による員数検証が有効です。画面上部の秤ウィジェットから接続と通信を確認してから検査を開始してください。')
                  return
                }
                const mode = ((selectedProduct?.inspection_config as { trigger_mode?: TriggerMode } | undefined)?.trigger_mode) ?? 'auto_background'
                const tmplExists = (selectedProduct?.trigger_template_count ?? 0) > 0
                let bgExists = false
                try {
                  const r = await productsApi.backgroundStatus(selectedProductId)
                  bgExists = r.has_background
                } catch { /* 無視: false のまま */ }
                openCalibration(selectedProductId, mode, bgExists, tmplExists)
              }}
              disabled={!selectedProductId || starting || (
                (selectedProduct?.inspection_config?.packing?.enabled) === true &&
                !(scalePortOpen && scaleLive)
              )}
              style={{
                height: 34, padding: '0 18px',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit', color: '#ffffff',
                background: !selectedProductId || starting ? '#d4d0dc' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                border: 'none', borderRadius: 10,
                boxShadow: selectedProductId && !starting ? '0 2px 8px rgba(99,102,241,0.3)' : 'none',
                cursor: selectedProductId && !starting ? 'pointer' : 'default',
                transition: 'all 0.2s ease', opacity: starting ? 0.8 : 1,
              }}>
              {starting ? 'モデル読込中…' : '検査開始'}
            </button>
          ) : (
            <button onClick={stopInspection} style={{
              height: 34, padding: '0 18px',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit', color: '#ffffff',
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              border: 'none', borderRadius: 10,
              boxShadow: '0 2px 8px rgba(239,68,68,0.3)', cursor: 'pointer',
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
            fontSize: 12, fontWeight: 500, fontFamily: 'inherit', color: '#5c5470',
            background: '#ffffff', border: '1.5px solid #e8e4df', borderRadius: 8,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)', appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 7px center',
            cursor: 'pointer', outline: 'none',
          }}
        >
          {cameras.map((i) => <option key={i} value={i}>Cam {i}</option>)}
        </select>
      </div>

      {/* ── 秤ウィジェット（接続状態表示 + 未接続時に設定パネル） ── */}
      <ScaleWidget />

      {/* ── サーバー接続インジケーター ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: '#34d399', boxShadow: '0 0 6px rgba(52,211,153,0.5)',
        }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: '#b0a9bc' }}>接続中</span>
      </div>
    </header>
  )
}

function ScaleWidget() {
  const portOpen = useScaleStore((s) => s.portOpen)
  const live     = useScaleStore((s) => s.live)
  const value_g  = useScaleStore((s) => s.value_g)
  const stable   = useScaleStore((s) => s.stable)
  const overload = useScaleStore((s) => s.overload)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const hasData = portOpen && live && value_g != null
  const toggle = () => setOpen((o) => !o)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {!portOpen ? (
        /* 未接続: クリックして接続パネルを開く */
        <button onClick={toggle} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          height: 32, padding: '0 12px',
          borderRadius: 8, border: '1.5px solid #fca5a5',
          background: '#fef2f2', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>秤</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>未接続</span>
          <span style={{ fontSize: 10, color: '#dc2626', opacity: 0.7 }}>▼</span>
        </button>
      ) : !hasData ? (
        /* ポート開通・データ未受信（通信設定不一致など） */
        <button onClick={toggle} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 32, padding: '0 12px',
          borderRadius: 8, border: '1.5px solid #d1d5db',
          background: '#f9fafb', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>秤</span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#9ca3af',
          }}>-- g</span>
          <span style={{ fontSize: 10, color: '#9ca3af' }}>受信待ち</span>
          <span style={{ fontSize: 10, color: '#d1d5db' }}>▼</span>
        </button>
      ) : (
        /* 正常動作中: ステータス表示のみ (グラム数字は普段出さない) + 設定ボタン */
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={toggle} title="秤設定" style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 32, padding: '0 12px',
            borderRadius: 8,
            border: `1.5px solid ${overload ? '#fca5a5' : '#86efac'}`,
            background: overload ? '#fef2f2' : '#f0fdf4',
            fontFamily: 'inherit', cursor: 'pointer',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: overload ? '#dc2626' : stable ? '#059669' : '#d97706',
              boxShadow: `0 0 6px ${overload ? 'rgba(220,38,38,0.5)' : stable ? 'rgba(5,150,105,0.5)' : 'rgba(217,119,6,0.5)'}`,
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: overload ? '#dc2626' : '#059669' }}>秤</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: overload ? '#dc2626' : '#059669', opacity: 0.85 }}>
              {overload ? '計量オーバー' : stable ? '接続中' : '測定中'}
            </span>
          </button>
        </div>
      )}

      {open && <ScaleConnectPanel connected={portOpen} onClose={() => setOpen(false)} />}
    </div>
  )
}

function ScaleConnectPanel({ connected, onClose }: { connected: boolean; onClose: () => void }) {
  const update = useScaleStore((s) => s.update)
  const [ports, setPorts] = useState<Array<{ device: string; description: string }>>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [baudrate, setBaudrate] = useState(9600)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    scaleApi.getPorts().then((r) => setPorts(r.ports)).catch(() => {})
    scaleApi.getConfig().then((c) => {
      if (c.port) setSelectedPort(c.port)
      if (c.baudrate) setBaudrate(c.baudrate)
    }).catch(() => {})
  }, [])

  const handleConnect = useCallback(async () => {
    if (!selectedPort) return
    setConnecting(true)
    setError(null)
    try {
      // HC-6Ki: 7bit / Even parity / 1 stop bit で固定
      await scaleApi.updateConfig({
        port: selectedPort, baudrate,
        data_bits: 7, parity: 'E', stop_bits: 1,
        enabled: true,
      })
      const status = await scaleApi.status()
      if (status.port_open) {
        const live = status.data_age_ms != null && status.data_age_ms <= 2000 && status.latest != null
        update({
          portOpen: true, live,
          value_g: status.latest?.value_g ?? null,
          stable: status.latest?.stable ?? false,
          overload: status.latest?.overload ?? false,
        })
        onClose()
      } else {
        setError('接続できませんでした。ポートを確認してください。')
      }
    } catch {
      setError('通信エラーが発生しました。')
    } finally {
      setConnecting(false)
    }
  }, [selectedPort, baudrate, update, onClose])

  const handleDisconnect = useCallback(async () => {
    try {
      await scaleApi.updateConfig({ enabled: false })
      update({ portOpen: false, live: false, value_g: null, stable: false, overload: false })
      onClose()
    } catch { /* 無視 */ }
  }, [update, onClose])

  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 8px)', right: 0,
      width: 280,
      background: '#fff',
      borderRadius: 14,
      boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
      border: '1px solid #f0ede9',
      padding: '16px',
      zIndex: 100,
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: '#1a1625', margin: '0 0 4px' }}>
        秤の接続設定
      </p>
      <p style={{ fontSize: 11, color: '#b0a9bc', margin: '0 0 14px' }}>
        A&amp;D HC-6Ki / 9600bps / 7E1
      </p>

      {/* ポート選択 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#9994a8', marginBottom: 5 }}>
          COMポート
        </label>
        {ports.length === 0 ? (
          <p style={{ fontSize: 12, color: '#b0a9bc', margin: 0 }}>ポートが見つかりません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {ports.map((p) => (
              <label key={p.device} style={{
                display: 'flex', alignItems: 'flex-start', gap: 9,
                padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
                border: selectedPort === p.device ? '2px solid #6366f1' : '2px solid #ebe7e2',
                background: selectedPort === p.device ? '#f5f3ff' : '#faf9f7',
              }}>
                <input
                  type="radio" name="scale-port" value={p.device}
                  checked={selectedPort === p.device}
                  onChange={() => setSelectedPort(p.device)}
                  style={{ marginTop: 2, accentColor: '#6366f1' }}
                />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1625', fontFamily: "'JetBrains Mono', monospace" }}>
                    {p.device}
                  </div>
                  <div style={{ fontSize: 11, color: '#9994a8' }}>
                    {p.description || 'シリアルポート'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ボーレート */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#9994a8', marginBottom: 5 }}>
          ボーレート
        </label>
        <select
          value={baudrate}
          onChange={(e) => setBaudrate(+e.target.value)}
          style={{
            width: '100%', height: 34, padding: '0 10px',
            fontSize: 12, fontWeight: 500, fontFamily: 'inherit', color: '#3d3654',
            background: '#faf9f7', border: '1.5px solid #e8e4df', borderRadius: 8,
            outline: 'none', cursor: 'pointer',
          }}
        >
          {[2400, 4800, 9600].map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: '#dc2626', padding: '8px 10px', background: '#fef2f2', borderRadius: 8, margin: '0 0 10px' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleConnect}
          disabled={connecting || !selectedPort}
          style={{
            flex: 1, height: 36,
            fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            border: 'none', borderRadius: 10,
            cursor: connecting || !selectedPort ? 'default' : 'pointer',
            background: connecting || !selectedPort ? '#e8e4df' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
            color: connecting || !selectedPort ? '#b0a9bc' : '#fff',
            boxShadow: connecting || !selectedPort ? 'none' : '0 2px 8px rgba(99,102,241,0.25)',
          }}
        >
          {connecting ? '接続中…' : '接続する'}
        </button>
        {connected && (
          <button
            onClick={handleDisconnect}
            style={{
              height: 36, padding: '0 14px',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              border: '1.5px solid #fca5a5', borderRadius: 10,
              background: '#fef2f2', color: '#dc2626', cursor: 'pointer',
            }}
          >
            切断
          </button>
        )}
      </div>
    </div>
  )
}
