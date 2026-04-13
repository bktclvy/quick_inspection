import type { Judgment } from '.'

/* ── Request types ────────────────────────────────── */

export interface CreateProductReq {
  name: string
  description?: string
}

export interface CreateROIReq {
  name: string
  x: number
  y: number
  w: number
  h: number
  color?: string
}

export interface UpdateROIReq {
  name?: string
  x?: number
  y?: number
  w?: number
  h?: number
  color?: string
  model_name?: string | null
}

export interface CreateClassReq {
  class_name: string
  roi_id?: string | null
  judgment?: Judgment
}

export interface CaptureReq {
  class_name: string
  roi_id?: string | null
}

export interface DeleteImageReq {
  class_name: string
  filename: string
  roi_id?: string | null
}

export interface TrainingStartReq {
  model_name?: string
  roi_id?: string | null
  epochs?: number
  learning_rate?: number
  batch_size?: number
  validation_split?: number
  image_size?: number
  freeze_base?: boolean
  augmentation?: import('.').AugmentationConfig | boolean
  early_stop_patience?: number
}

export interface BatchTrainingStartReq {
  epochs?: number
  learning_rate?: number
  batch_size?: number
  validation_split?: number
  image_size?: number
  freeze_base?: boolean
  augmentation?: import('.').AugmentationConfig | boolean
  early_stop_patience?: number
}

export interface AugPreviewReq {
  augmentation?: import('.').AugmentationConfig
  image_size?: number
  roi_id?: string | null
  count?: number
}

export interface InspectionStartReq {
  product_id: string
}

/* ── Response helpers ─────────────────────────────── */

export interface AugPreviewRes {
  original: string   // base64
  samples: string[]  // base64[]
}
