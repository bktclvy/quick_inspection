import { create } from 'zustand'
import type { Product, ProductSummary, ROI } from '../types'
import { productsApi } from '../api/products'

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
