/* ── Domain Models ─────────────────────────────────── */

export interface ROI {
  id: string
  name: string
  x: number  // 0-1 normalized
  y: number
  w: number
  h: number
  color: string
  has_template: boolean
  template_count: number
  model_name: string | null
}

export interface Product {
  id: string
  name: string
  description: string
  rois: ROI[]
  trigger_region: { x: number; y: number; w: number; h: number } | null
  trigger_search_region: { x: number; y: number; w: number; h: number } | null
  trigger_template_count: number
  inspection_config: InspectionConfig
  created_at: string
  updated_at: string
}

export interface ProductSummary {
  id: string
  name: string
  description: string
  roi_count: number
}

export interface InspectionConfig {
  trigger_mode: TriggerMode
  // background mode
  presence_threshold: number
  stability_threshold: number
  stability_frames: number
  removal_diff_threshold: number
  // template mode
  match_threshold: number
  trigger_frames: number
  removal_threshold: number
  removal_frames: number
  // common
  judged_display_ms: number
}

export type TriggerMode = 'auto_background' | 'auto_template' | 'manual'

export type Judgment = 'ok' | 'ng'

export interface ROIResult {
  roi_id: string
  roi_name: string
  judgment: Judgment
  predicted_class: string
  confidence: number
  probabilities: Record<string, number>
  error?: string
}

export interface HistoryEntry {
  id: string
  judgment: Judgment
  confidence: number
  timestamp: Date
  roiResults?: ROIResult[]
}

export interface Counters {
  total: number
  ok: number
  ng: number
}

/* ── Dataset ──────────────────────────────────────── */

export interface DatasetClass {
  name: string
  judgment: Judgment
  count: number
}

/* ── Training ─────────────────────────────────────── */

export interface TrainingParams {
  model_name: string
  roi_id: string | null
  epochs: number
  learning_rate: number
  batch_size: number
  validation_split: number
  image_size: number
  freeze_base: boolean
  augmentation: AugmentationConfig | boolean
}

export interface AugmentationConfig {
  horizontal_flip: boolean
  vertical_flip: boolean
  rotation: number
  zoom: number
  brightness: number
  contrast: number
}

export interface ModelMeta {
  model_name: string
  product_id: string
  roi_id: string | null
  class_names: string[]
  class_judgments: Record<string, Judgment>
  best_val_accuracy: number
  final_train_accuracy: number
  final_val_accuracy: number
  epochs_trained: number
  image_size: number
  timestamp: string
}

export interface SavedModel {
  name: string
  meta: ModelMeta | null
}

/* ── Camera ───────────────────────────────────────── */

export interface CameraInfo {
  opened: boolean
  index: number
  width: number
  height: number
  fps: number
}
