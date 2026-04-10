import { api } from './client'
import type { DatasetClass } from '../types'
import type { CreateClassReq, CaptureReq, DeleteImageReq } from '../types/api'

export const datasetApi = {
  listClasses: (productId: string, roiId?: string | null) =>
    api<{ classes: DatasetClass[] }>(`/products/${productId}/dataset/classes`).get(
      roiId ? { roi_id: roiId } : undefined,
    ).then((r) => r.classes),

  createClass: (productId: string, body: CreateClassReq) =>
    api(`/products/${productId}/dataset/class`).post(body),

  deleteClass: (productId: string, className: string) =>
    api(`/products/${productId}/dataset/class/${className}`).delete(),

  capture: (productId: string, body: CaptureReq) =>
    api(`/products/${productId}/dataset/capture`).post(body),

  listImages: (productId: string, className: string, roiId?: string | null) =>
    api<{ images: string[]; class_name: string }>(`/products/${productId}/dataset/images/${className}`).get(
      roiId ? { roi_id: roiId } : undefined,
    ).then((r) => r.images),

  deleteImage: (productId: string, body: DeleteImageReq) =>
    api(`/products/${productId}/dataset/delete-image`).post(body),

  imageUrl: (productId: string, className: string, filename: string, roiId?: string | null) =>
    `/api/products/${productId}/dataset/file/${className}/${filename}${roiId ? `?roi_id=${roiId}` : ''}`,

  importFolder: (productId: string, roiId?: string | null) =>
    api(`/products/${productId}/dataset/import-folder`).post(
      roiId ? { roi_id: roiId } : undefined,
    ),
}
