import { useEffect, useRef, useCallback } from 'react'
import { useInspectionStore } from '../stores/inspectionStore'
import type { InspectionStateUpdate } from '../types/ws'

export function useInspectionWS() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleStateUpdate = useInspectionStore((s) => s.handleStateUpdate)
  const inspecting = useInspectionStore((s) => s.inspecting)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    // 前回の再接続タイマーをキャンセル
    clearTimeout(reconnectTimer.current)

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws/inspection`)

    ws.onmessage = (e) => {
      try {
        const data: InspectionStateUpdate = JSON.parse(e.data)
        if (data.type === 'state_update') {
          handleStateUpdate(data)
        }
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      wsRef.current = null
      if (inspecting) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = setTimeout(connect, 1000)
      }
    }

    ws.onerror = () => ws.close()
    wsRef.current = ws
  }, [handleStateUpdate, inspecting])

  useEffect(() => {
    if (inspecting) {
      connect()
    }
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [inspecting, connect])

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
