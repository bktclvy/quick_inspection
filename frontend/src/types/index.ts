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

export interface PackingConfig {
  enabled: boolean
  unit_weight_g: number
  unit_weight_stddev_g: number
  sample_count: number
  tolerance_g: number
  zero_tolerance_g: number
}

export interface InspectionConfig {
  trigger_mode: TriggerMode
  // background mode
  presence_threshold: number
  stability_threshold: number
  stability_frames: number
  removal_diff_threshold: number
  removal_bg_threshold: number
  // template mode
  match_threshold: number
  trigger_frames: number
  removal_threshold: number
  removal_frames: number
  // common
  judged_display_ms: number
  pieces_per_box: number
  packing?: PackingConfig
  // 任意の拡張キー（学習設定、カメラ設定など）
  [key: string]: unknown
}

export type TriggerMode = 'auto_background' | 'auto_template' | 'manual' | 'ai'

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
  pieces_per_box?: number
  completed_boxes?: number
  current_box_progress?: number
}

/* ── Dataset ──────────────────────────────────────── */

export interface DatasetClass {
  name: string
  judgment: Judgment
  count: number
}

/* ── Training ─────────────────────────────────────── */

export type Backbone = 'mobilenetv2' | 'efficientnetv2b0' | 'efficientnetv2b3' | 'efficientnetv2s'

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
  early_stop_patience?: number
  backbone?: Backbone
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
