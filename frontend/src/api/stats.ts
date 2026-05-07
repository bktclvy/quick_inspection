import { api } from './client'

export interface ProductSummary {
  product_id: string
  total: number
  ok: number
  ng: number
  ok_rate: number | null
  completed_boxes: number
  avg_box_duration_ms: number | null
  median_box_duration_ms: number | null
  min_box_duration_ms: number | null
  max_box_duration_ms: number | null
  box_durations_ms: number[]
}

export interface WorkerEntry {
  worker_id: string
  worker_name: string
  completed_boxes: number
  avg_box_duration_ms: number | null
  median_box_duration_ms: number | null
  total: number
  ok: number
  ok_rate: number | null
}

export interface BoxRow {
  id: string
  started_at: string
  completed_at: string
  worker_id: string | null
  worker_name: string | null
  product_id: string
  product_name: string | null
  pieces_per_box: number
  box_duration_ms: number
  pc_id: string
  pc_label: string | null
}

interface Filters {
  product_id: string
  from_?: string
  to?: string
  worker_id?: string
  pc_id?: string
}

function toQuery(filters: object): Record<string, string> {
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== '') q[k] = String(v)
  }
  return q
}

export interface DaySummary {
  date: string  // YYYY-MM-DD
  box_count: number
  avg_box_duration_ms: number | null
  total: number
  ok: number
  ng: number
  ok_rate: number | null
}

export const statsApi = {
  summary: (filters: Filters) =>
    api<ProductSummary>('/stats/summary').get(toQuery(filters)),
  byWorker: (filters: Omit<Filters, 'worker_id'>) =>
    api<{ workers: WorkerEntry[] }>('/stats/by-worker').get(toQuery(filters)),
  boxes: (filters: Filters & { limit?: number; offset?: number }) =>
    api<{ boxes: BoxRow[] }>('/stats/boxes').get(toQuery(filters)),
  boxesCsvUrl: (filters: Filters): string => {
    const q = new URLSearchParams(toQuery(filters))
    return `/api/stats/boxes/csv?${q.toString()}`
  },
  calendar: (params: { product_id: string; from_: string; to: string;
                       worker_id?: string; pc_id?: string }) =>
    api<{ days: DaySummary[] }>('/stats/calendar').get(toQuery(params)),
}
