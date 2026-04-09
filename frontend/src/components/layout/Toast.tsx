import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
  exiting: boolean
}

let addToast: (message: string, type: ToastType) => void = () => {}
let idCounter = 0

const DURATIONS: Record<ToastType, number> = {
  info: 3000,
  success: 3000,
  error: 5000,
}

export const Toast = {
  info: (msg: string) => addToast(msg, 'info'),
  success: (msg: string) => addToast(msg, 'success'),
  error: (msg: string) => addToast(msg, 'error'),
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 200)
  }, [])

  addToast = useCallback(
    (message: string, type: ToastType) => {
      const id = ++idCounter
      setItems((prev) => [...prev, { id, message, type, exiting: false }])
      const timer = setTimeout(() => remove(id), DURATIONS[type])
      timers.current.set(id, timer)
    },
    [remove],
  )

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout)
    }
  }, [])

  const typeStyles: Record<ToastType, string> = {
    info: 'var(--accent)',
    success: 'var(--ok)',
    error: 'var(--ng)',
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 'var(--sp-4)',
        right: 'var(--sp-4)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-2)',
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            pointerEvents: 'auto',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-default)',
            borderLeft: `3px solid ${typeStyles[t.type]}`,
            borderRadius: 'var(--radius-md)',
            padding: 'var(--sp-3) var(--sp-4)',
            fontSize: 'var(--text-sm)',
            boxShadow: 'var(--shadow-lg)',
            maxWidth: '360px',
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
