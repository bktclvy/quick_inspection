import { create } from 'zustand'

/**
 * 秤の状態は 3 段階で管理する:
 *   1) portOpen=false              → ポート未接続（そもそも COM が開いていない）
 *   2) portOpen=true, live=false   → ポートは開いたが、重量データが届いていない
 *                                    （電源オフ/ケーブル/通信設定不一致/秤停止 など）
 *   3) portOpen=true, live=true    → 正常動作中。value_g が最新値
 *
 * `live` は "ここ 2 秒以内にデータを受信している" を意味する。
 * これで通信できていない状態を偽で緑にしたりしない。
 */
interface ScaleState {
  portOpen: boolean          // ポートが開いているか
  live: boolean              // 直近 2 秒以内にデータ受信があったか
  value_g: number | null
  stable: boolean
  overload: boolean
  update: (data: Partial<Omit<ScaleState, 'update'>>) => void
}

export const useScaleStore = create<ScaleState>((set) => ({
  portOpen: false,
  live: false,
  value_g: null,
  stable: false,
  overload: false,
  update: (data) => set(data),
}))
