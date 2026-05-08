/**
 * CalibrationWizard — 検査開始前のキャリブレーションフロー
 *
 * ステップはトリガーモードで可変:
 *   manual            → 背景 → テスト
 *   auto_background   → 背景 → テスト
 *   auto_template     → 背景 → 製品登録 → テスト
 *   ai                → テストのみ
 *
 * 各撮影ステップでは既存データを「そのまま使う」選択肢も出す。
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useCalibrationStore } from '@/stores/calibrationStore'
import type { CalibStepId } from '@/stores/calibrationStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { useAppStore } from '@/stores/appStore'
import { useWorkerStore } from '@/stores/workerStore'
import { productsApi } from '@/api/products'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { useKeyboard } from '@/hooks/useKeyboard'

const STEP_LABEL: Record<CalibStepId, string> = {
  worker: '作業者',
  bg: '背景',
  template: '製品登録',
  test: 'テスト',
}

export function CalibrationWizard() {
  const isOpen = useCalibrationStore((s) => s.isOpen)
  const productId = useCalibrationStore((s) => s.productId)
  const steps = useCalibrationStore((s) => s.steps)
  const step = useCalibrationStore((s) => s.currentStep)
  const close = useCalibrationStore((s) => s.close)

  const startInspection = useInspectionStore((s) => s.startInspection)
  const selectedWorkerId = useWorkerStore((s) => s.selectedWorkerId)

  const handleComplete = useCallback(() => {
    if (!productId) return
    close()
    startInspection(productId, selectedWorkerId)
  }, [productId, close, startInspection, selectedWorkerId])

  if (!isOpen || !productId) return null

  const currentId = steps[step]

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(26,22,37,0.6)',
      backdropFilter: 'blur(8px)',
      animation: 'calibFadeIn 0.3s ease',
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{
        width: '90vw', maxWidth: 1200, height: '85vh',
        background: '#faf9f7',
        borderRadius: 24,
        boxShadow: '0 24px 80px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        animation: 'calibPop 0.3s ease',
      }}>
        {/* Progress Header */}
        <ProgressHeader steps={steps} step={step} onClose={close} />

        {/* Content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: 20, gap: 20 }}>
          {/* Camera */}
          <div style={{
            width: '55%', flexShrink: 0,
            borderRadius: 16, overflow: 'hidden',
            background: '#1a1625',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            <CameraFeed />
            {currentId === 'template' && <TriggerOverlay />}
          </div>

          {/* Instructions */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {currentId === 'worker' && <WorkerStep />}
            {currentId === 'bg' && <BackgroundStep productId={productId} />}
            {currentId === 'template' && <ProductStep productId={productId} />}
            {currentId === 'test' && <TestStep onComplete={handleComplete} />}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes calibFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes calibPop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes calibSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes calibCheck { from { transform: scale(0); } to { transform: scale(1); } }
      `}</style>
    </div>,
    document.body,
  )
}

/* ── Progress Header ── */

function ProgressHeader({ steps, step, onClose }: { steps: CalibStepId[]; step: number; onClose: () => void }) {
  return (
    <div style={{
      padding: '20px 28px 16px',
      borderBottom: '1px solid #ebe7e2',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1625' }}>
        キャリブレーション
      </span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {steps.map((id, i) => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              transition: 'all 0.3s ease',
              ...(i === step ? {
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
              } : i < step ? {
                background: '#10b981', color: '#fff',
              } : {
                background: '#ebe7e2', color: '#b0a9bc',
              }),
            }}>
              {i < step ? '✓' : i + 1}
            </div>
            <span style={{
              fontSize: 13, fontWeight: i === step ? 700 : 500,
              color: i === step ? '#1a1625' : '#b0a9bc',
            }}>
              {STEP_LABEL[id]}
            </span>
            {i < steps.length - 1 && (
              <div style={{
                width: 40, height: 2, borderRadius: 1,
                background: i < step ? '#10b981' : '#ebe7e2',
                transition: 'background 0.3s ease',
              }} />
            )}
          </div>
        ))}
      </div>
      <button onClick={onClose} style={{
        width: 32, height: 32, borderRadius: 8,
        border: 'none', background: '#f0ede9', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#9994a8', fontSize: 16, fontWeight: 600,
      }}>
        ✕
      </button>
    </div>
  )
}

/* ── Step: Worker (作業者選択) ── */

function WorkerStep() {
  const workers          = useWorkerStore((s) => s.workers)
  const selectedWorkerId = useWorkerStore((s) => s.selectedWorkerId)
  const selectWorker     = useWorkerStore((s) => s.selectWorker)
  const loadWorkers      = useWorkerStore((s) => s.loadWorkers)
  const nextStep         = useCalibrationStore((s) => s.nextStep)
  const close            = useCalibrationStore((s) => s.close)
  const navigate         = useNavigate()

  useEffect(() => {
    loadWorkers().catch(() => {})
  }, [loadWorkers])

  const proceedable = !!selectedWorkerId && !!workers.find((w) => w.id === selectedWorkerId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', animation: 'calibSlideIn 0.3s ease' }}>
      <StepCard>
        <StepIcon color="#8b5cf6">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a8 8 0 0116 0v1" />
          </svg>
        </StepIcon>
        <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1a1625', margin: '16px 0 8px' }}>
          作業者の確認
        </h3>
        <p style={{ fontSize: 14, color: '#7c7494', lineHeight: 1.6, margin: 0 }}>
          今から検査を担当する人を選んでください。判定ログに記録され、統計画面で集計に使われます。
        </p>

        {workers.length === 0 ? (
          <div style={{
            marginTop: 20, padding: 20, borderRadius: 12,
            background: '#fef3c7', border: '1.5px solid #fcd34d',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>
              作業者がまだ登録されていません
            </div>
            <p style={{ fontSize: 12, color: '#78350f', margin: '0 0 14px', lineHeight: 1.6 }}>
              「設定」→「作業者マスタ」から追加してください。<br />
              一度ウィザードを閉じて、登録後に再開してください。
            </p>
            <button
              onClick={() => { close(); navigate('/settings') }}
              style={{
                height: 38, padding: '0 20px',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer',
                background: '#92400e',
              }}
            >
              設定画面へ移動
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {workers.map((w) => {
              const sel = selectedWorkerId === w.id
              return (
                <button
                  key={w.id}
                  onClick={() => selectWorker(w.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 14px',
                    background: sel ? 'linear-gradient(135deg, #f5f3ff, #ede9fe)' : '#ffffff',
                    border: sel ? '2px solid #6366f1' : '2px solid #ebe7e2',
                    borderRadius: 12,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease',
                    boxShadow: sel ? '0 2px 8px rgba(99,102,241,0.15)' : 'none',
                    textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: sel ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'linear-gradient(135deg, #c4b5fd, #a78bfa)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 800, color: '#fff', flexShrink: 0,
                  }}>
                    {w.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700,
                      color: sel ? '#1a1625' : '#3d3654',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {w.name}
                    </div>
                    {w.code && (
                      <div style={{
                        fontSize: 11, color: '#7c7494',
                        fontFamily: "'JetBrains Mono', monospace", marginTop: 2,
                      }}>
                        {w.code}
                      </div>
                    )}
                  </div>
                  {sel && (
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: '#6366f1', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, flexShrink: 0,
                    }}>✓</div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {selectedWorkerId && proceedable && (
          <p style={{ fontSize: 12, color: '#7c7494', marginTop: 16, fontStyle: 'italic' }}>
            選択は次回起動時に保存されます。
          </p>
        )}
      </StepCard>

      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', padding: '16px 0 0' }}>
        <PrimaryButton onClick={nextStep} disabled={!proceedable}>
          次へ →
        </PrimaryButton>
      </div>
    </div>
  )
}

/* ── Step: Background ── */

function BackgroundStep({ productId }: { productId: string }) {
  const bgCaptured       = useCalibrationStore((s) => s.bgCaptured)
  const bgCapturing      = useCalibrationStore((s) => s.bgCapturing)
  const bgAlreadyExists  = useCalibrationStore((s) => s.bgAlreadyExists)
  const bgUseExisting    = useCalibrationStore((s) => s.bgUseExisting)
  const capture          = useCalibrationStore((s) => s.captureBackground)
  const nextStep         = useCalibrationStore((s) => s.nextStep)

  const proceedable = bgCaptured || bgUseExisting
  const [_, setBump] = useBump() // 既存プレビューのキャッシュバスター

  // Space キーで撮影
  const onSpace = useCallback(async () => {
    if (bgCapturing) return
    await capture()
    setBump((v) => v + 1)
  }, [bgCapturing, capture, setBump])
  useKeyboard('Space', onSpace, true)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', animation: 'calibSlideIn 0.3s ease' }}>
      <StepCard>
        <StepIcon color="#6366f1">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 15l4-4 3 3 4-4 7 7" />
          </svg>
        </StepIcon>
        <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1a1625', margin: '16px 0 8px' }}>
          背景の登録
        </h3>
        <p style={{ fontSize: 14, color: '#7c7494', lineHeight: 1.6, margin: 0 }}>
          検査台に<strong>何も置かない状態</strong>で撮影します。製品の有無や取出し検知の基準になります。
          {bgAlreadyExists && '既に登録済みの場合は「既存のまま使う」で飛ばせます。'}
        </p>

        {/* 既存プレビュー (撮影前) */}
        {bgAlreadyExists && !bgCaptured && (
          <ExistingPreview
            title="登録済みの背景"
            src={`/api/products/${productId}/background?t=${Date.now()}`}
            selected={bgUseExisting}
          />
        )}

        {bgCaptured && (
          <StatusBadge
            text="新しい背景を登録しました"
            src={`/api/products/${productId}/background?t=${Date.now()}`}
          />
        )}
      </StepCard>

      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', padding: '16px 0 0', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* 再撮影: 既存があるときは「撮り直す」ラベル */}
          <SecondaryButton onClick={async () => { await capture(); setBump((v) => v + 1) }} disabled={bgCapturing}>
            {bgCapturing ? '撮影中…' : bgAlreadyExists || bgCaptured ? '撮り直す' : '撮影する'}
          </SecondaryButton>
        </div>
        <PrimaryButton onClick={nextStep} disabled={!proceedable || bgCapturing}>
          次へ →
        </PrimaryButton>
      </div>
    </div>
  )
}

/* ── Step: Product Registration (テンプレート) ── */

function ProductStep({ productId }: { productId: string }) {
  const templateCaptured      = useCalibrationStore((s) => s.templateCaptured)
  const templateCapturing     = useCalibrationStore((s) => s.templateCapturing)
  const templateAlreadyExists = useCalibrationStore((s) => s.templateAlreadyExists)
  const templateUseExisting   = useCalibrationStore((s) => s.templateUseExisting)
  const captureTemplate       = useCalibrationStore((s) => s.captureTemplate)
  const liveScore             = useCalibrationStore((s) => s.liveScore)
  const setLiveScore          = useCalibrationStore((s) => s.setLiveScore)
  const nextStep              = useCalibrationStore((s) => s.nextStep)
  const prevStep              = useCalibrationStore((s) => s.prevStep)

  const selectedProduct = useAppStore((s) => s.selectedProduct)
  const templateCount = selectedProduct?.trigger_template_count ?? 0
  const threshold = (selectedProduct?.inspection_config as Record<string, unknown>)?.match_threshold as number ?? 0.8

  // ライブスコアポーリング (既存利用中でもプレビュー用に動かす)
  useEffect(() => {
    if (templateCaptured) return
    let active = true
    const poll = async () => {
      while (active) {
        try {
          const scores = await productsApi.triggerScores(productId)
          if (active) setLiveScore(scores.trigger_score)
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    poll()
    return () => { active = false }
  }, [productId, templateCaptured, setLiveScore])

  const handleCapture = useCallback(() => {
    captureTemplate(templateCount)
  }, [captureTemplate, templateCount])

  // Space キーで撮影
  useKeyboard('Space', () => {
    if (templateCapturing) return
    handleCapture()
  }, true)

  const proceedable = templateCaptured || templateUseExisting
  const scoreColor = liveScore != null && liveScore >= threshold ? '#10b981' : '#f59e0b'
  const scorePct = liveScore != null ? Math.min(100, liveScore * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', animation: 'calibSlideIn 0.3s ease' }}>
      <StepCard>
        <StepIcon color="#f59e0b">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
          </svg>
        </StepIcon>
        <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1a1625', margin: '16px 0 8px' }}>
          製品テンプレートの登録
        </h3>
        <p style={{ fontSize: 14, color: '#7c7494', lineHeight: 1.6, margin: 0 }}>
          検査する製品を<strong>所定の位置</strong>に置きます。オレンジ枠がテンプレート領域です。
          {templateAlreadyExists && '前回と同じ配置なら「既存のまま使う」で飛ばせます。'}
        </p>

        {/* 既存プレビュー */}
        {templateAlreadyExists && !templateCaptured && (
          <ExistingPreview
            title={`登録済みのテンプレート（${templateCount}枚）`}
            src={`/api/products/${productId}/trigger-template?index=0&t=${Date.now()}`}
            selected={templateUseExisting}
          />
        )}

        {/* Live Score (閾値の参考表示) */}
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#7c7494' }}>現在のマッチスコア</span>
            <span style={{
              fontSize: 13, fontWeight: 700, color: scoreColor,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {liveScore != null ? (liveScore * 100).toFixed(0) + '%' : '--'}
            </span>
          </div>
          <div style={{ height: 8, background: '#ebe7e2', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: `${threshold * 100}%`, top: 0, bottom: 0,
              width: 2, background: '#9994a8', zIndex: 1,
            }} />
            <div style={{
              height: '100%', borderRadius: 4, background: scoreColor,
              width: `${scorePct}%`,
              transition: 'width 0.3s ease, background 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: 11, color: '#b0a9bc', marginTop: 4, textAlign: 'right' }}>
            閾値: {(threshold * 100).toFixed(0)}%
          </div>
        </div>

        {templateCaptured && (
          <StatusBadge
            text="新しいテンプレートを登録しました"
            src={`/api/products/${productId}/trigger-template?index=0&t=${Date.now()}`}
          />
        )}
      </StepCard>

      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', padding: '16px 0 0', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <SecondaryButton onClick={prevStep}>← 戻る</SecondaryButton>
          <SecondaryButton onClick={handleCapture} disabled={templateCapturing}>
            {templateCapturing ? '撮影中…' : templateAlreadyExists || templateCaptured ? '撮り直す' : '撮影する'}
          </SecondaryButton>
        </div>
        <PrimaryButton onClick={nextStep} disabled={!proceedable || templateCapturing}>
          次へ →
        </PrimaryButton>
      </div>
    </div>
  )
}

/* ── Step 3: Test Inspection ── */

function TestStep({ onComplete }: { onComplete: () => void }) {
  const testPhase = useCalibrationStore((s) => s.testPhase)
  const testResults = useCalibrationStore((s) => s.testResults)
  const testRunning = useCalibrationStore((s) => s.testRunning)
  const ngConfirmed = useCalibrationStore((s) => s.ngConfirmed)
  const runTest = useCalibrationStore((s) => s.runTest)
  const confirmTest = useCalibrationStore((s) => s.confirmTest)
  const retryTest = useCalibrationStore((s) => s.retryTest)
  const prevStep = useCalibrationStore((s) => s.prevStep)

  const isNgPhase = testPhase === 'ng'
  const isOkPhase = testPhase === 'ok'
  const isDone = testPhase === 'done'

  // Space キー: 結果が出ていなければ検査テスト、出ていれば次へ
  useKeyboard('Space', () => {
    if (isDone) { onComplete(); return }
    if (testRunning) return
    if (testResults) confirmTest()
    else runTest()
  }, true)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', animation: 'calibSlideIn 0.3s ease' }}>
      <StepCard>
        <StepIcon color={isNgPhase ? '#ef4444' : '#10b981'}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
        </StepIcon>

        {!isDone ? (
          <>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1a1625', margin: '16px 0 8px' }}>
              {isNgPhase ? 'NG品でテスト' : 'OK品でテスト'}
            </h3>
            <p style={{ fontSize: 14, color: '#7c7494', lineHeight: 1.6, margin: 0 }}>
              {isNgPhase
                ? '不良品（NG品）を置いて、正しく検出されるか確認してください。'
                : '良品（OK品）を置いて、正しく判定されるか確認してください。'}
            </p>

            {/* Progress dots */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <div style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: isNgPhase ? '#fef2f2' : '#f0fdf4',
                color: isNgPhase ? '#dc2626' : '#166534',
                border: `1.5px solid ${isNgPhase ? '#fca5a5' : '#bbf7d0'}`,
              }}>
                {ngConfirmed ? '✓ NG品確認済' : '① NG品テスト'}
              </div>
              <div style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: isOkPhase ? '#f0fdf4' : '#f7f5f2',
                color: isOkPhase ? '#166534' : '#b0a9bc',
                border: `1.5px solid ${isOkPhase ? '#bbf7d0' : '#ebe7e2'}`,
              }}>
                {isDone ? '✓ OK品確認済' : '② OK品テスト'}
              </div>
            </div>

            {/* Results */}
            {testResults && (
              <div style={{ marginTop: 16, animation: 'calibSlideIn 0.3s ease' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#9994a8', marginBottom: 8 }}>検査結果</div>
                {testResults.map((r) => (
                  <div key={r.roi_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: 10, marginBottom: 6,
                    background: '#fff', border: '1px solid #ebe7e2',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#3d3654' }}>{r.roi_name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700,
                        color: r.judgment === 'ok' ? '#10b981' : '#ef4444',
                      }}>
                        {r.judgment.toUpperCase()}
                      </span>
                      <span style={{
                        fontSize: 11, color: '#9994a8',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {(r.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <PrimaryButton onClick={confirmTest} style={{ flex: 1 }}>
                    結果OK、次へ
                  </PrimaryButton>
                  <SecondaryButton onClick={retryTest} style={{ flex: 1 }}>
                    やり直す
                  </SecondaryButton>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1a1625', margin: '16px 0 8px' }}>
              準備完了
            </h3>
            <p style={{ fontSize: 14, color: '#7c7494', lineHeight: 1.6, margin: 0 }}>
              キャリブレーションが完了しました。検査を開始できます。
            </p>
            <div style={{
              marginTop: 20, padding: 16, borderRadius: 12,
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              animation: 'calibSlideIn 0.3s ease',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <CheckItem label="背景登録" />
                <CheckItem label="製品テンプレート登録" />
                <CheckItem label="NG品テスト" />
                <CheckItem label="OK品テスト" />
              </div>
            </div>
          </>
        )}
      </StepCard>

      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', padding: '16px 0 0' }}>
        {!isDone ? (
          <>
            <SecondaryButton onClick={prevStep}>← 戻る</SecondaryButton>
            {!testResults && (
              <PrimaryButton onClick={runTest} disabled={testRunning}>
                {testRunning ? '検査中…' : '検査テスト'}
              </PrimaryButton>
            )}
          </>
        ) : (
          <>
            <div />
            <button onClick={onComplete} style={{
              height: 48, padding: '0 32px',
              fontSize: 15, fontWeight: 700,
              fontFamily: "'DM Sans', system-ui, sans-serif",
              color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer',
              background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
              boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
            }}>
              検査を開始する
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Trigger Region Overlay ── */

function TriggerOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectedProduct = useAppStore((s) => s.selectedProduct)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const draw = () => {
      const rect = parent.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const cw = canvas.width, ch = canvas.height
      ctx.clearRect(0, 0, cw, ch)

      // Search region (blue dashed)
      const sr = selectedProduct?.trigger_search_region
      if (sr) {
        ctx.strokeStyle = '#6366f1'
        ctx.lineWidth = 2
        ctx.setLineDash([8, 4])
        ctx.strokeRect(sr.x * cw, sr.y * ch, sr.w * cw, sr.h * ch)
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(99,102,241,0.05)'
        ctx.fillRect(sr.x * cw, sr.y * ch, sr.w * cw, sr.h * ch)
      }

      // Trigger region (amber)
      const tr = selectedProduct?.trigger_region
      if (tr) {
        ctx.strokeStyle = '#f59e0b'
        ctx.lineWidth = 2
        ctx.strokeRect(tr.x * cw, tr.y * ch, tr.w * cw, tr.h * ch)
        ctx.fillStyle = 'rgba(245,158,11,0.08)'
        ctx.fillRect(tr.x * cw, tr.y * ch, tr.w * cw, tr.h * ch)
        // Label
        ctx.font = '600 11px DM Sans, sans-serif'
        ctx.fillStyle = '#f59e0b'
        const lbl = 'テンプレート'
        const tw = ctx.measureText(lbl).width + 8
        ctx.globalAlpha = 0.85
        ctx.fillRect(tr.x * cw, tr.y * ch - 18, tw, 18)
        ctx.globalAlpha = 1
        ctx.fillStyle = '#fff'
        ctx.fillText(lbl, tr.x * cw + 4, tr.y * ch - 5)
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [selectedProduct])

  return (
    <canvas ref={canvasRef} style={{
      position: 'absolute', inset: 0,
      width: '100%', height: '100%',
      pointerEvents: 'none',
    }} />
  )
}

/* ── Shared Components ── */

function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 16, padding: 24,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)',
    }}>
      {children}
    </div>
  )
}

function StepIcon({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      width: 56, height: 56, borderRadius: 14,
      background: `${color}12`,
      color, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </div>
  )
}

function CheckItem({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', background: '#10b981',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 10,
      }}>✓</div>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>{label}</span>
    </div>
  )
}

function PrimaryButton({ onClick, disabled, children, style }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      height: 44, padding: '0 24px',
      fontSize: 14, fontWeight: 700,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: '#fff', border: 'none', borderRadius: 12, cursor: disabled ? 'default' : 'pointer',
      background: disabled ? '#d4d0dc' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      boxShadow: disabled ? 'none' : '0 2px 8px rgba(99,102,241,0.3)',
      opacity: disabled ? 0.7 : 1,
      transition: 'all 0.2s ease',
      ...style,
    }}>
      {children}
    </button>
  )
}

function SecondaryButton({ onClick, disabled, children, style }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      height: 44, padding: '0 20px',
      fontSize: 14, fontWeight: 600,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: disabled ? '#b0a9bc' : '#5c5470', background: '#fff',
      border: '1.5px solid #e0dcd7', borderRadius: 12,
      cursor: disabled ? 'default' : 'pointer',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      opacity: disabled ? 0.7 : 1,
      ...style,
    }}>
      {children}
    </button>
  )
}

/* ── Existing data preview (既存を使う / 撮り直す) ── */

function ExistingPreview({ title, src, selected }: {
  title: string; src: string; selected: boolean
}) {
  return (
    <div style={{
      marginTop: 20, padding: 14, borderRadius: 12,
      background: selected ? '#f5f3ff' : '#faf9f7',
      border: `1.5px solid ${selected ? '#a5b4fc' : '#ebe7e2'}`,
      display: 'flex', alignItems: 'center', gap: 14,
      transition: 'all 0.2s ease',
    }}>
      <div style={{
        width: 100, height: 75, borderRadius: 8, overflow: 'hidden',
        border: '1.5px solid #e0dcd7', flexShrink: 0, background: '#1a1625',
      }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1625', marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: '#7c7494', lineHeight: 1.5 }}>
          そのまま使う場合は「次へ」を押してください。撮り直したい場合は下のボタンで再撮影できます。
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ text, src }: { text: string; src: string }) {
  return (
    <div style={{
      marginTop: 20, padding: 16, borderRadius: 12,
      background: '#f0fdf4', border: '1px solid #bbf7d0',
      display: 'flex', alignItems: 'center', gap: 12,
      animation: 'calibSlideIn 0.3s ease',
    }}>
      <div style={{
        width: 80, height: 60, borderRadius: 8, overflow: 'hidden',
        border: '2px solid #10b981',
      }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 20, height: 20, borderRadius: '50%', background: '#10b981',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 12, animation: 'calibCheck 0.3s ease',
          }}>✓</div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>{text}</span>
        </div>
      </div>
    </div>
  )
}

function useBump() {
  return useState(0)
}
