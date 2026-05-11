import { api } from './client'

export const inspectionApi = {
  start: (productId: string, workerId: string | null = null, testMode: boolean = false) =>
    api('/inspection/start').post({
      product_id: productId,
      worker_id: workerId,
      test_mode: testMode,
    }),

  stop: () => api('/inspection/stop').post(),

  status: () =>
    api<{ active: boolean; product_id?: string; worker_id?: string }>('/inspection/status').get(),
}
