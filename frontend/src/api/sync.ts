import { api } from './client'

export interface AppConfig {
  mode: 'standalone' | 'shared_folder' | 'cloud_sync' | 'master' | 'client'
  pc_id: string
  pc_label: string
  master_url: string
  shared_path: string
  cloud_sync_path: string
  flush_interval_sec: number
  health_timeout_sec: number
}

export const syncApi = {
  getConfig: () => api<AppConfig>('/sync/config').get(),
  updateConfig: (body: Partial<AppConfig>) => api<AppConfig>('/sync/config').put(body),
  testConnection: () =>
    api<{ ok: boolean; message?: string }>('/sync/test-connection').post(),
}
