import { api } from './client'
import type { Product, ProductSummary, InspectionConfig, SavedModel, ModelMeta, Counters } from '../types'
import type { CreateProductReq, CreateROIReq, UpdateROIReq } from '../types/api'

/* ── Products ─────────────────────────────────────── */

export const productsApi = {
  list: () => api<{ products: ProductSummary[] }>('/products').get().then((r) => r.products),
  get: (id: string) => api<Product>(`/products/${id}`).get(),
  create: (body: CreateProductReq) => api<Product>('/products').post(body),
  update: (id: string, body: { name?: string; description?: string }) =>
    api<Product>(`/products/${id}`).put(body),
  delete: (id: string) => api(`/products/${id}`).delete(),

  /* ROIs */
  addROI: (productId: string, body: CreateROIReq) =>
    api(`/products/${productId}/rois`).post(body),
  updateROI: (productId: string, roiId: string, body: UpdateROIReq) =>
    api(`/products/${productId}/rois/${roiId}`).put(body),
  deleteROI: (productId: string, roiId: string) =>
    api(`/products/${productId}/rois/${roiId}`).delete(),
  assignModel: (productId: string, roiId: string, modelName: string | null) =>
    api(`/products/${productId}/rois/${roiId}/assign-model`).post({ model_name: modelName }),
  captureTemplate: (productId: string, roiId: string) =>
    api(`/products/${productId}/rois/${roiId}/capture-template`).post(),
  templateUrl: (productId: string, roiId: string, index = 0) =>
    `/api/products/${productId}/rois/${roiId}/template?index=${index}`,

  deleteTemplate: (productId: string, roiId: string, index: number) =>
    api(`/products/${productId}/rois/${roiId}/template/${index}`).delete(),

  /* Config */
  getConfig: (id: string) => api<InspectionConfig>(`/products/${id}/config`).get(),
  saveConfig: (id: string, config: Partial<InspectionConfig>) =>
    api(`/products/${id}/config`).put(config),

  /* Background */
  captureBackground: (id: string) => api(`/products/${id}/capture-background`).post(),
  backgroundStatus: (id: string) =>
    api<{ has_background: boolean }>(`/products/${id}/background-status`).get(),

  /* Models */
  listModels: (id: string) =>
    api<{ models: ModelMeta[] }>(`/products/${id}/models`).get().then((r) =>
      (r.models || []).map((m) => ({ name: m.model_name, meta: m } as SavedModel))
    ),
  deleteModel: (id: string, name: string) =>
    api(`/products/${id}/models/${name}`).delete(),

  /* Counters */
  getCounters: (id: string) => api<Counters>(`/products/${id}/counters`).get(),
  resetCounters: (id: string) => api(`/products/${id}/counters/reset`).post(),

  /* Trigger Templates */
  captureTriggerTemplate: (id: string) =>
    api<{ message: string; count: number }>(`/products/${id}/trigger-template/capture`).post(),
  deleteTriggerTemplate: (id: string, index: number) =>
    api(`/products/${id}/trigger-template/${index}`).delete(),
  triggerScores: (id: string) =>
    api<{ trigger_score: number | null; bg_score: number | null }>(`/products/${id}/trigger-scores`).get(),
  clearTriggerTemplates: (id: string) =>
    api<{ message: string; remaining: number }>(`/products/${id}/trigger-templates`).delete(),

  /* Predict */
  predictOnce: (id: string) =>
    api<{ results: Array<{ roi_id: string; roi_name: string; judgment: string; predicted_class: string; confidence: number; probabilities: Record<string, number> }> }>(`/products/${id}/predict-once`).post(),

  /* AI Trigger (専用モデル + 不安定クラス合成) */
  aiTriggerStatus: (id: string) =>
    api<AITriggerStatus>(`/products/${id}/ai-trigger/status`).get(),
  synthesizeUnstable: (id: string, roiId: string, body: { patterns?: string[]; count_multiplier?: number }) =>
    api<{ generated: number; meta: UnstableMeta; errors: string[] }>(
      `/products/${id}/rois/${roiId}/unstable-class/synthesize`,
    ).post(body),
  deleteUnstable: (id: string, roiId: string) =>
    api<{ deleted: number }>(`/products/${id}/rois/${roiId}/unstable-class`).delete(),
  listUnstablePreviews: (id: string, roiId: string, n = 8) =>
    api<{ files: string[] }>(`/products/${id}/rois/${roiId}/unstable-class/previews?n=${n}`).get(),
  unstablePreviewUrl: (id: string, roiId: string, filename: string) =>
    `/api/products/${id}/rois/${roiId}/unstable-class/preview/${encodeURIComponent(filename)}`,
  trainTriggerModel: (id: string, params: { epochs?: number; learning_rate?: number; batch_size?: number; validation_split?: number } = {}) =>
    api<{ message: string }>(`/products/${id}/ai-trigger/train`).post(params),
  stopTriggerTraining: (id: string) =>
    api<{ message: string }>(`/products/${id}/ai-trigger/stop`).post(),
  deleteTriggerModel: (id: string) =>
    api<{ message: string }>(`/products/${id}/ai-trigger/model`).delete(),
  captureTriggerFrame: (id: string, state: TriggerCaptureState) =>
    api<{ state: TriggerCaptureState; counts: TriggerCaptureCounts }>(`/products/${id}/ai-trigger/capture`).post({ state }),
  clearTriggerCaptures: (id: string, state?: TriggerCaptureState) => {
    const qs = state ? `?state=${encodeURIComponent(state)}` : ''
    return api<{ deleted: number; counts: TriggerCaptureCounts }>(`/products/${id}/ai-trigger/captures${qs}`).delete()
  },
}

export type TriggerCaptureState = 'present' | 'absent' | 'obstructed'
export type TriggerCaptureCounts = Record<TriggerCaptureState, number>

export interface UnstableMeta {
  generated_at: string
  generated_count: number
  source_count: number
  patterns: string[]
  count_multiplier: number
  bg_used: boolean
}

export interface TriggerModelMeta {
  product_id: string
  backbone: string
  input_size: number
  class_names: string[]
  n_present: number
  n_unstable: number
  epochs_trained: number
  best_val_accuracy: number
  final_train_accuracy: number
  final_val_accuracy: number
  elapsed_seconds: number
  timestamp: string
}

export interface AITriggerROIStatus {
  roi_id: string
  roi_name: string
  source_count: number
  unstable: {
    exists: boolean
    synth_count: number
    manual_count: number
    total_count: number
    meta: UnstableMeta | null
  }
}

export interface AITriggerStatus {
  background_available: boolean
  trigger_model: {
    exists: boolean
    trained_at: string | null
    meta: TriggerModelMeta | null
  }
  captures: TriggerCaptureCounts
  rois: AITriggerROIStatus[]
}
