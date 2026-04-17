import type { Counters, ROIResult, TriggerMode } from '.'

/* ── Inspection WebSocket ─────────────────────────── */

export interface InspectionStateUpdate {
  type: 'state_update'
  state: InspectionState
  trigger_mode: TriggerMode
  counters: Counters

  // template mode
  match_scores?: Record<string, number | null>
  trigger_count?: number
  trigger_required?: number

  // background mode
  bg_diff?: number | null
  frame_diff?: number
  stability_count?: number
  stability_required?: number
  needs_background?: boolean

  // judged / waiting_removal / waiting_confirm
  overall_judgment?: 'OK' | 'NG'
  confirm_reason?: 'ng' | 'box_complete'
  overall_confidence?: number
  roi_results?: ROIResult[]
  remaining_ms?: number

  // waiting_removal progress
  removal_count?: number
  removal_required?: number

  // perf diagnostics (debug only)
  _timings?: { match_ms: number; infer_ms: number | null; total_ms: number }
}

export type InspectionState =
  | 'idle'
  | 'detecting'
  | 'inspecting'
  | 'judged'
  | 'waiting_removal'
  | 'waiting_confirm'

/* ── Training WebSocket ───────────────────────────── */

export type TrainingMessage =
  | TrainingStatus
  | TrainingEpochEnd
  | TrainingComplete
  | TrainingBatchProgress
  | TrainingBatchROIError
  | TrainingBatchComplete
  | TrainingError

export interface TrainingStatus {
  type: 'status'
  state: string
}

export interface TrainingEpochEnd {
  type: 'epoch_end'
  epoch: number
  total_epochs: number
  train_loss: number
  train_accuracy: number
  val_loss: number
  val_accuracy: number
  batch?: { index: number; total: number; roi_name: string }
}

export interface TrainingComplete {
  type: 'training_complete'
  meta: import('.').ModelMeta
  history: {
    loss: number[]
    accuracy: number[]
    val_loss: number[]
    val_accuracy: number[]
  }
}

export interface TrainingBatchProgress {
  type: 'batch_progress'
  batch_index: number
  batch_total: number
  roi_id: string
  roi_name: string
  model_name: string
}

export interface TrainingBatchROIError {
  type: 'batch_roi_error'
  roi_id: string
  roi_name: string
  error: string
}

export interface TrainingBatchComplete {
  type: 'batch_complete'
  batch_total: number
  results: Array<{
    roi_id: string
    roi_name: string
    status: 'complete' | 'error'
    meta?: import('.').ModelMeta
    error?: string
  }>
}

export interface TrainingError {
  type: 'error'
  error: string
}
