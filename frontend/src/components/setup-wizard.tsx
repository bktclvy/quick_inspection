/**
 * Setup Wizard — Step-by-step configuration flow
 *
 * Aesthetic: Soft Geometric
 * Structure:
 *   - Top: Progress bar with step labels + completion indicators
 *   - Middle: Camera (left 45%) + Step controls (right 55%)
 *   - Bottom: Back / Next navigation
 *
 * Camera hides on training step (step 4).
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ROICanvas } from '@/components/camera/ROICanvas'
import { Toast } from '@/components/layout/Toast'
import { BasicSettingsStep } from '@/components/steps/basic-settings-step'
import { TriggerStep } from '@/components/steps/trigger-step'
import { api } from '@/api/client'
import { ROIStep } from '@/components/steps/roi-step'
import { DatasetStepNew } from '@/components/steps/dataset-step'
import { TrainingStepNew } from '@/components/steps/training-step'
import { AssignStepNew } from '@/components/steps/assign-step'
import { PackingStep } from '@/components/steps/packing-step'

const STEPS = [
  { label: '基本設定',     desc: '製品の基本パラメータを設定' },
  { label: 'トリガー',     desc: '製品検知の領域とテンプレートを設定' },
  { label: 'ROI設定',     desc: '検査領域を定義' },
  { label: 'データ収集',   desc: 'OK/NG画像を収集' },
  { label: '学習',         desc: 'モデルを訓練' },
  { label: 'モデル割当',   desc: 'ROIにモデルを紐付け' },
  { label: '梱包校正',     desc: '秤を使った員数検証の設定（任意）' },
] as const

interface Props {
  productName: string
}

export function SetupWizard({ productName }: Props) {
  const [step, setStep] = useState(0)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const [editMode, setEditMode] = useState(false)
  // Trigger drawing state
  type TriggerDrawMode = 'search' | 'template' | null
  const [triggerDrawMode, setTriggerDrawMode] = useState<TriggerDrawMode>(null)

  // Test results for ROI overlay coloring
  const [testResults, setTestResults] = useState<Array<{ roi_id: string; judgment: string }>>([])
  // Clear results when leaving assign step
  const prevStep = useRef(step)
  useEffect(() => { if (prevStep.current !== step) setTestResults([]); prevStep.current = step }, [step])

  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const selectedProduct = useAppStore((s) => s.selectedProduct)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

  // ステップ移動のたびに selectedProduct をリフレッシュ。
  // BasicSettingsStep など各ステップが saveConfig してもAppStoreは自動更新されないため、
  // 次のステップに入る前に必ずサーバーから最新を取り直す。
  useEffect(() => {
    if (productId) refreshROIs()
  }, [step, productId, refreshROIs])

  const handleDraw = useCallback(async (rect: { x: number; y: number; w: number; h: number }) => {
    if (!productId) return
    const name = prompt('ROI名:', `ROI ${rois.length + 1}`)
    if (!name) return
    try { await productsApi.addROI(productId, { name, ...rect }); await refreshROIs() }
    catch { Toast.error('ROI作成失敗') }
  }, [productId, rois.length, refreshROIs])

  const handleROIUpdate = useCallback(async (roiId: string, rect: { x: number; y: number; w: number; h: number }) => {
    if (!productId) return
    try { await productsApi.updateROI(productId, roiId, rect); await refreshROIs() }
    catch { Toast.error('更新失敗') }
  }, [productId, refreshROIs])

  // Trigger draw complete: depends on mode
  const handleTriggerDrawComplete = useCallback(async (rect: { x: number; y: number; w: number; h: number }) => {
    if (!productId) return
    try {
      if (triggerDrawMode === 'search') {
        await api(`/products/${productId}/trigger-search-region`).put(rect)
        Toast.success('検索エリアを設定しました')
      } else if (triggerDrawMode === 'template') {
        await api(`/products/${productId}/trigger-template/capture`).post(rect)
        Toast.success('テンプレートを撮影しました')
      }
      await refreshROIs()
    } catch { Toast.error('失敗しました') }
  }, [productId, triggerDrawMode, refreshROIs])

  const showCamera = step !== 4 && step !== 6  // 学習・梱包ステップはカメラ非表示
  const canGoNext = step < STEPS.length - 1
  const canGoBack = step > 0

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      background: '#f7f5f2',
    }}>

      {/* ═══ Progress Header ═══ */}
      <div style={{
        flexShrink: 0, padding: '16px 28px 12px',
        background: 'linear-gradient(180deg, #faf9f7 0%, #f7f5f2 100%)',
        borderBottom: '1px solid #ebe7e2',
      }}>
        {/* Product name + step counter */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1a1625' }}>
              {productName}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 600, color: '#9994a8',
              background: '#f0ede9', padding: '3px 10px', borderRadius: 8,
            }}>
              {rois.length} ROI
            </span>
          </div>
          <span style={{
            fontSize: 12, fontWeight: 600, color: '#b0a9bc',
          }}>
            ステップ {step + 1} / {STEPS.length}
          </span>
        </div>

        {/* Step progress dots */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 6 }}>
              {/* Dot */}
              <button
                onClick={() => setStep(i)}
                style={{
                  width: 32, height: 32, borderRadius: 10, border: 'none',
                  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  ...(i === step ? {
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff',
                    boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                  } : i < step ? {
                    background: '#d4d0dc',
                    color: '#fff',
                  } : {
                    background: '#ebe7e2',
                    color: '#b0a9bc',
                  }),
                }}
              >
                {i < step ? '✓' : i + 1}
              </button>
              {/* Label */}
              <span style={{
                fontSize: 12, fontWeight: i === step ? 700 : 500,
                color: i === step ? '#1a1625' : '#b0a9bc',
                whiteSpace: 'nowrap',
                transition: 'color 0.2s ease',
              }}>
                {s.label}
              </span>
              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 2, borderRadius: 1, minWidth: 12,
                  background: i < step ? '#d4d0dc' : '#ebe7e2',
                  transition: 'background 0.3s ease',
                }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Main Content ═══ */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex',
        padding: 16, gap: 16,
        overflow: 'hidden',
      }}>
        {/* Camera */}
        {showCamera && (
          <div style={{
            width: '45%', flexShrink: 0,
          }}>
            <div style={{
              position: 'relative',
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 16, overflow: 'hidden',
              background: '#1a1625',
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            }}>
              <CameraFeed onImgRef={setImgEl} />
              {/* Trigger canvas (step 0 only) */}
              {step === 1 && <TriggerCanvas
                imgEl={imgEl}
                drawing={triggerDrawMode !== null}
                drawMode={triggerDrawMode}
                triggerRegion={selectedProduct?.trigger_region ?? null}
                searchRegion={selectedProduct?.trigger_search_region ?? null}
                onDrawComplete={(rect) => {
                  handleTriggerDrawComplete(rect)
                  setTriggerDrawMode(null)
                }}
              />}
              {/* ROI overlay editable (ROI step) */}
              {step === 2 && <ROICanvas imgEl={imgEl} rois={rois}
                editMode={editMode}
                onDrawComplete={handleDraw}
                onROIUpdate={handleROIUpdate}
                onEditModeExit={() => setEditMode(false)} />}
              {/* ROI overlay readonly (other steps except trigger) */}
              {step >= 3 && <ROICanvas imgEl={imgEl} rois={rois} readOnly
                results={step === 5 ? testResults : undefined} />}
            </div>
          </div>
        )}

        {/* Step content */}
        <div style={{
          flex: 1, minWidth: 0, overflow: 'auto',
          paddingRight: 4,
        }}>
          {/* Step title + description */}
          <div style={{ marginBottom: 16 }}>
            <h2 style={{
              fontSize: 20, fontWeight: 800, color: '#1a1625',
              letterSpacing: '-0.02em', marginBottom: 4,
            }}>
              {STEPS[step].label}
            </h2>
            <p style={{ fontSize: 13, color: '#9994a8' }}>
              {STEPS[step].desc}
            </p>
          </div>

          {/* Step-specific content */}
          {step === 0 && <BasicSettingsStep />}
          {step === 1 && <TriggerStep imgEl={imgEl}
            onStartDrawing={(mode) => setTriggerDrawMode(mode)}
            drawMode={triggerDrawMode} />}
          {step === 2 && <ROIStep editMode={editMode} onToggleEdit={() => setEditMode((m) => !m)} />}
          {step === 3 && <DatasetStepNew />}
          {step === 4 && <TrainingStepNew />}
          {step === 5 && <AssignStepNew onTestResults={(r) => setTestResults(r.map((x) => ({ roi_id: x.roi_id, judgment: x.judgment })))} />}
          {step === 6 && productId && (
            <PackingStep
              productId={productId}
              piecesPerBox={selectedProduct?.inspection_config?.pieces_per_box ?? 0}
              initialConfig={selectedProduct?.inspection_config?.packing}
            />
          )}
        </div>
      </div>

      {/* ═══ Bottom Nav ═══ */}
      <div style={{
        flexShrink: 0, padding: '12px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '1px solid #ebe7e2',
        background: '#faf9f7',
      }}>
        <button
          onClick={() => canGoBack && setStep(step - 1)}
          disabled={!canGoBack}
          style={{
            height: 38, padding: '0 24px',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            border: '1.5px solid #e0dcd7', borderRadius: 10,
            background: '#fff', color: canGoBack ? '#3d3654' : '#d4d0dc',
            cursor: canGoBack ? 'pointer' : 'default',
            boxShadow: canGoBack ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          ← 戻る
        </button>

        <button
          onClick={() => canGoNext && setStep(step + 1)}
          disabled={!canGoNext}
          style={{
            height: 38, padding: '0 28px',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            border: 'none', borderRadius: 10,
            background: canGoNext
              ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
              : '#ebe7e2',
            color: canGoNext ? '#fff' : '#b0a9bc',
            cursor: canGoNext ? 'pointer' : 'default',
            boxShadow: canGoNext
              ? '0 2px 8px rgba(99,102,241,0.3)'
              : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          次へ →
        </button>
      </div>
    </div>
  )
}


/* ================================================================
   TriggerCanvas — Draws trigger region overlay on camera feed
   ================================================================ */

function TriggerCanvas({ imgEl, drawing, drawMode, triggerRegion, searchRegion, onDrawComplete }: {
  imgEl: HTMLImageElement | null
  drawing: boolean
  drawMode: 'search' | 'template' | null
  triggerRegion: { x: number; y: number; w: number; h: number } | null
  searchRegion: { x: number; y: number; w: number; h: number } | null
  onDrawComplete: (rect: { x: number; y: number; w: number; h: number }) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const drawCurrentRef = useRef<{ x: number; y: number } | null>(null)

  const eventToNorm = useCallback((e: MouseEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }, [])

  // Resize & draw
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgEl) return
    const imgRect = imgEl.getBoundingClientRect()
    const parent = canvas.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    canvas.style.left = `${imgRect.left - parentRect.left}px`
    canvas.style.top = `${imgRect.top - parentRect.top}px`
    canvas.style.width = `${imgRect.width}px`
    canvas.style.height = `${imgRect.height}px`
    canvas.width = imgRect.width
    canvas.height = imgRect.height

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cw = canvas.width, ch = canvas.height
    ctx.clearRect(0, 0, cw, ch)

    // Search region (blue)
    if (searchRegion) {
      const { x, y, w, h } = searchRegion
      ctx.strokeStyle = '#6366f1'
      ctx.lineWidth = 2
      ctx.setLineDash([8, 4])
      ctx.strokeRect(x * cw, y * ch, w * cw, h * ch)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(99,102,241,0.05)'
      ctx.fillRect(x * cw, y * ch, w * cw, h * ch)
      // Label
      ctx.font = '600 10px DM Sans, sans-serif'
      ctx.fillStyle = '#6366f1'
      ctx.globalAlpha = 0.85
      const lbl = '検索エリア'
      ctx.fillRect(x * cw, y * ch - 16, ctx.measureText(lbl).width + 8, 16)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#fff'
      ctx.fillText(lbl, x * cw + 4, y * ch - 4)
    }

    // Trigger region (amber)
    if (triggerRegion) {
      const { x, y, w, h } = triggerRegion
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.strokeRect(x * cw, y * ch, w * cw, h * ch)
      ctx.fillStyle = 'rgba(245,158,11,0.08)'
      ctx.fillRect(x * cw, y * ch, w * cw, h * ch)
      ctx.font = '600 10px DM Sans, sans-serif'
      ctx.fillStyle = '#f59e0b'
      ctx.globalAlpha = 0.85
      const lbl2 = 'テンプレート'
      ctx.fillRect(x * cw, y * ch - 16, ctx.measureText(lbl2).width + 8, 16)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#fff'
      ctx.fillText(lbl2, x * cw + 4, y * ch - 4)
    }

    // Drawing in progress
    const s = drawStartRef.current, cc = drawCurrentRef.current
    if (s && cc) {
      const color = drawMode === 'search' ? '#6366f1' : '#f59e0b'
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.strokeRect(s.x * cw, s.y * ch, (cc.x - s.x) * cw, (cc.y - s.y) * ch)
      ctx.setLineDash([])
    }
  }, [imgEl, triggerRegion, searchRegion, drawMode])

  useEffect(() => {
    if (!imgEl) return
    redraw()
    const ro = new ResizeObserver(redraw)
    ro.observe(imgEl)
    return () => ro.disconnect()
  }, [imgEl, redraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !drawing) return

    const onDown = (e: MouseEvent) => {
      drawStartRef.current = eventToNorm(e)
      drawCurrentRef.current = drawStartRef.current
    }
    const onMove = (e: MouseEvent) => {
      if (!drawStartRef.current) return
      drawCurrentRef.current = eventToNorm(e)
      redraw()
    }
    const onUp = (e: MouseEvent) => {
      const s = drawStartRef.current
      if (!s) return
      const end = eventToNorm(e)
      drawStartRef.current = null
      drawCurrentRef.current = null

      const x = Math.min(s.x, end.x), y = Math.min(s.y, end.y)
      const w = Math.abs(end.x - s.x), h = Math.abs(end.y - s.y)
      if (w >= 0.02 && h >= 0.02) {
        onDrawComplete({ x, y, w, h })
      }
      redraw()
    }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseup', onUp)
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseup', onUp)
    }
  }, [drawing, eventToNorm, redraw, onDrawComplete])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        zIndex: 10,
        pointerEvents: drawing ? 'auto' : 'none',
        cursor: drawing ? 'crosshair' : 'default',
      }}
    />
  )
}
