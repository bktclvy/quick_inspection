import { create } from 'zustand'
import { productsApi } from '../api/products'
import { Toast } from '../components/layout/Toast'

type TestPhase = 'ng' | 'ok' | 'done'

interface TestResult {
  roi_id: string
  roi_name: string
  judgment: string
  predicted_class: string
  confidence: number
}

interface CalibrationState {
  isOpen: boolean
  productId: string | null
  currentStep: number  // 0=bg, 1=product, 2=test

  // Step 1
  bgCaptured: boolean
  bgCapturing: boolean

  // Step 2
  templateCaptured: boolean
  templateCapturing: boolean
  liveScore: number | null

  // Step 3
  testPhase: TestPhase
  testResults: TestResult[] | null
  testRunning: boolean
  ngConfirmed: boolean
  okConfirmed: boolean

  // Actions
  open: (productId: string) => void
  close: () => void
  nextStep: () => void
  prevStep: () => void

  captureBackground: () => Promise<void>
  captureTemplate: (templateCount: number) => Promise<void>
  setLiveScore: (score: number | null) => void
  runTest: () => Promise<void>
  confirmTest: () => void
  retryTest: () => void
}

export const useCalibrationStore = create<CalibrationState>((set, get) => ({
  isOpen: false,
  productId: null,
  currentStep: 0,
  bgCaptured: false,
  bgCapturing: false,
  templateCaptured: false,
  templateCapturing: false,
  liveScore: null,
  testPhase: 'ng',
  testResults: null,
  testRunning: false,
  ngConfirmed: false,
  okConfirmed: false,

  open: (productId) => set({
    isOpen: true,
    productId,
    currentStep: 0,
    bgCaptured: false,
    bgCapturing: false,
    templateCaptured: false,
    templateCapturing: false,
    liveScore: null,
    testPhase: 'ng',
    testResults: null,
    testRunning: false,
    ngConfirmed: false,
    okConfirmed: false,
  }),

  close: () => set({ isOpen: false, productId: null }),

  nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, 2) })),
  prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 0) })),

  captureBackground: async () => {
    const { productId } = get()
    if (!productId) return
    set({ bgCapturing: true })
    try {
      await productsApi.captureBackground(productId)
      set({ bgCaptured: true, bgCapturing: false })
    } catch {
      Toast.error('背景の撮影に失敗しました')
      set({ bgCapturing: false })
    }
  },

  captureTemplate: async (templateCount: number) => {
    const { productId } = get()
    if (!productId) return
    set({ templateCapturing: true })
    try {
      if (templateCount > 0) {
        await productsApi.clearTriggerTemplates(productId, templateCount)
      }
      await productsApi.captureTriggerTemplate(productId)
      set({ templateCaptured: true, templateCapturing: false })
    } catch {
      Toast.error('テンプレートの撮影に失敗しました')
      set({ templateCapturing: false })
    }
  },

  setLiveScore: (score) => set({ liveScore: score }),

  runTest: async () => {
    const { productId } = get()
    if (!productId) return
    set({ testRunning: true, testResults: null })
    try {
      const res = await productsApi.predictOnce(productId)
      set({ testResults: res.results as TestResult[], testRunning: false })
    } catch {
      Toast.error('テスト検査に失敗しました')
      set({ testRunning: false })
    }
  },

  confirmTest: () => {
    const { testPhase } = get()
    if (testPhase === 'ng') {
      set({ ngConfirmed: true, testPhase: 'ok', testResults: null })
    } else if (testPhase === 'ok') {
      set({ okConfirmed: true, testPhase: 'done' })
    }
  },

  retryTest: () => set({ testResults: null }),
}))
