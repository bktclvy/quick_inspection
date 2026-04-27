import { useEffect } from 'react'
import { useScaleStore } from '@/stores/scaleStore'
import { useInspectionStore } from '@/stores/inspectionStore'
import { scaleApi } from '@/api/scale'

/**
 * 秤の状態を REST で定期取得して scaleStore に反映する。
 *   port_open: シリアルポートが開いている
 *   live: 直近 2 秒以内にデータを受信している
 *
 * 検査中は WS 側から push されるのでポーリングを止める。
 */
const LIVE_THRESHOLD_MS = 2000

export function useScalePolling(intervalMs = 1000) {
  const inspecting = useInspectionStore((s) => s.inspecting)
  const update = useScaleStore((s) => s.update)

  useEffect(() => {
    if (inspecting) return

    let active = true

    const poll = async () => {
      try {
        const status = await scaleApi.status()
        if (!active) return
        const live = status.port_open
          && status.data_age_ms != null
          && status.data_age_ms <= LIVE_THRESHOLD_MS
          && status.latest != null
        update({
          portOpen: status.port_open,
          live,
          value_g: status.latest?.value_g ?? null,
          stable: status.latest?.stable ?? false,
          overload: status.latest?.overload ?? false,
        })
      } catch {
        if (!active) return
        update({ portOpen: false, live: false, value_g: null, stable: false, overload: false })
      }
    }

    poll()
    const timer = setInterval(poll, intervalMs)
    return () => { active = false; clearInterval(timer) }
  }, [inspecting, intervalMs, update])
}
