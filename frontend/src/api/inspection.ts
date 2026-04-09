import { api } from './client'

export const inspectionApi = {
  start: (productId: string) =>
    api('/inspection/start').post({ product_id: productId }),

  stop: () => api('/inspection/stop').post(),

  status: () =>
    api<{ active: boolean; product_id?: string }>('/inspection/status').get(),
}
