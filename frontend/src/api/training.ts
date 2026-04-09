import { api } from './client'
import type { TrainingStartReq, BatchTrainingStartReq, AugPreviewReq, AugPreviewRes } from '../types/api'

export const trainingApi = {
  start: (productId: string, params: TrainingStartReq) =>
    api(`/products/${productId}/training/start`).post(params),

  startBatch: (productId: string, params: BatchTrainingStartReq) =>
    api(`/products/${productId}/training/start-batch`).post(params),

  stop: () => api('/training/stop').post(),

  status: () => api<{ running: boolean }>('/training/status').get(),

  augmentationPreview: (productId: string, body: AugPreviewReq) =>
    api<AugPreviewRes>(`/products/${productId}/augmentation/preview`).post(body),
}
