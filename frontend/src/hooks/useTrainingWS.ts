import { useEffect, useRef, useCallback } from 'react'
import { useTrainingStore } from '../stores/trainingStore'
import type { TrainingMessage } from '../types/ws'

export function useTrainingWS(enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleWSMessage = useTrainingStore((s) => s.handleWSMessage)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    clearTimeout(reconnectTimer.current)

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws/training`)

    ws.onmessage = (e) => {
      try {
        const data: TrainingMessage = JSON.parse(e.data)
        handleWSMessage(data)
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      wsRef.current = null
      if (enabled) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = setTimeout(connect, 2000)
      }
    }

    ws.onerror = () => ws.close()
    wsRef.current = ws
  }, [handleWSMessage, enabled])

  useEffect(() => {
    if (enabled) {
      connect()
    }
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, connect])

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
