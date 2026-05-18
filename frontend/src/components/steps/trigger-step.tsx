/**
 * Trigger Step — trigger_mode によって UI を切り替える。
 *
 * - auto:   検索エリア / テンプレート / 背景 / 検知パラメータ
 * - ai:     不安定合成 / 一括再学習 / 背景 / 検知パラメータ
 * - manual: 背景 / 表示時間のみ
 */

import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { productsApi, type AITriggerStatus, type AITriggerROIStatus,
         type TriggerCaptureState, type TriggerCaptureCounts } from '@/api/products'
import { useTrainingStore } from '@/stores/trainingStore'
import { useTrainingWS } from '@/hooks/useTrainingWS'
import { Toast } from '@/components/layout/Toast'
import { api } from '@/api/client'
import { UnstablePreviewModal } from '@/components/steps/unstable-preview-modal'
import type { InspectionConfig } from '@/types'

export type TriggerDrawMode = 'search' | 'template' | null

interface Props {
  imgEl: HTMLImageElement | null
  onStartDrawing: (mode: TriggerDrawMode) => void
  drawMode: TriggerDrawMode
}

const DEFAULT_PATTERNS = ['bg_patch', 'skin_blob', 'motion_blur']
const PATTERN_LABELS: Record<string, string> = {
  bg_patch: '背景パッチ',
  skin_blob: '肌色ブロブ',
  motion_blur: 'モーションブラー',
  cutout: 'CutOut',
}

