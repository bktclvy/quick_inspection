import { api } from './client'
import type { Product, ProductSummary, InspectionConfig, SavedModel, ModelMeta, Counters } from '../types'
import type { CreateProductReq, CreateROIReq, UpdateROIReq } from '../types/api'

/* ── Products ─────────────────────────────────────── */

export const productsApi = {
  list: () => api<{ products: ProductSummary[] }>('/products').get().then((r) => r.products),
  get: (id: string) => api<Product>(`/products/${id}`).get(),
  create: (body: CreateProductReq) => api<Product>('/products').post(body),
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

  /* Predict */
  predictOnce: (id: string) => api(`/products/${id}/predict-once`).post(),
}
