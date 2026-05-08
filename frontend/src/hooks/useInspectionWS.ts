import { useEffect, useRef, useCallback } from 'react'
import { useInspectionStore } from '../stores/inspectionStore'
import type { InspectionStateUpdate } from '../types/ws'

let sharedWs: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let activeConsumers = 0
let latestStateHandler: ((data: InspectionStateUpdate) => void) | null = null

function clearReconnectTimer() {
  clearTimeout(reconnectTimer)
  reconnectTimer = undefined
}

function connectSharedWS() {
  if (sharedWs && (
    sharedWs.readyState === WebSocket.OPEN ||
    sharedWs.readyState === WebSocket.CONNECTING
  )) {
    return
  }

  clearReconnectTimer()

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}/ws/inspection`)
  sharedWs = ws

  ws.onmessage = (e) => {
    try {
      const data: InspectionStateUpdate = JSON.parse(e.data)
      if (data.type === 'state_update') {
        latestStateHandler?.(data)
      }
    } catch { /* ignore parse errors */ }
  }

  ws.onclose = () => {
    if (sharedWs === ws) sharedWs = null
    if (activeConsumers > 0) {
      clearReconnectTimer()
      reconnectTimer = setTimeout(connectSharedWS, 1000)
    }
  }

  ws.onerror = () => ws.close()
}

function closeSharedWSIfUnused() {
  if (activeConsumers > 0) return

  clearReconnectTimer()
  if (sharedWs) {
    const ws = sharedWs
    sharedWs = null
    ws.onclose = null
    ws.onerror = null
    ws.close()
  }
}

export function useInspectionWS() {
  const subscribedRef = useRef(false)
  const handleStateUpdate = useInspectionStore((s) => s.handleStateUpdate)
  const inspecting = useInspectionStore((s) => s.inspecting)

  latestStateHandler = handleStateUpdate

  useEffect(() => {
    if (subscribedRef.current) return
    if (inspecting) {
      subscribedRef.current = true
      activeConsumers += 1
      connectSharedWS()
    }
    return () => {
      if (!subscribedRef.current) return
      subscribedRef.current = false
      activeConsumers = Math.max(0, activeConsumers - 1)
      closeSharedWSIfUnused()
    }
  }, [inspecting])

  const send = useCallback((msg: Record<string, unknown>) => {
    if (sharedWs?.readyState === WebSocket.OPEN) {
      sharedWs.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
