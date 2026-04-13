/**
 * Trigger Step — Two rectangles:
 *   1. Search area (large) — where to look each frame
 *   2. Template (small) — what to match within the search area
 */

import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'
import { api } from '@/api/client'
import type { InspectionConfig } from '@/types'

export type TriggerDrawMode = 'search' | 'template' | null

interface Props {
  imgEl: HTMLImageElement | null
  onStartDrawing: (mode: TriggerDrawMode) => void
  drawMode: TriggerDrawMode
}

export function TriggerStep({ onStartDrawing, drawMode }: Props) {
  const productId = useAppStore((s) => s.selectedProductId)
  const selectedProduct = useAppStore((s) => s.selectedProduct)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

  const [searchRegion, setSearchRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [templateCount, setTemplateCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  // 閾値設定
  const [config, setConfig] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (!productId) return
    productsApi.getConfig(productId).then((c) => setConfig(c as unknown as Record<string, unknown>)).catch(() => {})
  }, [productId])

  const saveConfig = useCallback(async (updates: Record<string, unknown>) => {
    if (!productId) return
    const merged = { ...config, ...updates }
    setConfig(merged)
    try { await productsApi.saveConfig(productId, merged as Partial<InspectionConfig>) }
    catch { Toast.error('保存に失敗しました') }
  }, [productId, config])

  useEffect(() => {
    if (!selectedProduct) return
    setSearchRegion(selectedProduct.trigger_search_region ?? null)
    setTemplateCount(selectedProduct.trigger_template_count || 0)
  }, [selectedProduct])

  const deleteTemplate = useCallback(async (index: number) => {
    if (!productId) return
    try {
      const res = await api<{ remaining: number }>(`/products/${productId}/trigger-template/${index}`).delete()
      setTemplateCount(res.remaining)
      setRefreshKey((k) => k + 1)
    } catch { Toast.error('削除に失敗しました') }
  }, [productId])

  const [hasBg, setHasBg] = useState(false)
  const [liveScores, setLiveScores] = useState<{ trigger_score: number | null; bg_score: number | null }>({ trigger_score: null, bg_score: null })
  const [showLive, setShowLive] = useState(false)

  useEffect(() => {
    if (!productId) return
    api<{ has_background: boolean }>(`/products/${productId}/background-status`).get()
      .then((r) => setHasBg(r.has_background)).catch(() => {})
  }, [productId])

  const captureBg = async () => {
    if (!productId) return
    try {
      await api(`/products/${productId}/capture-background`).post()
      setHasBg(true)
      setRefreshKey((k) => k + 1)
      Toast.success('背景を撮影しました')
    } catch { Toast.error('背景撮影に失敗しました') }
  }

  // リアルタイムスコアポーリング
  useEffect(() => {
    if (!showLive || !productId) return
    let active = true
    const poll = async () => {
      while (active) {
        try {
          const res = await api<{ trigger_score: number | null; bg_score: number | null }>(
            `/products/${productId}/trigger-scores`).get()
          if (active) setLiveScores(res)
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    poll()
    return () => { active = false }
  }, [showLive, productId])

  const deleteSearchRegion = async () => {
    if (!productId) return
    try {
      await api(`/products/${productId}/trigger-search-region`).delete()
      setSearchRegion(null)
      await refreshROIs()
    } catch { Toast.error('失敗') }
  }

  const triggerMode = (config.trigger_mode as string) || 'auto'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Trigger Mode ── */}
      <Panel title="検査トリガー">
        <div style={{ display: 'flex', gap: 12 }}>
          {([
            { value: 'auto', label: '自動', desc: 'テンプレートマッチングで検知' },
            { value: 'manual', label: '手動', desc: 'Spaceキーで検査実行' },
          ] as const).map((opt) => (
            <label key={opt.value} style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
              transition: 'all 0.15s ease',
              border: triggerMode === opt.value
                ? '2px solid #6366f1' : '2px solid #e8e4df',
              background: triggerMode === opt.value
                ? '#f5f3ff' : '#faf9f7',
            }}>
              <input
                type="radio" name="trigger_mode"
                checked={triggerMode === opt.value}
                onChange={() => saveConfig({ trigger_mode: opt.value })}
                style={{ accentColor: '#6366f1', width: 16, height: 16 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#3d3654' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#9994a8', marginTop: 2 }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </Panel>

      {/* ── Step 1: Search Area ── */}
      <Panel title="① 検索エリア" accent="#6366f1">
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 12, lineHeight: 1.6 }}>
          毎フレーム監視する範囲をカメラ上で指定してください。
        </p>
        {searchRegion ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 10,
            background: '#eef2ff', border: '1px solid #e0e7ff',
          }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#6366f1' }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#3730a3' }}>設定済み</span>
            <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#6366f1' }}>
              {(searchRegion.w * 100).toFixed(0)}% × {(searchRegion.h * 100).toFixed(0)}%
            </span>
            <button onClick={() => onStartDrawing('search')} style={smallBtn}>再設定</button>
            <button onClick={deleteSearchRegion} style={{ ...smallBtn, color: '#dc2626' }}>削除</button>
          </div>
        ) : (
          <button onClick={() => onStartDrawing('search')} style={{
            ...drawBtn,
            borderColor: drawMode === 'search' ? '#6366f1' : '#d8d3cc',
            background: drawMode === 'search' ? '#eef2ff' : 'transparent',
            color: drawMode === 'search' ? '#4338ca' : '#9994a8',
          }}>
            {drawMode === 'search' ? 'カメラ上でドラッグ...' : 'カメラ上で検索エリアを選択'}
          </button>
        )}
      </Panel>

      {/* ── Step 2: Template ── */}
      <Panel title="② テンプレート" accent="#f59e0b">
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 12, lineHeight: 1.6 }}>
          製品の特徴的な部分をカメラ上で矩形選択してください。複数登録可能です。
        </p>
        <button onClick={() => onStartDrawing('template')} style={{
          ...drawBtn,
          borderColor: drawMode === 'template' ? '#f59e0b' : '#d8d3cc',
          background: drawMode === 'template' ? '#fffbeb' : 'transparent',
          color: drawMode === 'template' ? '#b45309' : '#9994a8',
          marginBottom: 12,
        }}>
          {drawMode === 'template' ? 'カメラ上でドラッグ...' : '＋ カメラ上でテンプレートを選択'}
        </button>

        {templateCount > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: 8,
          }}>
            {Array.from({ length: templateCount }, (_, i) => (
              <div key={`t-${i}-${refreshKey}`} style={{
                position: 'relative', borderRadius: 10, overflow: 'hidden',
                border: '1px solid #fef3c7', background: '#fffbeb',
                aspectRatio: '4/3',
              }}>
                <img
                  src={`/api/products/${productId}/trigger-template?index=${i}&t=${refreshKey}`}
                  alt={`#${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <span style={{
                  position: 'absolute', top: 4, left: 4,
                  fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                  color: '#fff', background: 'rgba(0,0,0,0.5)',
                  padding: '1px 5px', borderRadius: 4,
                }}>#{i + 1}</span>
                <button onClick={() => deleteTemplate(i)} style={thumbDelete}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(220,38,38,0.8)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)' }}
                >×</button>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: '#ccc8d4', textAlign: 'center', padding: '16px 0' }}>
            テンプレートがありません
          </p>
        )}
      </Panel>

      {/* ── Background (removal detection) ── */}
      <Panel title="③ 背景（取出し検知用）" accent="#10b981">
        <p style={{ fontSize: 13, color: '#9994a8', marginBottom: 12, lineHeight: 1.6 }}>
          製品を置かない状態で撮影してください。取出し検知に使用します。
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: hasBg ? 12 : 0 }}>
          <button onClick={captureBg} style={{
            height: 36, padding: '0 18px',
            fontSize: 13, fontWeight: 600,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            borderRadius: 10, cursor: 'pointer',
            background: hasBg ? '#f0fdf4' : 'linear-gradient(135deg, #10b981, #059669)',
            color: hasBg ? '#059669' : '#fff',
            boxShadow: hasBg ? 'none' : '0 2px 8px rgba(16,185,129,0.3)',
            border: hasBg ? '1.5px solid #d1fae5' : 'none',
          }}>
            {hasBg ? '再撮影' : '背景を撮影'}
          </button>
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: hasBg ? '#059669' : '#b0a9bc',
          }}>
            {hasBg ? '✓ 撮影済み' : '未撮影'}
          </span>
        </div>
        {hasBg && productId && (
          <img
            src={`/api/products/${productId}/background?t=${refreshKey}`}
            alt="背景"
            style={{
              width: '100%', maxHeight: 200,
              objectFit: 'contain', borderRadius: 10,
              border: '1px solid #d1fae5', background: '#f0fdf4',
            }}
          />
        )}
      </Panel>
      {/* ── Thresholds + Live Scores ── */}
      <Panel title="④ 検知パラメータ">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          <div>
            <label style={paramLabel}>設置検知マッチ閾値</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={0.5} max={0.99} step={0.01}
                value={config.match_threshold as number ?? 0.8}
                onChange={(e) => saveConfig({ match_threshold: +e.target.value })}
                style={{ flex: 1, height: 4, accentColor: '#f59e0b' }} />
              <span style={paramValue}>{((config.match_threshold as number) ?? 0.8).toFixed(2)}</span>
            </div>
          </div>
          <div>
            <label style={paramLabel}>取出し背景閾値</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={0.5} max={0.99} step={0.01}
                value={config.removal_bg_threshold as number ?? 0.85}
                onChange={(e) => saveConfig({ removal_bg_threshold: +e.target.value })}
                style={{ flex: 1, height: 4, accentColor: '#10b981' }} />
              <span style={paramValue}>{((config.removal_bg_threshold as number) ?? 0.85).toFixed(2)}</span>
            </div>
          </div>
          <div>
            <label style={paramLabel}>トリガーフレーム数</label>
            <input type="number" min={1} max={30}
              value={config.trigger_frames as number ?? 3}
              onChange={(e) => saveConfig({ trigger_frames: +e.target.value })}
              style={numInput} />
          </div>
          <div>
            <label style={paramLabel}>安定フレーム数</label>
            <input type="number" min={1} max={30}
              value={config.stability_frames as number ?? 8}
              onChange={(e) => saveConfig({ stability_frames: +e.target.value })}
              style={numInput} />
          </div>
          <div>
            <label style={paramLabel}>安定閾値（フレーム差分）</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={1} max={30} step={0.5}
                value={config.stability_threshold as number ?? 5}
                onChange={(e) => saveConfig({ stability_threshold: +e.target.value })}
                style={{ flex: 1, height: 4, accentColor: '#6366f1' }} />
              <span style={paramValue}>{((config.stability_threshold as number) ?? 5).toFixed(1)}</span>
            </div>
          </div>
          <div>
            <label style={paramLabel}>取出しフレーム数</label>
            <input type="number" min={1} max={30}
              value={config.removal_frames as number ?? 3}
              onChange={(e) => saveConfig({ removal_frames: +e.target.value })}
              style={numInput} />
          </div>
        </div>

        {/* Live score toggle */}
        <div style={{ borderTop: '1px solid #f0ede9', paddingTop: 14 }}>
          <button onClick={() => setShowLive(!showLive)} style={{
            height: 34, padding: '0 16px',
            fontSize: 12, fontWeight: 600,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            border: showLive ? '1.5px solid #e0dcd7' : 'none',
            borderRadius: 10, cursor: 'pointer',
            background: showLive ? '#fff' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: showLive ? '#5c5470' : '#fff',
            boxShadow: showLive ? 'none' : '0 2px 8px rgba(99,102,241,0.25)',
          }}>
            {showLive ? '⏹ モニター停止' : '▶ リアルタイムモニター'}
          </button>
        </div>

        {showLive && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ScoreBar label="製品検知" score={liveScores.trigger_score}
              threshold={config.match_threshold as number ?? 0.8} color="#f59e0b" />
            <ScoreBar label="背景一致" score={liveScores.bg_score}
              threshold={config.removal_bg_threshold as number ?? 0.85} color="#10b981" />
          </div>
        )}
      </Panel>
    </div>
  )
}

function ScoreBar({ label, score, threshold, color }: {
  label: string; score: number | null; threshold: number; color: string
}) {
  const val = score ?? 0
  const above = score != null && score >= threshold
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#7c7494' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {above && <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '1px 6px', borderRadius: 4 }}>閾値超過</span>}
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            color: above ? '#059669' : '#1a1625',
          }}>
            {score != null ? score.toFixed(3) : '---'}
          </span>
        </div>
      </div>
      <div style={{ position: 'relative', height: 8, borderRadius: 4, background: '#f0ede9', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: color,
          width: `${val * 100}%`, transition: 'width 0.3s ease', opacity: 0.7,
        }} />
        {/* Threshold marker */}
        <div style={{
          position: 'absolute', top: -2, bottom: -2,
          left: `${threshold * 100}%`, width: 2,
          background: '#1a1625', borderRadius: 1,
        }} />
      </div>
    </div>
  )
}

const paramLabel: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#9994a8',
  marginBottom: 5, letterSpacing: '0.03em',
}

const paramValue: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12, fontWeight: 600, color: '#5c5470',
  minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
}

const numInput: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 12px',
  fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3d3654', background: '#faf9f7',
  border: '1.5px solid #e8e4df', borderRadius: 10, outline: 'none',
}

function Panel({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
      borderLeft: accent ? `3px solid ${accent}` : undefined,
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

const drawBtn: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 12,
  border: '2px dashed #d8d3cc', background: 'transparent',
  fontSize: 14, fontWeight: 600, color: '#9994a8',
  cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
  transition: 'all 0.15s ease',
}

const smallBtn: React.CSSProperties = {
  height: 28, padding: '0 10px', fontSize: 11, fontWeight: 600,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#5c5470', background: '#fff',
  border: '1.5px solid #e0dcd7', borderRadius: 7, cursor: 'pointer',
}

const thumbDelete: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 22, height: 22, borderRadius: 6,
  background: 'rgba(0,0,0,0.5)', border: 'none',
  color: '#fff', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
