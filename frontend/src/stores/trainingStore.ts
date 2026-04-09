import { create } from 'zustand'
import type { SavedModel } from '../types'
import type { TrainingMessage } from '../types/ws'
import { productsApi } from '../api/products'

interface ChartData {
  labels: number[]
  loss: number[]
  valLoss: number[]
  accuracy: number[]
  valAccuracy: number[]
}

interface TrainingStoreState {
  /* state */
  isRunning: boolean
  statusText: string
  epoch: number
  totalEpochs: number
  trainLoss: number | null
  trainAccuracy: number | null
  valLoss: number | null
  valAccuracy: number | null
  chartData: ChartData
  batchProgress: { index: number; total: number; roiName: string } | null
  batchResults: Array<{ roi_id: string; roi_name: string; status: string; meta?: unknown; error?: string }> | null
  savedModels: SavedModel[]

  /* actions */
  handleWSMessage: (msg: TrainingMessage) => void
  loadModels: (productId: string) => Promise<void>
  resetCharts: () => void
  reset: () => void
}

const emptyChart: ChartData = { labels: [], loss: [], valLoss: [], accuracy: [], valAccuracy: [] }

export const useTrainingStore = create<TrainingStoreState>((set, get) => ({
  isRunning: false,
  statusText: '',
  epoch: 0,
  totalEpochs: 0,
  trainLoss: null,
  trainAccuracy: null,
  valLoss: null,
  valAccuracy: null,
  chartData: { ...emptyChart },
  batchProgress: null,
  batchResults: null,
  savedModels: [],

  handleWSMessage: (msg) => {
    switch (msg.type) {
      case 'status':
        set({ isRunning: true, statusText: msg.state })
        break

      case 'epoch_end': {
        const chart = get().chartData
        set({
          isRunning: true,
          epoch: msg.epoch,
          totalEpochs: msg.total_epochs,
          trainLoss: msg.train_loss,
          trainAccuracy: msg.train_accuracy,
          valLoss: msg.val_loss,
          valAccuracy: msg.val_accuracy,
          chartData: {
            labels: [...chart.labels, msg.epoch],
            loss: [...chart.loss, msg.train_loss],
            valLoss: [...chart.valLoss, msg.val_loss],
            accuracy: [...chart.accuracy, msg.train_accuracy],
            valAccuracy: [...chart.valAccuracy, msg.val_accuracy],
          },
          batchProgress: msg.batch ? { index: msg.batch.index, total: msg.batch.total, roiName: msg.batch.roi_name } : get().batchProgress,
        })
        break
      }

      case 'training_complete':
        set({ isRunning: false, statusText: 'complete' })
        break

      case 'batch_progress':
        set({
          batchProgress: { index: msg.batch_index, total: msg.batch_total, roiName: msg.roi_name },
        })
        break

      case 'batch_roi_error':
        // keep running, just note it
        break

      case 'batch_complete':
        set({ isRunning: false, batchResults: msg.results, statusText: 'batch_complete' })
        break

      case 'error':
        set({ isRunning: false, statusText: `error: ${msg.error}` })
        break
    }
  },

  loadModels: async (productId) => {
    const models = await productsApi.listModels(productId)
    set({ savedModels: models })
  },

  resetCharts: () => {
    set({
      chartData: { ...emptyChart },
      epoch: 0,
      totalEpochs: 0,
      trainLoss: null,
      trainAccuracy: null,
      valLoss: null,
      valAccuracy: null,
      batchProgress: null,
      batchResults: null,
      statusText: '',
    })
  },

  reset: () => {
    set({
      isRunning: false,
      statusText: '',
      epoch: 0,
      totalEpochs: 0,
      trainLoss: null,
      trainAccuracy: null,
      valLoss: null,
      valAccuracy: null,
      chartData: { ...emptyChart },
      batchProgress: null,
      batchResults: null,
      savedModels: [],
    })
  },
}))
