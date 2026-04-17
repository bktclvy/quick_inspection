import { create } from 'zustand'
import type { Counters, HistoryEntry, ROIResult, Judgment } from '../types'
import type { InspectionState, InspectionStateUpdate } from '../types/ws'
import { inspectionApi } from '../api/inspection'
import { productsApi } from '../api/products'

interface InspectionStoreState {
  /* state */
  starting: boolean
  inspecting: boolean
  inspectionProductId: string | null
  currentState: InspectionState
  triggerMode: string
  counters: Counters
  overallJudgment: 'OK' | 'NG' | null
  overallConfidence: number | null
  roiResults: ROIResult[]
  history: HistoryEntry[]
  wsData: InspectionStateUpdate | null

  /* background mode */
  bgDiff: number | null
  frameDiff: number
  stabilityCount: number
  stabilityRequired: number
  needsBackground: boolean

  /* removal progress */
  removalCount: number
  removalRequired: number

  /* template mode */
  matchScores: Record<string, number | null>
  triggerCount: number
  triggerRequired: number

  remainingMs: number

  /* actions */
  startInspection: (productId: string) => Promise<void>
  stopInspection: () => Promise<void>
  handleStateUpdate: (data: InspectionStateUpdate) => void
  loadCounters: (productId: string) => Promise<void>
  resetCounters: (productId: string) => Promise<void>
  checkStatus: () => Promise<void>
  reset: () => void
}

let historyIdCounter = 0

export const useInspectionStore = create<InspectionStoreState>((set, get) => ({
  starting: false,
  inspecting: false,
  inspectionProductId: null,
  currentState: 'idle',
  triggerMode: 'auto_background',
  counters: { total: 0, ok: 0, ng: 0 },
  overallJudgment: null,
  overallConfidence: null,
  roiResults: [],
  history: [],
  wsData: null,
  bgDiff: null,
  frameDiff: 0,
  stabilityCount: 0,
  stabilityRequired: 8,
  needsBackground: false,
  removalCount: 0,
  removalRequired: 3,
  matchScores: {},
  triggerCount: 0,
  triggerRequired: 3,
  remainingMs: 0,

  startInspection: async (productId) => {
    set({ starting: true })
    try {
      await inspectionApi.start(productId)
      set({ inspecting: true, inspectionProductId: productId, history: [], starting: false })
    } catch {
      set({ starting: false })
    }
  },

  stopInspection: async () => {
    await inspectionApi.stop()
    set({ inspecting: false, currentState: 'idle', overallJudgment: null, overallConfidence: null, roiResults: [] })
  },

  handleStateUpdate: (data) => {
    const prev = get()
    const updates: Partial<InspectionStoreState> = {
      wsData: data,
      currentState: data.state,
      triggerMode: data.trigger_mode,
      counters: data.counters,
      bgDiff: data.bg_diff ?? null,
      frameDiff: data.frame_diff ?? 0,
      stabilityCount: data.stability_count ?? 0,
      stabilityRequired: data.stability_required ?? 8,
      needsBackground: data.needs_background ?? false,
      removalCount: data.removal_count ?? 0,
      removalRequired: data.removal_required ?? 3,
      matchScores: data.match_scores ?? {},
      triggerCount: data.trigger_count ?? 0,
      triggerRequired: data.trigger_required ?? 3,
      remainingMs: data.remaining_ms ?? 0,
    }

    if (data.state === 'judged' && data.overall_judgment) {
      updates.overallJudgment = data.overall_judgment
      updates.overallConfidence = data.overall_confidence ?? null
      updates.roiResults = data.roi_results ?? []

      // Add to history if this is a new judgment
      if (prev.currentState !== 'judged' && data.overall_judgment) {
        const entry: HistoryEntry = {
          id: String(++historyIdCounter),
          judgment: data.overall_judgment.toLowerCase() as Judgment,
          confidence: data.overall_confidence ?? 0,
          timestamp: new Date(),
          roiResults: data.roi_results,
        }
        updates.history = [entry, ...prev.history].slice(0, 50)
      }
    } else if (data.state === 'idle') {
      updates.overallJudgment = null
      updates.overallConfidence = null
      updates.roiResults = []
    }

    set(updates)
  },

  loadCounters: async (productId) => {
    const counters = await productsApi.getCounters(productId)
    set({ counters })
  },

  resetCounters: async (productId) => {
    await productsApi.resetCounters(productId)
    set({ counters: { total: 0, ok: 0, ng: 0 } })
  },

  checkStatus: async () => {
    const status = await inspectionApi.status()
    if (status.active && status.product_id) {
      set({ inspecting: true, inspectionProductId: status.product_id })
    }
  },

  reset: () => {
    set({
      inspecting: false,
      currentState: 'idle',
      overallJudgment: null,
      overallConfidence: null,
      roiResults: [],
      history: [],
    })
  },
}))
