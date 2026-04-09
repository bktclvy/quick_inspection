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

import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi } from '@/api/products'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ROICanvas } from '@/components/camera/ROICanvas'
import { Toast } from '@/components/layout/Toast'
import { ROIStep } from '@/components/steps/roi-step'
import { TemplateStepNew } from '@/components/steps/template-step'
import { DatasetStepNew } from '@/components/steps/dataset-step'
import { TrainingStepNew } from '@/components/steps/training-step'
import { AssignStepNew } from '@/components/steps/assign-step'

const STEPS = [
  { label: 'ROI設定',     desc: '検査領域を定義' },
  { label: 'テンプレート', desc: '基準画像を撮影' },
  { label: 'データ収集',   desc: 'OK/NG画像を収集' },
  { label: '学習',         desc: 'モデルを訓練' },
  { label: 'モデル割当',   desc: 'ROIにモデルを紐付け' },
] as const

interface Props {
  productName: string
}

export function SetupWizard({ productName }: Props) {
  const [step, setStep] = useState(0)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const [editMode, setEditMode] = useState(false)

  const rois = useAppStore((s) => s.rois)
  const productId = useAppStore((s) => s.selectedProductId)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

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

  const showCamera = step !== 3
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
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              position: 'relative', flex: 1, minHeight: 0,
              borderRadius: 16, overflow: 'hidden',
              background: '#0c1218',
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
              maxHeight: '100%',
            }}>
              <CameraFeed onImgRef={setImgEl} />
              <ROICanvas imgEl={imgEl} rois={rois}
                readOnly={step !== 0} editMode={editMode}
                onDrawComplete={handleDraw}
                onROIUpdate={handleROIUpdate}
                onEditModeExit={() => setEditMode(false)} />
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
          {step === 0 && <ROIStep editMode={editMode} onToggleEdit={() => setEditMode((m) => !m)} />}
          {step === 1 && <TemplateStepNew />}
          {step === 2 && <DatasetStepNew />}
          {step === 3 && <TrainingStepNew />}
          {step === 4 && <AssignStepNew />}
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
