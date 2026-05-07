import { create } from 'zustand'
import type { Worker } from '../types/worker'
import { workersApi } from '../api/workers'

const STORAGE_KEY = 'quick_inspection.selected_worker_id'

interface WorkerStoreState {
  workers: Worker[]
  selectedWorkerId: string | null
  loading: boolean

  loadWorkers: () => Promise<void>
  selectWorker: (id: string | null) => void
  loadFromCache: () => void
  createWorker: (name: string, code?: string | null) => Promise<Worker>
  updateWorker: (id: string, body: { name?: string; code?: string | null; active?: boolean }) => Promise<void>
  deleteWorker: (id: string) => Promise<void>
}

export const useWorkerStore = create<WorkerStoreState>((set, get) => ({
  workers: [],
  selectedWorkerId: null,
  loading: false,

  loadWorkers: async () => {
    set({ loading: true })
    try {
      const workers = await workersApi.list(true)
      set({ workers })
      // 選択中の作業者が削除/無効化されていたらクリア
      const sel = get().selectedWorkerId
      if (sel && !workers.find((w) => w.id === sel)) {
        get().selectWorker(null)
      }
    } finally {
      set({ loading: false })
    }
  },

  selectWorker: (id) => {
    set({ selectedWorkerId: id })
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* storage失敗は無視 */ }
  },

  loadFromCache: () => {
    try {
      const id = localStorage.getItem(STORAGE_KEY)
      if (id) set({ selectedWorkerId: id })
    } catch { /* 無視 */ }
  },

  createWorker: async (name, code) => {
    const w = await workersApi.create({ name, code: code ?? null })
    await get().loadWorkers()
    return w
  },

  updateWorker: async (id, body) => {
    await workersApi.update(id, body)
    await get().loadWorkers()
  },

  deleteWorker: async (id) => {
    await workersApi.delete(id)
    if (get().selectedWorkerId === id) get().selectWorker(null)
    await get().loadWorkers()
  },
}))
