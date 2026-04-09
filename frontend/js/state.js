/* ============================================================
   グローバル状態管理 — AppState シングルトン
   ============================================================ */

const AppState = {
  currentPage: 'inspection',
  selectedProductId: null,
  inspectionProductId: null,
  inspecting: false,
  products: [],
  rois: [],

  _listeners: {},

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  },

  off(event, cb) {
    const arr = this._listeners[event];
    if (!arr) return;
    const idx = arr.indexOf(cb);
    if (idx !== -1) arr.splice(idx, 1);
  },

  emit(event, data) {
    const arr = this._listeners[event];
    if (!arr) return;
    for (const cb of arr) {
      try { cb(data); } catch (e) { console.error('AppState emit エラー:', event, e); }
    }
  },

  /* ── 製品操作 ──────────────────────────────────── */

  async loadProducts() {
    try {
      const data = await apiFetch('/products');
      this.products = data.products || [];
      this.emit('products', this.products);
    } catch (e) {
      console.error('製品一覧の取得に失敗', e);
    }
  },

  async selectProduct(id) {
    if (this.selectedProductId === id) return;
    this.selectedProductId = id;
    this.rois = [];

    if (id) {
      try {
        const data = await apiFetch(`/products/${id}`);
        this.rois = data.rois || [];
      } catch (e) {
        console.error('製品詳細の取得に失敗', e);
      }
    }

    this.emit('product', id);
    this.emit('rois', this.rois);
  },

  async refreshROIs() {
    if (!this.selectedProductId) return;
    try {
      const data = await apiFetch(`/products/${this.selectedProductId}`);
      this.rois = data.rois || [];
      this.emit('rois', this.rois);
    } catch (e) {
      console.error('ROI再取得に失敗', e);
    }
  },

  getProduct(id) {
    return this.products.find(p => p.id === id) || null;
  },

  switchPage(page) {
    this.currentPage = page;
    this.emit('page', page);
  },
};
