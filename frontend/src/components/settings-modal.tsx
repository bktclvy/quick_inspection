import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { scaleApi } from '@/api/scale'
import type { ScaleConfig } from '@/api/scale'

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const [config, setConfig] = useState<ScaleConfig | null>(null)
  const [ports, setPorts] = useState<Array<{ device: string; description: string }>>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [liveValue, setLiveValue] = useState<string | null>(null)

  useEffect(() => {
    scaleApi.getConfig().then(setConfig).catch(() => {})
    scaleApi.getPorts().then((r) => setPorts(r.ports)).catch(() => {})
  }, [])

  const patch = useCallback((updates: Partial<ScaleConfig>) => {
    setConfig((prev) => prev ? { ...prev, ...updates } : prev)
  }, [])

  const save = useCallback(async () => {
    if (!config) return
    setSaving(true)
    try {
      const result = await scaleApi.updateConfig(config)
      setConfig(result)
      setTestResult(null)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }, [config])

  const test = useCallback(async () => {
    if (!config) return
    setTesting(true)
    setTestResult(null)
    setLiveValue(null)
    try {
      await scaleApi.updateConfig(config)
      const status = await scaleApi.status()
      if (status.port_open) {
        const val = status.latest
        setTestResult('ok')
        setLiveValue(val ? `${val.value_g.toFixed(1)} g (${val.stable ? '安定' : '測定中'})` : '受信待ち')
      } else {
        setTestResult('ng')
      }
    } catch {
      setTestResult('ng')
    } finally {
      setTesting(false)
    }
  }, [config])

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(26,22,37,0.5)',
        backdropFilter: 'blur(6px)',
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      <div style={{
        width: 480,
        background: '#faf9f7',
        borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px',
          borderBottom: '1px solid #f0ede9',
        }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1a1625', margin: 0 }}>設定</h2>
            <p style={{ fontSize: 12, color: '#9994a8', marginTop: 2, marginBottom: 0 }}>
              電子秤 (A&D HC-6Ki) の接続設定
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none',
              background: '#f0ede9', cursor: 'pointer', fontSize: 16, color: '#7c7494',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '20px 24px 24px' }}>
          {!config ? (
            <p style={{ textAlign: 'center', color: '#9994a8', fontSize: 14 }}>読み込み中…</p>
          ) : (
            <>
              {/* Enabled toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1625' }}>秤連携を有効にする</span>
                <button
                  onClick={() => patch({ enabled: !config.enabled })}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: config.enabled ? '#6366f1' : '#d4d0dc',
                    position: 'relative', transition: 'background 0.2s ease',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 3, left: config.enabled ? 23 : 3,
                    width: 18, height: 18, borderRadius: 9, background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s ease',
                  }} />
                </button>
              </div>

              {/* Port */}
              <Field label="COMポート">
                <select
                  value={config.port}
                  onChange={(e) => patch({ port: e.target.value })}
                  style={selectStyle}
                >
                  <option value="">選択してください</option>
                  {ports.map((p) => (
                    <option key={p.device} value={p.device}>
                      {p.device} — {p.description}
                    </option>
                  ))}
                  {config.port && !ports.find((p) => p.device === config.port) && (
                    <option value={config.port}>{config.port}</option>
                  )}
                </select>
              </Field>

              {/* Baudrate */}
              <Field label="ボーレート">
                <select
                  value={config.baudrate}
                  onChange={(e) => patch({ baudrate: Number(e.target.value) })}
                  style={selectStyle}
                >
                  {[9600, 19200, 38400, 57600, 115200].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </Field>

              {/* Test result */}
              {testResult && (
                <div style={{
                  padding: '10px 14px', borderRadius: 10, marginBottom: 12,
                  background: testResult === 'ok' ? '#f0fdf4' : '#fef2f2',
                  border: `1.5px solid ${testResult === 'ok' ? '#86efac' : '#fca5a5'}`,
                  fontSize: 13, fontWeight: 600,
                  color: testResult === 'ok' ? '#059669' : '#dc2626',
                  textAlign: 'center',
                }}>
                  {testResult === 'ok'
                    ? `✓ 接続成功 — ${liveValue ?? ''}`
                    : '✗ 接続失敗。ポートと設定を確認してください'}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={test}
                  disabled={testing || !config.port}
                  style={{
                    flex: 1, height: 42,
                    fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                    border: '1.5px solid #e8e4df', borderRadius: 12,
                    cursor: testing || !config.port ? 'default' : 'pointer',
                    background: testing || !config.port ? '#f5f3f0' : '#fff',
                    color: testing || !config.port ? '#b0a9bc' : '#1a1625',
                  }}
                >
                  {testing ? '接続テスト中…' : '接続テスト'}
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  style={{
                    flex: 1, height: 42,
                    fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                    border: 'none', borderRadius: 12,
                    cursor: saving ? 'default' : 'pointer',
                    background: saving ? '#d4d0dc' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                    color: '#fff',
                    boxShadow: saving ? 'none' : '0 2px 8px rgba(99,102,241,0.3)',
                  }}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#7c7494', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 12px',
  fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3d3654',
  background: '#fff',
  border: '1.5px solid #e8e4df',
  borderRadius: 10,
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
}
