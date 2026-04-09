/* ============================================================
   ROI描画・管理オーバーレイ — 座標マッピング修正 + 移動/リサイズ対応
   ============================================================ */

const ROIManager = {
  rois: [],
  productId: null,
  _canvas: null,
  _ctx: null,
  _img: null,
  _observer: null,
  _boundMouseDown: null,
  _boundMouseMove: null,
  _boundMouseUp: null,
  isDrawing: false,
  drawStart: null,
  editMode: false,
  readOnly: false,
  _onChangeCallbacks: [],

  /* ── ドラッグ/リサイズ状態 ──────────────────────── */
  _dragState: null,   // { roiId, type:'move'|'resize', handle, startNorm, origROI }
  _hoveredROI: null,
  _hoveredHandle: null,
  _HANDLE_SIZE: 7,    // リサイズハンドルの半径(px)

  /* ── キャンバス設定 ─────────────────────────────── */

  setCanvas(canvas, img) {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._canvas && this._boundMouseDown) {
      this._canvas.removeEventListener('mousedown', this._boundMouseDown);
      this._canvas.removeEventListener('mousemove', this._boundMouseMove);
      this._canvas.removeEventListener('mouseup', this._boundMouseUp);
    }

    this._canvas = canvas;
    this._ctx = canvas ? canvas.getContext('2d') : null;
    this._img = img;

    if (!canvas || !img) return;

    this._resizeCanvas();
    this._observer = new ResizeObserver(() => this._resizeCanvas());
    this._observer.observe(img);

    this._boundMouseDown = (e) => this._onMouseDown(e);
    this._boundMouseMove = (e) => this._onMouseMove(e);
    this._boundMouseUp = (e) => this._onMouseUp(e);
    canvas.addEventListener('mousedown', this._boundMouseDown);
    canvas.addEventListener('mousemove', this._boundMouseMove);
    canvas.addEventListener('mouseup', this._boundMouseUp);

    this.drawAll();
  },

  setMode(mode) {
    this.readOnly = (mode === 'readonly');
    this.editMode = false;
    this._dragState = null;
    if (this._canvas) {
      this._canvas.classList.remove('drawing');
      this._updatePointerEvents();
    }
  },

  setProduct(productId) {
    this.productId = productId;
    if (productId) {
      this.loadROIs();
    } else {
      this.rois = [];
      this.drawAll();
      this._notifyChange();
    }
  },

  onChange(cb) {
    this._onChangeCallbacks.push(cb);
  },

  _notifyChange() {
    for (const cb of this._onChangeCallbacks) cb(this.rois);
  },

  /* ── キャンバスサイズ調整（画像に正確に重ねる）──── */

  _resizeCanvas() {
    if (!this._img || !this._canvas) return;
    const imgRect = this._img.getBoundingClientRect();
    const container = this._canvas.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    // 画像の位置（コンテナ基準）
    const left = imgRect.left - containerRect.left;
    const top = imgRect.top - containerRect.top;

    // キャンバスを画像に正確にオーバーレイ
    this._canvas.style.left = left + 'px';
    this._canvas.style.top = top + 'px';
    this._canvas.style.width = imgRect.width + 'px';
    this._canvas.style.height = imgRect.height + 'px';

    // 内部解像度 = CSS表示サイズ（1:1マッピング）
    this._canvas.width = imgRect.width;
    this._canvas.height = imgRect.height;

    this.drawAll();
  },

  /* ── 座標変換ヘルパー ────────────────────────────── */

  /** マウスイベント → 正規化座標 (0-1) */
  _eventToNorm(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  },

  /* ── API通信 ───────────────────────────────────── */

  async loadROIs() {
    if (!this.productId) return;
    try {
      const data = await apiFetch(`/products/${this.productId}`);
      this.rois = data.rois || [];
      this.drawAll();
      this._updatePointerEvents();
      this._notifyChange();
    } catch (e) {
      console.error('ROI読み込み失敗', e);
    }
  },

  async createROI(name, x, y, w, h) {
    if (!this.productId) return null;
    try {
      const roi = await apiFetch(`/products/${this.productId}/rois`, {
        method: 'POST',
        body: { name, x, y, w, h },
      });
      this.rois.push(roi);
      this.drawAll();
      this._updatePointerEvents();
      this._notifyChange();
      if (typeof AppState !== 'undefined') AppState.rois = this.rois;
      return roi;
    } catch (e) {
      console.error('ROI作成失敗', e);
      return null;
    }
  },

  async updateROI(roiId, updates) {
    if (!this.productId) return null;
    try {
      const roi = await apiFetch(`/products/${this.productId}/rois/${roiId}`, {
        method: 'PUT',
        body: updates,
      });
      const idx = this.rois.findIndex(r => r.id === roiId);
      if (idx >= 0) this.rois[idx] = roi;
      this.drawAll();
      this._updatePointerEvents();
      this._notifyChange();
      if (typeof AppState !== 'undefined') AppState.rois = this.rois;
      return roi;
    } catch (e) {
      console.error('ROI更新失敗', e);
      return null;
    }
  },

  async deleteROI(roiId) {
    if (!this.productId) return;
    try {
      await apiFetch(`/products/${this.productId}/rois/${roiId}`, { method: 'DELETE' });
      this.rois = this.rois.filter(r => r.id !== roiId);
      this.drawAll();
      this._updatePointerEvents();
      this._notifyChange();
      if (typeof AppState !== 'undefined') AppState.rois = this.rois;
    } catch (e) {
      console.error('ROI削除失敗', e);
    }
  },

  async assignModel(roiId, modelName) {
    if (!this.productId) return;
    try {
      await apiFetch(`/products/${this.productId}/rois/${roiId}/assign-model`, {
        method: 'POST',
        body: { model_name: modelName },
      });
      const roi = this.rois.find(r => r.id === roiId);
      if (roi) roi.model_name = modelName;
      this._notifyChange();
    } catch (e) {
      console.error('モデル割当失敗', e);
    }
  },

  async captureTemplate(roiId) {
    if (!this.productId) return false;
    try {
      await apiFetch(`/products/${this.productId}/rois/${roiId}/capture-template`, { method: 'POST' });
      const roi = this.rois.find(r => r.id === roiId);
      if (roi) roi.has_template = true;
      this.drawAll();
      this._notifyChange();
      return true;
    } catch (e) {
      console.error('テンプレート撮影失敗', e);
      return false;
    }
  },

  /* ── 描画 ─────────────────────────────────────── */

  drawAll() {
    if (!this._ctx) return;
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    this._ctx.clearRect(0, 0, cw, ch);
    for (const roi of this.rois) {
      const isHovered = (this._hoveredROI === roi.id);
      this._drawROI(roi, { highlight: isHovered });
    }
  },

  _drawROI(roi, opts = {}) {
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    const x = roi.x * cw;
    const y = roi.y * ch;
    const w = roi.w * cw;
    const h = roi.h * ch;
    const color = opts.color || roi.color || '#2563eb';

    this._ctx.save();

    // 矩形描画
    this._ctx.strokeStyle = color;
    this._ctx.lineWidth = 2;
    if (opts.dashed) {
      this._ctx.setLineDash([6, 4]);
    }
    this._ctx.strokeRect(x, y, w, h);
    this._ctx.setLineDash([]);

    // ハイライト時: 半透明塗りつぶし
    if (opts.highlight && !this.editMode) {
      this._ctx.fillStyle = color;
      this._ctx.globalAlpha = 0.08;
      this._ctx.fillRect(x, y, w, h);
      this._ctx.globalAlpha = 1;
    }

    // ラベル
    const label = roi.name || roi.id;
    this._ctx.font = '600 12px Outfit, sans-serif';
    const tw = this._ctx.measureText(label).width;
    this._ctx.fillStyle = color;
    this._ctx.globalAlpha = 0.85;
    this._ctx.fillRect(x, y - 20, tw + 12, 20);
    this._ctx.globalAlpha = 1;

    this._ctx.fillStyle = '#fff';
    this._ctx.fillText(label, x + 6, y - 6);

    // テンプレート撮影済みマーカー
    if (roi.has_template) {
      this._ctx.fillStyle = '#10b981';
      this._ctx.beginPath();
      this._ctx.arc(x + w - 8, y + 8, 5, 0, Math.PI * 2);
      this._ctx.fill();
    }

    // リサイズハンドル（readOnlyでなく、editModeでないとき）
    if (!this.readOnly && !this.editMode) {
      this._drawHandles(x, y, w, h, color);
    }

    this._ctx.restore();
  },

  _drawHandles(x, y, w, h, color) {
    const hs = this._HANDLE_SIZE;
    const handles = this._getHandlePositions(x, y, w, h);
    this._ctx.fillStyle = '#fff';
    this._ctx.strokeStyle = color;
    this._ctx.lineWidth = 1.5;
    for (const pos of Object.values(handles)) {
      this._ctx.beginPath();
      this._ctx.rect(pos.x - hs / 2, pos.y - hs / 2, hs, hs);
      this._ctx.fill();
      this._ctx.stroke();
    }
  },

  _getHandlePositions(x, y, w, h) {
    return {
      nw: { x, y },
      ne: { x: x + w, y },
      sw: { x, y: y + h },
      se: { x: x + w, y: y + h },
      n:  { x: x + w / 2, y },
      s:  { x: x + w / 2, y: y + h },
      w:  { x, y: y + h / 2 },
      e:  { x: x + w, y: y + h / 2 },
    };
  },

  /* ── ヒットテスト ────────────────────────────────── */

  /** ピクセル座標で ROI のリサイズハンドルをチェック */
  _hitTestHandle(px, py) {
    const hs = this._HANDLE_SIZE + 3; // 少し余裕
    for (const roi of this.rois) {
      const cw = this._canvas.width;
      const ch = this._canvas.height;
      const handles = this._getHandlePositions(
        roi.x * cw, roi.y * ch, roi.w * cw, roi.h * ch
      );
      for (const [name, pos] of Object.entries(handles)) {
        if (Math.abs(px - pos.x) <= hs && Math.abs(py - pos.y) <= hs) {
          return { roiId: roi.id, handle: name };
        }
      }
    }
    return null;
  },

  /** ピクセル座標で ROI 矩形内をチェック */
  _hitTestROI(px, py) {
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    // 逆順（前面のROIを優先）
    for (let i = this.rois.length - 1; i >= 0; i--) {
      const roi = this.rois[i];
      const x = roi.x * cw, y = roi.y * ch;
      const w = roi.w * cw, h = roi.h * ch;
      if (px >= x && px <= x + w && py >= y && py <= y + h) {
        return roi.id;
      }
    }
    return null;
  },

  /* ── カーソル管理 ─────────────────────────────── */

  _HANDLE_CURSORS: {
    nw: 'nwse-resize', se: 'nwse-resize',
    ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize',
    w: 'ew-resize', e: 'ew-resize',
  },

  _updateCursor(px, py) {
    if (!this._canvas || this.editMode || this.readOnly) return;
    const handle = this._hitTestHandle(px, py);
    if (handle) {
      this._canvas.style.cursor = this._HANDLE_CURSORS[handle.handle];
      this._hoveredROI = handle.roiId;
      this._hoveredHandle = handle.handle;
    } else {
      const roiId = this._hitTestROI(px, py);
      if (roiId) {
        this._canvas.style.cursor = 'move';
        this._hoveredROI = roiId;
        this._hoveredHandle = null;
      } else {
        this._canvas.style.cursor = '';
        this._hoveredROI = null;
        this._hoveredHandle = null;
      }
    }
  },

  _updatePointerEvents() {
    if (!this._canvas) return;
    // editMode/readOnly以外でもROIがあればポインターイベントを有効化
    if (this.editMode) {
      this._canvas.style.pointerEvents = 'auto';
      this._canvas.style.cursor = 'crosshair';
    } else if (!this.readOnly && this.rois.length > 0) {
      this._canvas.style.pointerEvents = 'auto';
      this._canvas.style.cursor = '';
    } else {
      this._canvas.style.pointerEvents = '';
      this._canvas.style.cursor = '';
    }
  },

  /* ── 編集モード（新規ROI描画）───────────────────── */

  enableEditMode() {
    if (this.readOnly) return;
    this.editMode = true;
    this._dragState = null;
    if (this._canvas) {
      this._canvas.classList.add('drawing');
      this._updatePointerEvents();
    }
  },

  disableEditMode() {
    this.editMode = false;
    if (this._canvas) {
      this._canvas.classList.remove('drawing');
      this._updatePointerEvents();
    }
    this.drawAll();
  },

  /* ── マウスイベント ─────────────────────────────── */

  _onMouseDown(e) {
    const norm = this._eventToNorm(e);
    const px = norm.x * this._canvas.width;
    const py = norm.y * this._canvas.height;

    // --- 新規ROI描画モード ---
    if (this.editMode && !this.readOnly) {
      this.isDrawing = true;
      this.drawStart = { x: norm.x, y: norm.y };
      return;
    }

    if (this.readOnly) return;

    // --- リサイズハンドル ---
    const handle = this._hitTestHandle(px, py);
    if (handle) {
      const roi = this.rois.find(r => r.id === handle.roiId);
      if (roi) {
        this._dragState = {
          roiId: roi.id,
          type: 'resize',
          handle: handle.handle,
          startNorm: norm,
          origROI: { x: roi.x, y: roi.y, w: roi.w, h: roi.h },
        };
        e.preventDefault();
        return;
      }
    }

    // --- ROI移動 ---
    const roiId = this._hitTestROI(px, py);
    if (roiId) {
      const roi = this.rois.find(r => r.id === roiId);
      if (roi) {
        this._dragState = {
          roiId: roi.id,
          type: 'move',
          handle: null,
          startNorm: norm,
          origROI: { x: roi.x, y: roi.y, w: roi.w, h: roi.h },
        };
        e.preventDefault();
      }
    }
  },

  _onMouseMove(e) {
    const norm = this._eventToNorm(e);
    const px = norm.x * this._canvas.width;
    const py = norm.y * this._canvas.height;

    // --- 新規ROI描画中 ---
    if (this.isDrawing && this.editMode) {
      this.drawAll();
      const cw = this._canvas.width;
      const ch = this._canvas.height;
      const sx = this.drawStart.x * cw;
      const sy = this.drawStart.y * ch;
      const sw = (norm.x - this.drawStart.x) * cw;
      const sh = (norm.y - this.drawStart.y) * ch;
      this._ctx.strokeStyle = '#f59e0b';
      this._ctx.lineWidth = 2;
      this._ctx.setLineDash([6, 4]);
      this._ctx.strokeRect(sx, sy, sw, sh);
      this._ctx.setLineDash([]);
      return;
    }

    // --- ドラッグ中（移動/リサイズ）---
    if (this._dragState) {
      const ds = this._dragState;
      const dx = norm.x - ds.startNorm.x;
      const dy = norm.y - ds.startNorm.y;
      const roi = this.rois.find(r => r.id === ds.roiId);
      if (!roi) return;

      if (ds.type === 'move') {
        roi.x = clamp01(ds.origROI.x + dx);
        roi.y = clamp01(ds.origROI.y + dy);
        // 画面外にはみ出さないよう制限
        if (roi.x + roi.w > 1) roi.x = 1 - roi.w;
        if (roi.y + roi.h > 1) roi.y = 1 - roi.h;
      } else if (ds.type === 'resize') {
        this._applyResize(roi, ds, dx, dy);
      }

      this.drawAll();
      return;
    }

    // --- ホバー ---
    const prevHovered = this._hoveredROI;
    this._updateCursor(px, py);
    if (prevHovered !== this._hoveredROI) this.drawAll();
  },

  _onMouseUp(e) {
    const norm = this._eventToNorm(e);

    // --- 新規ROI描画完了 ---
    if (this.isDrawing && this.editMode) {
      this.isDrawing = false;
      const x = Math.min(this.drawStart.x, norm.x);
      const y = Math.min(this.drawStart.y, norm.y);
      const w = Math.abs(norm.x - this.drawStart.x);
      const h = Math.abs(norm.y - this.drawStart.y);

      if (w < 0.03 || h < 0.03) {
        this.drawAll();
        return;
      }

      const name = prompt('ROI名を入力:', `ROI ${this.rois.length + 1}`);
      if (!name) {
        this.drawAll();
        return;
      }

      this.createROI(name, x, y, w, h);
      this.disableEditMode();
      return;
    }

    // --- ドラッグ完了（移動/リサイズ）---
    if (this._dragState) {
      const ds = this._dragState;
      const roi = this.rois.find(r => r.id === ds.roiId);
      this._dragState = null;

      if (roi) {
        // 変更があればAPIに保存
        const o = ds.origROI;
        if (roi.x !== o.x || roi.y !== o.y || roi.w !== o.w || roi.h !== o.h) {
          this.updateROI(roi.id, { x: roi.x, y: roi.y, w: roi.w, h: roi.h });
        }
      }
      this.drawAll();
    }
  },

  /* ── リサイズ計算 ───────────────────────────────── */

  _applyResize(roi, ds, dx, dy) {
    const o = ds.origROI;
    const MIN = 0.03; // 最小サイズ

    let nx = o.x, ny = o.y, nw = o.w, nh = o.h;

    const h = ds.handle;
    // 水平方向
    if (h === 'w' || h === 'nw' || h === 'sw') {
      nx = clamp01(o.x + dx);
      nw = o.w - (nx - o.x);
      if (nw < MIN) { nw = MIN; nx = o.x + o.w - MIN; }
    } else if (h === 'e' || h === 'ne' || h === 'se') {
      nw = Math.max(MIN, o.w + dx);
      if (nx + nw > 1) nw = 1 - nx;
    }
    // 垂直方向
    if (h === 'n' || h === 'nw' || h === 'ne') {
      ny = clamp01(o.y + dy);
      nh = o.h - (ny - o.y);
      if (nh < MIN) { nh = MIN; ny = o.y + o.h - MIN; }
    } else if (h === 's' || h === 'sw' || h === 'se') {
      nh = Math.max(MIN, o.h + dy);
      if (ny + nh > 1) nh = 1 - ny;
    }

    roi.x = nx;
    roi.y = ny;
    roi.w = nw;
    roi.h = nh;
  },
};

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
