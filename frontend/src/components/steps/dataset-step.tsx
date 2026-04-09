/**
 * Dataset Step — Capture OK/NG training images
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { datasetApi } from '@/api/dataset'
import { useAudioFeedback } from '@/hooks/useAudioFeedback'
import { useKeyboard } from '@/hooks/useKeyboard'
import { triggerFlash } from '@/components/camera/CameraFeed'
import { Toast } from '@/components/layout/Toast'
import type { DatasetClass, Judgment } from '@/types'

export function DatasetStepNew() {
  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)

  const [roiId, setRoiId] = useState<string | null>(null)
  const [classes, setClasses] = useState<DatasetClass[]>([])
  const [selClass, setSelClass] = useState('')
  const [newName, setNewName] = useState('')
  const [newJudge, setNewJudge] = useState<Judgment>('ng')
  const [thumbs, setThumbs] = useState<Array<{ cls: string; file: string; url: string }>>([])
  const { play } = useAudioFeedback()

  const loadClasses = useCallback(async () => {
    if (!productId) return
    try { setClasses(await datasetApi.listClasses(productId, roiId)) } catch {}
  }, [productId, roiId])

  useEffect(() => { loadClasses() }, [loadClasses])

  const loadImages = useCallback(async (cls: string) => {
    if (!productId || !cls) return
    try {
      const files = await datasetApi.listImages(productId, cls, roiId)
      setThumbs(files.slice(-12).reverse().map((f) => ({
        cls, file: f, url: datasetApi.imageUrl(productId, cls, f),
      })))
    } catch {}
  }, [productId, roiId])

  useEffect(() => { if (selClass) loadImages(selClass) }, [selClass, loadImages])

  const capture = useCallback(async () => {
    if (!productId || !selClass) return
    try {
      await datasetApi.capture(productId, { class_name: selClass, roi_id: roiId })
      play('capture'); triggerFlash()
      await loadClasses(); await loadImages(selClass)
    } catch { Toast.error('撮影に失敗しました') }
  }, [productId, selClass, roiId, play, loadClasses, loadImages])

  useKeyboard('Space', capture, !!selClass)

  const addClass = async () => {
    const n = newName.trim()
    if (!n || !productId) return
    try {
      await datasetApi.createClass(productId, { class_name: n, roi_id: roiId, judgment: newJudge })
      setNewName(''); await loadClasses(); setSelClass(n)
      Toast.success(`${n} を作成しました`)
    } catch { Toast.error('作成に失敗しました') }
  }

  const delClass = async (name: string) => {
    if (!productId || !confirm(`${name} を削除しますか？`)) return
    try {
      await datasetApi.deleteClass(productId, name)
      if (selClass === name) { setSelClass(''); setThumbs([]) }
      await loadClasses()
    } catch { Toast.error('削除に失敗しました') }
  }

  const delImg = async (cls: string, file: string) => {
    if (!productId) return
    try {
      await datasetApi.deleteImage(productId, { class_name: cls, filename: file, roi_id: roiId })
      await loadClasses(); await loadImages(cls)
    } catch { Toast.error('削除に失敗しました') }
  }

  const importFolder = async () => {
    if (!productId) return
    try {
      await datasetApi.importFolder(productId, roiId)
      await loadClasses(); Toast.success('インポートしました')
    } catch { Toast.error('インポートに失敗しました') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Capture Controls ── */}
      <Panel title="撮影コントロール">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <Field label="対象ROI">
            <select value={roiId ?? ''} onChange={(e) => setRoiId(e.target.value || null)} style={selectStyle}>
              <option value="">全体（フルフレーム）</option>
              {rois.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="保存先クラス">
            <select value={selClass} onChange={(e) => setSelClass(e.target.value)} style={selectStyle}>
              <option value="">-- 選択 --</option>
              {classes.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={capture} disabled={!selClass} style={{
            ...actionBtnStyle,
            opacity: selClass ? 1 : 0.4,
            cursor: selClass ? 'pointer' : 'default',
          }}>
            撮影
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 500,
              background: 'rgba(255,255,255,0.2)', padding: '2px 7px',
              borderRadius: 5, fontFamily: "'JetBrains Mono', monospace",
            }}>
              Space
            </span>
          </button>
          <button onClick={importFolder} style={ghostBtnStyle}>
            フォルダから取込
          </button>
        </div>
      </Panel>

      {/* ── Class List ── */}
      <Panel title="クラス一覧">
        {classes.length === 0 ? (
          <p style={{ fontSize: 13, color: '#b0a9bc', textAlign: 'center', padding: '24px 0' }}>
            クラスがありません
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {classes.map((c) => (
              <div key={c.name}
                onClick={() => setSelClass(c.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px', borderRadius: 10, cursor: 'pointer',
                  transition: 'all 0.12s ease',
                  ...(selClass === c.name ? {
                    background: '#1a1625', color: '#fff',
                  } : {
                    background: '#faf9f7', border: '1px solid #ebe7e2',
                  }),
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                  padding: '2px 6px', borderRadius: 5,
                  color: '#fff',
                  background: c.judgment === 'ok' ? '#10b981' : '#ef4444',
                }}>
                  {c.judgment.toUpperCase()}
                </span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11, fontWeight: 600,
                  color: selClass === c.name ? 'rgba(255,255,255,0.5)' : '#b0a9bc',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {c.count}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); delClass(c.name) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    color: selClass === c.name ? 'rgba(255,255,255,0.4)' : '#d4d0dc',
                    borderRadius: 4, lineHeight: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add class form */}
        <div style={{
          display: 'flex', gap: 8, marginTop: 14,
          paddingTop: 14, borderTop: '1px solid #f0ede9',
        }}>
          <input
            placeholder="クラス名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addClass()}
            style={{ ...inputStyle, flex: 1 }}
          />
          <select value={newJudge} onChange={(e) => setNewJudge(e.target.value as Judgment)}
            style={{ ...selectStyle, width: 70, flexShrink: 0 }}>
            <option value="ok">OK</option>
            <option value="ng">NG</option>
          </select>
          <button onClick={addClass} style={{
            ...actionBtnStyle, padding: '0 16px', flexShrink: 0,
          }}>
            追加
          </button>
        </div>
      </Panel>

      {/* ── Thumbnails ── */}
      <Panel title="最近の撮影">
        {thumbs.length === 0 ? (
          <p style={{ fontSize: 13, color: '#b0a9bc', textAlign: 'center', padding: '24px 0' }}>
            まだ撮影がありません
          </p>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8,
          }}>
            {thumbs.map((t) => (
              <button key={t.file} onClick={() => delImg(t.cls, t.file)} style={{
                padding: 0, border: 'none', cursor: 'pointer',
                borderRadius: 8, overflow: 'hidden',
                aspectRatio: '1', background: '#f0ede9',
                transition: 'all 0.15s ease',
                outline: '2px solid transparent',
              }}
                onMouseEnter={(e) => e.currentTarget.style.outline = '2px solid #ef4444'}
                onMouseLeave={(e) => e.currentTarget.style.outline = '2px solid transparent'}
              >
                <img src={t.url} alt={t.file} style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                }} />
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ── Shared ── */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0ede9' }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: '#7c7494',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>{title}</span>
      </div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600,
        color: '#9994a8', marginBottom: 5, letterSpacing: '0.03em',
      }}>{label}</label>
      {children}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 14px',
  fontSize: 13, fontWeight: 500,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3d3654', background: '#faf9f7',
  border: '1.5px solid #e8e4df', borderRadius: 10,
  appearance: 'none', outline: 'none', cursor: 'pointer',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23b0a9bc' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
}

const inputStyle: React.CSSProperties = {
  height: 38, padding: '0 14px',
  fontSize: 13, fontWeight: 500,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3d3654', background: '#faf9f7',
  border: '1.5px solid #e8e4df', borderRadius: 10,
  outline: 'none',
}

const actionBtnStyle: React.CSSProperties = {
  height: 38, padding: '0 20px',
  fontSize: 13, fontWeight: 600,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  border: 'none', borderRadius: 10, cursor: 'pointer',
  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
  color: '#fff', boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
  display: 'flex', alignItems: 'center',
}

const ghostBtnStyle: React.CSSProperties = {
  height: 38, padding: '0 16px',
  fontSize: 13, fontWeight: 600,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#5c5470', background: '#fff',
  border: '1.5px solid #e0dcd7', borderRadius: 10,
  cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}
