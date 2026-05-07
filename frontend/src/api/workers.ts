import { api } from './client'
import type { Worker } from '../types/worker'

export const workersApi = {
  list: (activeOnly = true) =>
    api<{ workers: Worker[] }>('/workers')
      .get(activeOnly ? { active_only: 'true' } : {})
      .then((r) => r.workers),

  get: (id: string) => api<Worker>(`/workers/${id}`).get(),

  create: (body: { name: string; code?: string | null }) =>
    api<Worker>('/workers').post(body),

  update: (id: string, body: { name?: string; code?: string | null; active?: boolean }) =>
    api<Worker>(`/workers/${id}`).put(body),

  delete: (id: string) => api(`/workers/${id}`).delete(),
}
