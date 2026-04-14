import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
  exiting: boolean
}

let idCounter = 0

const DURATIONS: Record<ToastType, number> = {
  info: 3000,
  success: 3000,
  error: 5000,
}

// CustomEvent ベースで Toast を発火（モジュール変数パターンより確実）
export const Toast = {
  info: (msg: string) => window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: msg, type: 'info' } })),
  success: (msg: string) => window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: msg, type: 'success' } })),
  error: (msg: string) => window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: msg, type: 'error' } })),
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 200)
  }, [])

  const addToast = useCallback(
    (message: string, type: ToastType) => {
      const id = ++idCounter
      setItems((prev) => [...prev, { id, message, type, exiting: false }])
      const timer = setTimeout(() => remove(id), DURATIONS[type])
      timers.current.set(id, timer)
    },
    [remove],
  )

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, type } = (e as CustomEvent).detail
      addToast(message, type)
    }
    window.addEventListener('app-toast', handler)
    return () => {
      window.removeEventListener('app-toast', handler)
      timers.current.forEach(clearTimeout)
    }
  }, [addToast])

  const typeColors: Record<ToastType, string> = {
    info: '#6366f1',
    success: '#10b981',
    error: '#ef4444',
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            pointerEvents: 'auto',
            background: '#ffffff',
            border: '1px solid #ebe7e2',
            borderLeft: `3px solid ${typeColors[t.type]}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 13,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            color: '#3d3654',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
            maxWidth: 360,
            cursor: 'pointer',
            animation: t.exiting ? 'toastOut 0.2s ease forwards' : 'toastIn 0.2s ease',
          }}
          onClick={() => remove(t.id)}
        >
          {t.message}
        </div>
      ))}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(20px); }
        }
      `}</style>
    </div>,
    document.body,
  )
}
