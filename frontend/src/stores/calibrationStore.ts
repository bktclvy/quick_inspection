import { create } from 'zustand'
import { productsApi } from '../api/products'
import { Toast } from '../components/layout/Toast'
import type { TriggerMode } from '../types'

export type CalibStepId = 'worker' | 'bg' | 'template' | 'test'

interface CalibrationState {
  isOpen: boolean
  productId: string | null
  steps: CalibStepId[]        // 動的に決まる手順
  currentStep: number         // steps 内のインデックス

  // Step: bg
  bgCaptured: boolean         // このセッション中に撮影し直したか
  bgAlreadyExists: boolean    // 開いた時点で背景が登録済みか (既存を使う選択肢)
  bgCapturing: boolean
  bgUseExisting: boolean      // 既存の背景で進める判定

  // Step: template
  templateCaptured: boolean
  templateAlreadyExists: boolean
  templateCapturing: boolean
  templateUseExisting: boolean
  liveScore: number | null

  // Actions
  open: (productId: string, mode: TriggerMode, bgExists: boolean, templateExists: boolean) => void
  close: () => void
  nextStep: () => void
  prevStep: () => void

  captureBackground: () => Promise<void>
  keepExistingBackground: () => void
  captureTemplate: (templateCount: number) => Promise<void>
  keepExistingTemplate: () => void
  setLiveScore: (score: number | null) => void
}

function stepsFor(mode: TriggerMode): CalibStepId[] {
  // 全モードで「作業者」を最初のステップとして要求
  // AI トリガー: 取出しも AI 判定なので背景不要
  if (mode === 'ai') return ['worker', 'test']
  // 手動: 取出し検知に背景が要るがテンプレートは不要
  if (mode === 'manual') return ['worker', 'bg', 'test']
  // auto_background: 背景のみ
  if (mode === 'auto_background') return ['worker', 'bg', 'test']
  // auto_template: 従来通り全部
  return ['worker', 'bg', 'template', 'test']
}

const INIT = {
  isOpen: false,
  productId: null as string | null,
  steps: ['worker', 'bg', 'template', 'test'] as CalibStepId[],
  currentStep: 0,
  bgCaptured: false,
  bgAlreadyExists: false,
  bgCapturing: false,
  bgUseExisting: false,
  templateCaptured: false,
  templateAlreadyExists: false,
  templateCapturing: false,
  templateUseExisting: false,
  liveScore: null,
}

export const useCalibrationStore = create<CalibrationState>((set, get) => ({
  ...INIT,

  open: (productId, mode, bgExists, templateExists) => set({
    ...INIT,
    isOpen: true,
    productId,
    steps: stepsFor(mode),
    bgAlreadyExists: bgExists,
    templateAlreadyExists: templateExists,
    // 既存があれば初期状態は「既存利用」扱い (スキップ可能)
    bgUseExisting: bgExists,
    templateUseExisting: templateExists,
  }),

  close: () => set({ ...INIT }),

  nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, s.steps.length - 1) })),
  prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 0) })),

  captureBackground: async () => {
    const { productId } = get()
    if (!productId) return
    set({ bgCapturing: true })
    try {
      await productsApi.captureBackground(productId)
      set({ bgCaptured: true, bgUseExisting: false, bgCapturing: false })
    } catch {
      Toast.error('背景の撮影に失敗しました')
      set({ bgCapturing: false })
    }
  },

  keepExistingBackground: () => set({ bgUseExisting: true, bgCaptured: false }),

  captureTemplate: async (templateCount: number) => {
    const { productId } = get()
    if (!productId) return
    set({ templateCapturing: true })
    try {
      if (templateCount > 0) {
        await productsApi.clearTriggerTemplates(productId, templateCount)
      }
      await productsApi.captureTriggerTemplate(productId)
      set({ templateCaptured: true, templateUseExisting: false, templateCapturing: false })
    } catch {
      Toast.error('テンプレートの撮影に失敗しました')
      set({ templateCapturing: false })
    }
  },

  keepExistingTemplate: () => set({ templateUseExisting: true, templateCaptured: false }),

  setLiveScore: (score) => set({ liveScore: score }),
}))