export function TriggerStep({ onStartDrawing, drawMode }: Props) {
  const productId = useAppStore((s) => s.selectedProductId)
  const selectedProduct = useAppStore((s) => s.selectedProduct)
  const refreshROIs = useAppStore((s) => s.refreshROIs)

  const [searchRegion, setSearchRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [templateCount, setTemplateCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  const [config, setConfig] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (!productId) return
    productsApi.getConfig(productId).then((c) => setConfig(c as unknown as Record<string, unknown>)).catch(() => {})
  }, [productId])

  const saveConfig = useCallback(async (updates: Record<string, unknown>) => {
    if (!productId) return
    const merged = { ...config, ...updates }
    setConfig(merged)
    try {
      await productsApi.saveConfig(productId, merged as Partial<InspectionConfig>)
      // appStore の selectedProduct も更新しておかないと、直後に検査開始すると
      // 古い inspection_config (trigger_mode 等) で calibration が開いてしまう
      await refreshROIs()
    } catch { Toast.error('保存に失敗しました') }
  }, [productId, config, refreshROIs])

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

  // ─── AI トリガー専用 state ──────────────────────────────
  const [aiStatus, setAiStatus] = useState<AITriggerStatus | null>(null)
  const [synthPatterns, setSynthPatterns] = useState<string[]>(DEFAULT_PATTERNS)
  const [countMultiplier, setCountMultiplier] = useState(1.0)
  const [synthBusyRoi, setSynthBusyRoi] = useState<string | null>(null)
  const [previewRoi, setPreviewRoi] = useState<{ id: string; name: string } | null>(null)

  // 撮影 (Space キー で 1 枚キャプチャ)
  const [activeCapture, setActiveCapture] = useState<TriggerCaptureState | null>(null)
  const [captureCounts, setCaptureCounts] = useState<TriggerCaptureCounts>({
    present: 0, absent: 0, obstructed: 0,
  })
  const [capturing, setCapturing] = useState(false)

  const refreshAIStatus = useCallback(async () => {
    if (!productId) return
    try {
      const s = await productsApi.aiTriggerStatus(productId)
      setAiStatus(s)
    } catch { /* ignore */ }
  }, [productId])

  useEffect(() => {
    if (triggerMode === 'ai') refreshAIStatus()
  }, [productId, triggerMode, refreshAIStatus])

  // ステータスから撮影枚数を反映
  useEffect(() => {
    if (aiStatus?.captures) setCaptureCounts(aiStatus.captures)
  }, [aiStatus])

  // アクティブな撮影状態のとき Space キーで 1 枚キャプチャ
  useEffect(() => {
    if (!activeCapture || !productId) return
    const onKey = async (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      if (capturing) return
      setCapturing(true)
      try {
        const r = await productsApi.captureTriggerFrame(productId, activeCapture)
        setCaptureCounts(r.counts)
      } catch {
        Toast.error('撮影に失敗しました')
      } finally {
        setCapturing(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeCapture, productId, capturing])

  const clearCaptures = async (state?: TriggerCaptureState) => {
    if (!productId) return
    const label = state === 'present' ? '製品あり'
      : state === 'absent' ? '製品なし'
      : state === 'obstructed' ? '手映り'
      : '全状態'
    if (!confirm(`${label} の撮影画像を削除します。よろしいですか？`)) return
    try {
      const r = await productsApi.clearTriggerCaptures(productId, state)
      setCaptureCounts(r.counts)
    } catch { Toast.error('削除に失敗しました') }
  }

  // AIモード時のみ training WS を購読
  useTrainingWS(triggerMode === 'ai')
  const trainingRunning = useTrainingStore((s) => s.isRunning)
  const trainingStatusText = useTrainingStore((s) => s.statusText)
  const trainingEpoch = useTrainingStore((s) => s.epoch)
  const trainingTotalEpochs = useTrainingStore((s) => s.totalEpochs)
  const trainingValAcc = useTrainingStore((s) => s.valAccuracy)

  useEffect(() => {
    if (triggerMode !== 'ai') return
    // トリガーモデル学習が終わったら状態を更新 (撮影画像は自動削除されているはず)
    if (trainingStatusText === 'trigger_complete'
        || trainingStatusText === 'trigger_stopped'
        || trainingStatusText.startsWith('trigger_error')) {
      if (trainingStatusText === 'trigger_complete') {
        setActiveCapture(null)
        setCaptureCounts({ present: 0, absent: 0, obstructed: 0 })
      }
      refreshAIStatus()
    }
  }, [trainingStatusText, triggerMode, refreshAIStatus])

  const togglePattern = (key: string) => {
    setSynthPatterns((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])
  }

  const runSynth = async (roiId: 'all' | string) => {
    if (!productId || !aiStatus) return
    if (synthPatterns.length === 0) {
      Toast.error('合成パターンを 1 つ以上選んでください')
      return
    }
    const targets = roiId === 'all' ? aiStatus.rois : aiStatus.rois.filter((r) => r.roi_id === roiId)
    let successCount = 0
    for (const roi of targets) {
      if (roi.source_count === 0) {
        Toast.error(`${roi.roi_name}: OK/NG画像がありません`)
        continue
      }
      setSynthBusyRoi(roi.roi_id)
      try {
        const res = await productsApi.synthesizeUnstable(productId, roi.roi_id, {
          patterns: synthPatterns,
          count_multiplier: countMultiplier,
        })
        successCount++
        if (res.errors && res.errors.length > 0) {
          console.warn(`${roi.roi_name}: ${res.errors.join(', ')}`)
        }
      } catch {
        Toast.error(`${roi.roi_name}: 合成に失敗しました`)
      }
    }
    setSynthBusyRoi(null)
    await refreshAIStatus()
    if (successCount > 0) Toast.success(`${successCount} ROIで不安定サンプルを生成`)
  }

  const deleteSynth = async (roiId: string, roiName: string) => {
    if (!productId) return
    if (!confirm(`${roiName} の合成データを削除します。よろしいですか？`)) return
    try {
      await productsApi.deleteUnstable(productId, roiId)
      await refreshAIStatus()
      Toast.success('削除しました')
    } catch { Toast.error('削除に失敗しました') }
  }

  const startTrainTrigger = async () => {
    if (!productId) return
    try {
      await productsApi.trainTriggerModel(productId, {})
      Toast.success('AI トリガーモデルの学習を開始しました')
    } catch (e) {
      const msg = (e as Error).message || ''
      Toast.error(msg || '学習開始に失敗しました')
    }
  }

  const stopTrainTrigger = async () => {
    if (!productId) return
    try { await productsApi.stopTriggerTraining(productId) } catch { /* ignore */ }
  }

  const deleteTriggerModel = async () => {
    if (!productId) return
    if (!confirm('トリガーモデルを削除します。もう一度学習が必要になります。')) return
    try {
      await productsApi.deleteTriggerModel(productId)
      await refreshAIStatus()
      Toast.success('削除しました')
    } catch { Toast.error('削除に失敗しました') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Trigger Mode ── */}
      <Panel title="検査トリガー">
        <div style={{ display: 'flex', gap: 12 }}>
          {([
            { value: 'auto', label: '自動', desc: 'テンプレートマッチングで検知' },
            { value: 'ai', label: 'AI', desc: '専用モデルで「製品が見える」状態を高速判定' },
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

      {/* ── AUTO MODE ─────────────────────────────────── */}
      {triggerMode === 'auto' && (
        <>
          <Panel title="① 検索エリア" accent="#6366f1">
            <p style={hint}>毎フレーム監視する範囲をカメラ上で指定してください。</p>
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

          <Panel title="② テンプレート" accent="#f59e0b">
            <p style={hint}>製品の特徴的な部分をカメラ上で矩形選択してください。複数登録可能です。</p>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {Array.from({ length: templateCount }, (_, i) => (
                  <div key={`t-${i}-${refreshKey}`} style={{
                    position: 'relative', borderRadius: 10, overflow: 'hidden',
                    border: '1px solid #fef3c7', background: '#fffbeb',
                    aspectRatio: '4/3',
                  }}>
                    <img src={`/api/products/${productId}/trigger-template?index=${i}&t=${refreshKey}`}
                      alt={`#${i + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
        </>
      )}

      {/* ── AI MODE ─────────────────────────────────── */}
      {triggerMode === 'ai' && (
        <>
          <Panel title="① 撮影 (AI トリガー専用)" accent="#0ea5e9">
            <p style={hint}>
              「製品あり」「製品なし」「手映り」の状態をその場で撮影します。
              開始ボタンで状態をアクティブにして、<b>Space キーで 1 枚ずつ</b>追加してください。
              学習が成功すると撮影画像は自動削除されます (一時データ)。
            </p>
            <CaptureRow label="製品あり" sub="良品も傷あり品も置いて、角度を変えながら"
              state="present" active={activeCapture} count={captureCounts.present}
              capturing={capturing}
              onToggle={() => setActiveCapture(activeCapture === 'present' ? null : 'present')}
              onClear={() => clearCaptures('present')} />
            <CaptureRow label="製品なし" sub="何も置かない状態 (背景だけ見えてる)"
              state="absent" active={activeCapture} count={captureCounts.absent}
              capturing={capturing}
              onToggle={() => setActiveCapture(activeCapture === 'absent' ? null : 'absent')}
              onClear={() => clearCaptures('absent')} />
            <CaptureRow label="手映り (任意)" sub="作業者の手や袋などが映り込んだ状態"
              state="obstructed" active={activeCapture} count={captureCounts.obstructed}
              capturing={capturing}
              onToggle={() => setActiveCapture(activeCapture === 'obstructed' ? null : 'obstructed')}
              onClear={() => clearCaptures('obstructed')} />
            {activeCapture && (
              <div style={{
                marginTop: 10, padding: '8px 12px',
                background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 8,
                fontSize: 12, color: '#155e75', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 4, background: '#0ea5e9',
                  animation: 'pulse 1.2s ease infinite',
                }} />
                Space キー で 1 枚撮影します ({activeCapture === 'present' ? '製品あり'
                  : activeCapture === 'absent' ? '製品なし' : '手映り'})
              </div>
            )}
          </Panel>

          <Panel title="② 不安定サンプルを合成 (補助)" accent="#a855f7">
            <p style={hint}>
              各ROIの OK/NG 画像に障害物・遮蔽・ブラーを合成し、専用トリガーモデルが
              「製品が見えない／隠れた／ブレた」状態を判別できるようにする学習データを作ります。
            </p>

            {!aiStatus ? (
              <p style={{ fontSize: 12, color: '#9994a8', padding: '8px 0' }}>読込中...</p>
            ) : aiStatus.rois.length === 0 ? (
              <p style={{ fontSize: 13, color: '#9994a8' }}>先に ROI を作成してください。</p>
            ) : (
              <>
                <ROITable
                  status={aiStatus}
                  synthBusyRoi={synthBusyRoi}
                  onSynthOne={(roiId) => runSynth(roiId)}
                  onPreview={(roi) => setPreviewRoi({ id: roi.roi_id, name: roi.roi_name })}
                  onDelete={(roi) => deleteSynth(roi.roi_id, roi.roi_name)}
                />

                <div style={{
                  marginTop: 14, padding: 12,
                  background: '#faf9ff', borderRadius: 10, border: '1px solid #ede9fe',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7c7494',
                                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    合成パターン
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {Object.entries(PATTERN_LABELS).map(([k, label]) => (
                      <label key={k} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', borderRadius: 8,
                        background: synthPatterns.includes(k) ? '#ede9fe' : '#fff',
                        border: synthPatterns.includes(k) ? '1.5px solid #a855f7' : '1.5px solid #e8e4df',
                        cursor: 'pointer',
                        fontSize: 12, fontWeight: 600,
                        color: synthPatterns.includes(k) ? '#6b21a8' : '#5c5470',
                      }}>
                        <input type="checkbox"
                          checked={synthPatterns.includes(k)}
                          onChange={() => togglePattern(k)}
                          style={{ accentColor: '#a855f7' }} />
                        {label}
                      </label>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#9994a8' }}>枚数倍率</span>
                    {[0.5, 1.0, 2.0].map((m) => (
                      <button key={m}
                        onClick={() => setCountMultiplier(m)}
                        style={{
                          padding: '4px 12px', fontSize: 12, fontWeight: 600,
                          borderRadius: 8, cursor: 'pointer',
                          background: countMultiplier === m ? '#a855f7' : '#fff',
                          color: countMultiplier === m ? '#fff' : '#5c5470',
                          border: countMultiplier === m ? 'none' : '1.5px solid #e8e4df',
                        }}>{m.toFixed(1)}×</button>
                    ))}
                    <span style={{ fontSize: 11, color: '#9994a8' }}>OK+NG合計の {countMultiplier.toFixed(1)} 倍を生成</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => runSynth('all')}
                    disabled={synthBusyRoi !== null}
                    style={primaryBtn(synthBusyRoi !== null)}>
                    {synthBusyRoi !== null ? '生成中…' : 'すべてのROIで生成'}
                  </button>
                </div>
              </>
            )}
          </Panel>

          <Panel title="③ AI トリガーモデルを学習" accent="#ec4899">
            <p style={hint}>
              合成サンプルを使って、判定モデルとは別の専用トリガーモデルを学習します。
              判定モデルは触らず、軽量な MobileNetV2 で「製品が見えてるか」だけを毎フレーム判定します。
            </p>

            {aiStatus && (
              <TriggerModelStatusCard
                status={aiStatus}
                trainingRunning={trainingRunning}
                trainingEpoch={trainingEpoch}
                trainingTotalEpochs={trainingTotalEpochs}
                trainingValAcc={trainingValAcc}
              />
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              {trainingRunning ? (
                <button onClick={stopTrainTrigger} style={primaryBtn(false, '#dc2626')}>
                  停止
                </button>
              ) : (
                <button onClick={startTrainTrigger}
                  disabled={!aiStatus || aiStatus.rois.length === 0}
                  style={primaryBtn(!aiStatus || aiStatus.rois.length === 0, '#ec4899')}>
                  {aiStatus?.trigger_model.exists ? '再学習' : 'AI トリガーモデルを学習'}
                </button>
              )}
              {aiStatus?.trigger_model.exists && !trainingRunning && (
                <button onClick={deleteTriggerModel}
                  style={{ ...primaryBtn(false), background: '#fff', color: '#dc2626',
                           border: '1.5px solid #fecaca', boxShadow: 'none' }}>
                  モデルを削除
                </button>
              )}
              <span style={{ fontSize: 11, color: '#9994a8', alignSelf: 'center' }}>
                MobileNetV2 固定 / 入力 96×96 / 約 30 秒〜2 分
              </span>
            </div>
          </Panel>
        </>
      )}

      {/* ── 背景 (auto / ai / manual 共通) ── */}
      <Panel title="③ 背景（取出し検知用）" accent="#10b981">
        <p style={hint}>製品を置かない状態で撮影してください。取出し検知に使用します。</p>
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
          }}>{hasBg ? '再撮影' : '背景を撮影'}</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: hasBg ? '#059669' : '#b0a9bc' }}>
            {hasBg ? '✓ 撮影済み' : '未撮影'}
          </span>
        </div>
        {hasBg && productId && (
          <img src={`/api/products/${productId}/background?t=${refreshKey}`} alt="背景"
            style={{
              width: '100%', maxHeight: 200,
              objectFit: 'contain', borderRadius: 10,
              border: '1px solid #d1fae5', background: '#f0fdf4',
            }} />
        )}
      </Panel>

      {/* ── 検知パラメータ ── */}
      <Panel title="④ 検知パラメータ">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          {triggerMode === 'auto' && (
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
          )}
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
          {triggerMode !== 'manual' && (
            <div>
              <label style={paramLabel}>トリガーフレーム数</label>
              <input
                key={config.trigger_frames as number ?? 3}
                type="number" min={1} max={30}
                defaultValue={config.trigger_frames as number ?? 3}
                onBlur={(e) => { const n = parseInt(e.target.value, 10); saveConfig({ trigger_frames: isNaN(n) ? 3 : Math.max(1, Math.min(30, n)) }) }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                style={numInput} />
            </div>
          )}
          <div>
            <label style={paramLabel}>安定フレーム数</label>
            <input
              key={config.stability_frames as number ?? 8}
              type="number" min={1} max={30}
              defaultValue={config.stability_frames as number ?? 8}
              onBlur={(e) => { const n = parseInt(e.target.value, 10); saveConfig({ stability_frames: isNaN(n) ? 8 : Math.max(1, Math.min(30, n)) }) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
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
            <input
              key={config.removal_frames as number ?? 3}
              type="number" min={1} max={30}
              defaultValue={config.removal_frames as number ?? 3}
              onBlur={(e) => { const n = parseInt(e.target.value, 10); saveConfig({ removal_frames: isNaN(n) ? 3 : Math.max(1, Math.min(30, n)) }) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              style={numInput} />
          </div>
        </div>

        {triggerMode === 'auto' && (
          <>
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
              }}>{showLive ? '⏹ モニター停止' : '▶ リアルタイムモニター'}</button>
            </div>

            {showLive && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ScoreBar label="製品検知" score={liveScores.trigger_score}
                  threshold={config.match_threshold as number ?? 0.8} color="#f59e0b" />
                <ScoreBar label="背景一致" score={liveScores.bg_score}
                  threshold={config.removal_bg_threshold as number ?? 0.85} color="#10b981" />
              </div>
            )}
          </>
        )}
      </Panel>

      {previewRoi && productId && (
        <UnstablePreviewModal
          productId={productId}
          roiId={previewRoi.id}
          roiName={previewRoi.name}
          onClose={() => setPreviewRoi(null)}
        />
      )}
    </div>
  )
}

// ─── ROI テーブル（合成ステータス） ───────────────────────────

function ROITable({ status, synthBusyRoi, onSynthOne, onPreview, onDelete }: {
  status: AITriggerStatus
  synthBusyRoi: string | null
  onSynthOne: (roiId: string) => void
  onPreview: (roi: AITriggerROIStatus) => void
  onDelete: (roi: AITriggerROIStatus) => void
}) {
  return (
    <div style={{
      border: '1px solid #ede9fe', borderRadius: 10, overflow: 'hidden',
      fontSize: 12,
    }}>
      <div style={tableHeader}>
        <div style={{ flex: 2 }}>ROI</div>
        <div style={{ flex: 1, textAlign: 'right' }}>OK+NG</div>
        <div style={{ flex: 1, textAlign: 'right' }}>合成</div>
        <div style={{ flex: 2 }}>最終生成</div>
        <div style={{ width: 200 }}>操作</div>
      </div>
      {status.rois.map((roi) => {
        const isBusy = synthBusyRoi === roi.roi_id
        const hasSynth = roi.unstable.synth_count > 0
        return (
          <div key={roi.roi_id} style={tableRow}>
            <div style={{ flex: 2, fontWeight: 600, color: '#3d3654' }}>{roi.roi_name}</div>
            <div style={{ flex: 1, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace",
                          color: roi.source_count === 0 ? '#dc2626' : '#5c5470' }}>
              {roi.source_count}
            </div>
            <div style={{ flex: 1, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace",
                          color: hasSynth ? '#059669' : '#9994a8', fontWeight: hasSynth ? 700 : 400 }}>
              {hasSynth ? roi.unstable.synth_count : '—'}
            </div>
            <div style={{ flex: 2, fontSize: 11, color: '#9994a8' }}>
              {roi.unstable.meta?.generated_at ?? '未生成'}
            </div>
            <div style={{ width: 200, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button onClick={() => onSynthOne(roi.roi_id)} disabled={isBusy || roi.source_count === 0}
                style={miniBtn}>{isBusy ? '...' : '生成'}</button>
              <button onClick={() => onPreview(roi)} disabled={!hasSynth} style={miniBtn}>プレビュー</button>
              <button onClick={() => onDelete(roi)} disabled={!hasSynth}
                style={{ ...miniBtn, color: hasSynth ? '#dc2626' : '#ccc8d4' }}>削除</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CaptureRow({ label, sub, state, active, count, capturing, onToggle, onClear }: {
  label: string
  sub: string
  state: TriggerCaptureState
  active: TriggerCaptureState | null
  count: number
  capturing: boolean
  onToggle: () => void
  onClear: () => void
}) {
  const isActive = active === state
  const hasOther = active !== null && active !== state
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', marginBottom: 8,
      borderRadius: 10,
      background: isActive ? '#ecfeff' : '#fff',
      border: isActive ? '1.5px solid #0ea5e9' : '1.5px solid #e8e4df',
      transition: 'all 0.15s ease',
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: 5,
        background: isActive ? '#0ea5e9' : count > 0 ? '#10b981' : '#cbcbcb',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3d3654' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#9994a8', marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 18, fontWeight: 700, color: count > 0 ? '#0c4a6e' : '#9994a8',
        minWidth: 56, textAlign: 'right',
      }}>
        {count}<span style={{ fontSize: 10, color: '#9994a8' }}> 枚</span>
        {isActive && capturing && (
          <span style={{ marginLeft: 6, fontSize: 10, color: '#0ea5e9' }}>●</span>
        )}
      </div>
      <button onClick={onToggle}
        disabled={hasOther}
        style={{
          height: 32, padding: '0 14px',
          fontSize: 12, fontWeight: 700,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          borderRadius: 8, cursor: hasOther ? 'not-allowed' : 'pointer',
          background: isActive ? '#dc2626' : hasOther ? '#f0ede9' : '#0ea5e9',
          color: hasOther ? '#ccc8d4' : '#fff',
          border: 'none',
        }}>
        {isActive ? '停止' : '開始'}
      </button>
      <button onClick={onClear}
        disabled={count === 0}
        style={{
          height: 32, padding: '0 10px',
          fontSize: 11, fontWeight: 600,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          borderRadius: 8, cursor: count === 0 ? 'not-allowed' : 'pointer',
          background: '#fff', color: count === 0 ? '#ccc8d4' : '#dc2626',
          border: '1.5px solid', borderColor: count === 0 ? '#f0ede9' : '#fecaca',
        }}>
        削除
      </button>
    </div>
  )
}


function TriggerModelStatusCard({ status, trainingRunning, trainingEpoch, trainingTotalEpochs, trainingValAcc }: {
  status: AITriggerStatus
  trainingRunning: boolean
  trainingEpoch: number
  trainingTotalEpochs: number
  trainingValAcc: number | null
}) {
  const tm = status.trigger_model
  const okSrc = status.rois.reduce((sum, r) => sum + r.source_count, 0)
  const synthSum = status.rois.reduce((sum, r) => sum + r.unstable.synth_count + r.unstable.manual_count, 0)
  const cap = status.captures
  const totalPresent = okSrc + cap.present
  const totalUnstable = synthSum + cap.absent + cap.obstructed

  return (
    <div style={{
      border: '1px solid #fce7f3', borderRadius: 10, overflow: 'hidden',
      background: tm.exists ? '#fdf2f8' : '#faf9f7',
    }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 12, height: 12, borderRadius: 6,
          background: trainingRunning ? '#f59e0b'
            : tm.exists ? '#10b981' : '#cbcbcb',
          flexShrink: 0,
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3d3654' }}>
            {trainingRunning ? '学習中...'
              : tm.exists ? '学習済'
              : '未学習'}
          </div>
          <div style={{ fontSize: 11, color: '#9994a8', marginTop: 2 }}>
            {trainingRunning
              ? (trainingEpoch > 0
                  ? `epoch ${trainingEpoch}/${trainingTotalEpochs}` + (trainingValAcc != null ? ` — val_acc ${(trainingValAcc * 100).toFixed(1)}%` : '')
                  : 'データを読み込んでいます...')
              : tm.trained_at
              ? `最終学習: ${tm.trained_at}`
              : '学習データを用意して下のボタンを押してください'}
          </div>
        </div>
        {tm.meta && !trainingRunning && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700, color: '#059669' }}>
              {(tm.meta.best_val_accuracy * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: 10, color: '#9994a8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              val_acc
            </div>
          </div>
        )}
      </div>
      <div style={{
        display: 'flex', borderTop: '1px solid #fce7f3',
        background: '#fff',
      }}>
        <div style={statCell}>
          <div style={statLabel}>present 合計</div>
          <div style={{ ...statValue, color: totalPresent === 0 ? '#dc2626' : '#3d3654' }}>
            {totalPresent}
          </div>
          <div style={{ fontSize: 10, color: '#9994a8', marginTop: 2 }}>
            撮影 {cap.present} + OK {okSrc}
          </div>
        </div>
        <div style={statCell}>
          <div style={statLabel}>unstable 合計</div>
          <div style={{ ...statValue, color: totalUnstable === 0 ? '#dc2626' : '#3d3654' }}>
            {totalUnstable}
          </div>
          <div style={{ fontSize: 10, color: '#9994a8', marginTop: 2 }}>
            撮影 {cap.absent + cap.obstructed} + 合成 {synthSum}
          </div>
        </div>
        <div style={statCell}>
          <div style={statLabel}>バックボーン</div>
          <div style={{ ...statValue, fontSize: 12 }}>MobileNetV2</div>
        </div>
        <div style={statCell}>
          <div style={statLabel}>入力サイズ</div>
          <div style={{ ...statValue, fontSize: 12 }}>96×96</div>
        </div>
      </div>
    </div>
  )
}

const statCell: React.CSSProperties = {
  flex: 1, padding: '10px 14px',
  borderRight: '1px solid #f7f5fb',
}

const statLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#9994a8',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  marginBottom: 4,
}

const statValue: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 16, fontWeight: 700, color: '#3d3654',
  fontVariantNumeric: 'tabular-nums',
}

// ─── サポート部品 ──────────────────────────────────────────────

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
        <div style={{
          position: 'absolute', top: -2, bottom: -2,
          left: `${threshold * 100}%`, width: 2,
          background: '#1a1625', borderRadius: 1,
        }} />
      </div>
    </div>
  )
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

// ─── スタイル ──────────────────────────────────────────────

const hint: React.CSSProperties = {
  fontSize: 13, color: '#9994a8', marginBottom: 12, lineHeight: 1.6,
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

const miniBtn: React.CSSProperties = {
  height: 26, padding: '0 8px', fontSize: 11, fontWeight: 600,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#5c5470', background: '#fff',
  border: '1.5px solid #e0dcd7', borderRadius: 6, cursor: 'pointer',
}

const thumbDelete: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 22, height: 22, borderRadius: 6,
  background: 'rgba(0,0,0,0.5)', border: 'none',
  color: '#fff', fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const tableHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '8px 14px', background: '#faf9ff',
  fontSize: 10, fontWeight: 700, color: '#9994a8',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: '1px solid #ede9fe',
}

const tableRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 14px', background: '#fff',
  borderBottom: '1px solid #f7f5fb',
}

function primaryBtn(disabled: boolean, color = '#a855f7'): React.CSSProperties {
  return {
    height: 38, padding: '0 18px',
    fontSize: 13, fontWeight: 600,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    color: disabled ? '#ccc8d4' : '#fff',
    background: disabled ? '#f0ede9' : color,
    border: 'none', borderRadius: 10,
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : `0 2px 8px ${color}40`,
  }
}
