import { api } from './client'
import type { CameraInfo } from '../types'

export const cameraApi = {
  status: () => api<CameraInfo>('/camera/status').get(),

  list: () => api<{ cameras: number[] }>('/camera/list').get().then((r) => r.cameras),

  configure: (index: number) => api('/camera/configure').post({ index }),
}
