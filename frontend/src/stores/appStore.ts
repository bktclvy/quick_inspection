import { create } from 'zustand'
import type { Product, ProductSummary, ROI } from '../types'
import { productsApi } from '../api/products'
import { api } from '../api/client'

interface AppState {
  /* state */
  products: ProductSummary[]
  selectedProductId: string | null
  selectedProduct: Product | null
  rois: ROI[]

  /* actions */
  loadProducts: () => Promise<void>
  selectProduct: (id: string | null) => Promise<void>
  refreshROIs: () => Promise<void>
  clearSelection: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  products: [],
  selectedProductId: null,
  selectedProduct: null,
  rois: [],

  loadProducts: async () => {
    const products = await productsApi.list()
    set({ products })
  },

  selectProduct: async (id) => {
    if (!id) {
      set({ selectedProductId: null, selectedProduct: null, rois: [] })
      return
    }
    set({ selectedProductId: id })
    const product = await productsApi.get(id)
    set({ selectedProduct: product, rois: product.rois })

    // 製品に保存されたカメラ設定を適用
    try {
      const cfg = await productsApi.getConfig(id) as Record<string, unknown>
      const settings: Record<string, unknown> = {}
      if (cfg.camera_flip_h != null || cfg.camera_flip_v != null) {
        settings.flip_h = cfg.camera_flip_h ?? false
        settings.flip_v = cfg.camera_flip_v ?? false
      }
      if (cfg.camera_autofocus != null) {
        settings.autofocus = cfg.camera_autofocus
        settings.focus_value = cfg.camera_focus_value
      }
      if (cfg.camera_auto_exposure != null) {
        settings.auto_exposure = cfg.camera_auto_exposure
        settings.exposure_value = cfg.camera_exposure_value
      }
      if (Object.keys(settings).length > 0) {
        await api('/camera/settings').post(settings)
      }
    } catch { /* カメラ設定復元失敗は無視 */ }
  },

  refreshROIs: async () => {
    const { selectedProductId } = get()
    if (!selectedProductId) return
    const product = await productsApi.get(selectedProductId)
    set({ selectedProduct: product, rois: product.rois })
  },

  clearSelection: () => {
    set({ selectedProductId: null, selectedProduct: null, rois: [] })
  },
}))
