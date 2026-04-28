import { create } from 'zustand'
import type { PackingConfig } from '../types'

export type BoxPhase =
  | 'off'                // packing not enabled for this product
  | 'tare'               // ❶ waiting for tare reset
  | 'inspecting'         // ❷ normal inspection in progress
  | 'weighing'           // ❸ box complete, showing [計量する] CTA
  | 'weighing_measuring' // ❸ calling /api/scale/weigh, waiting
  | 'weigh_ok'           // ❸ OK result, showing [次の箱へ]
  | 'weigh_ng'           // ❸ NG result, showing [もう一度計量する]

export interface LocalWeighResult {
  ok: boolean
  measured_g: number
  deviation_g: number
  estimated_qty_delta: number | null
  expected_g: number
  tolerance_g: number
}

interface BoxWorkflowState {
  phase: BoxPhase
  productId: string | null
  packingConfig: PackingConfig | null
  currentBoxQty: number
  weighResult: LocalWeighResult | null
  error: string | null

  init: (productId: string, config: PackingConfig | null) => void
  onTareOk: () => void
  onTareError: (err: string) => void
  onBoxComplete: (qty: number) => void
  startMeasuring: () => void
  onWeighOk: (r: LocalWeighResult) => void
  onWeighNg: (r: LocalWeighResult) => void
  toTareNextBox: () => void  // 員数 OK 後、次の箱へ進むため tare に戻す
  reset: () => void
}

export const useBoxWorkflowStore = create<BoxWorkflowState>((set) => ({
  phase: 'off',
  productId: null,
  packingConfig: null,
  currentBoxQty: 0,
  weighResult: null,
  error: null,

  init: (productId, config) => {
    if (config?.enabled) {
      set({ phase: 'tare', productId, packingConfig: config, weighResult: null, error: null, currentBoxQty: 0 })
    } else {
      set({ phase: 'off', productId, packingConfig: config })
    }
  },

  onTareOk: () => set({ phase: 'inspecting', error: null }),

  onTareError: (err) => set({ error: err }),

  onBoxComplete: (qty) => set({ phase: 'weighing', currentBoxQty: qty, weighResult: null }),

  startMeasuring: () => set({ phase: 'weighing_measuring', error: null }),

  onWeighOk: (r) => set({ phase: 'weigh_ok', weighResult: r }),

  onWeighNg: (r) => set({ phase: 'weigh_ng', weighResult: r }),

  toTareNextBox: () => set({ phase: 'tare', weighResult: null, error: null, currentBoxQty: 0 }),

  reset: () => set({ phase: 'off', productId: null, packingConfig: null, weighResult: null, error: null, currentBoxQty: 0 }),
}))
