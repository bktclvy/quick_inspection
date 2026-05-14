import { create } from 'zustand'
import type { PackingConfig } from '../types'

/**
 * 箱フローのフェーズ:
 *   off        — packing 無効製品、何もしない
 *   tare       — 初回 or 箱交換後の風袋引き待ち
 *   inspecting — 検査進行中（モーダル非表示、BoxProgressCard でライブ進捗）
 *   verifying  — 既定個数達成、秤がカメラ個数と一致するまで「確認中」表示
 *                （NG は明示しない。作業者は live の秤個数を見て自身で直す）
 *   result_ok  — カメラ実測 == 秤実測。風袋引きで次サイクルへ
 *
 * NG フェーズは存在しない。ユーザーアクション (「計量する」など) が無いと
 * 明示的な NG 判定は不可能。一致するまでひたすら verifying のままにする設計。
 */
export type BoxPhase =
  | 'off'
  | 'tare'
  | 'inspecting'
  | 'verifying'
  | 'result_ok'

export interface VerificationSnapshot {
  cameraCount: number   // 期待 = pieces_per_box
  scaleCount: number    // round(scale_g / unit_weight_g)
  scaleEstimate: number // 小数込み (NG説明用)
  measuredG: number
  expectedG: number
}

interface BoxWorkflowState {
  phase: BoxPhase
  productId: string | null
  packingConfig: PackingConfig | null
  currentBoxQty: number
  snapshot: VerificationSnapshot | null
  error: string | null

  init: (productId: string, config: PackingConfig | null) => void
  onTareOk: () => void
  onTareError: (err: string) => void
  onBoxComplete: (qty: number) => void
  setVerifyOk: (snap: VerificationSnapshot) => void
  toTareNextBox: () => void
  reset: () => void
}

export const useBoxWorkflowStore = create<BoxWorkflowState>((set) => ({
  phase: 'off',
  productId: null,
  packingConfig: null,
  currentBoxQty: 0,
  snapshot: null,
  error: null,

  init: (productId, config) => {
    if (config?.enabled) {
      set({ phase: 'tare', productId, packingConfig: config, snapshot: null, error: null, currentBoxQty: 0 })
    } else {
      set({ phase: 'off', productId, packingConfig: config })
    }
  },

  onTareOk: () => set({ phase: 'inspecting', error: null }),
  onTareError: (err) => set({ error: err }),

  onBoxComplete: (qty) => set({ phase: 'verifying', currentBoxQty: qty, snapshot: null, error: null }),

  setVerifyOk: (snap) => set({ phase: 'result_ok', snapshot: snap }),

  toTareNextBox: () => set({ phase: 'tare', snapshot: null, error: null, currentBoxQty: 0 }),

  reset: () => set({ phase: 'off', productId: null, packingConfig: null, snapshot: null, error: null, currentBoxQty: 0 }),
}))
