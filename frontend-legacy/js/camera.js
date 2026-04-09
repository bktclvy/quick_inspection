/* ============================================================
   カメラフィード — シングルimg DOM付け替え + 検査WebSocket
   ============================================================ */

const CameraFeed = {
  _img: null,
  _canvas: null,
  _flash: null,
  _currentContainer: null,
  inspectionWs: null,
  _listeners: [],
  connected: false,

  init() {
    // シングルimg要素を生成（HTMLには空containerだけ配置）
    this._img = document.createElement('img');
    this._img.className = 'camera-feed';
    this._img.src = '/stream';
    this._img.alt = 'Camera';

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'roi-canvas';

    this._flash = document.createElement('div');
    this._flash.className = 'capture-flash';

    this._img.addEventListener('load', () => this.setConnected(true), { once: true });
    this._img.addEventListener('error', () => this.setConnected(false));

    this.loadCameraList();
    document.getElementById('cameraSelect').addEventListener('change', (e) => {
      this.switchCamera(parseInt(e.target.value));
    });

    this.setConnected(true);
  },

  mountTo(containerId) {
    const container = document.getElementById(containerId);
    if (!container || this._currentContainer === container) return;
    // appendChildはDOMノード移動（MJPEGストリーム維持）
    container.appendChild(this._img);
    container.appendChild(this._canvas);
    container.appendChild(this._flash);
    this._currentContainer = container;
    // ROIManagerにcanvas通知
    ROIManager.setCanvas(this._canvas, this._img);
  },

  getImg() { return this._img; },
  getCanvas() { return this._canvas; },

  triggerFlash() {
    if (!this._flash) return;
    this._flash.classList.add('active');
    setTimeout(() => this._flash.classList.remove('active'), 120);
  },

  /* ── 検査WebSocket ───────────────────────────────── */

  onStateUpdate(callback) {
    this._listeners.push(callback);
  },

  connectInspectionWS() {
    if (this.inspectionWs && this.inspectionWs.readyState <= 1) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.inspectionWs = new WebSocket(`${protocol}//${location.host}/ws/inspection`);

    this.inspectionWs.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === 'state_update') {
        for (const cb of this._listeners) cb(data);
      }
    };

    this.inspectionWs.onclose = () => {
      setTimeout(() => this.connectInspectionWS(), 2000);
    };

    this.inspectionWs.onerror = () => {
      this.inspectionWs.close();
    };
  },

  sendInspectionMsg(msg) {
    if (this.inspectionWs && this.inspectionWs.readyState === WebSocket.OPEN) {
      this.inspectionWs.send(JSON.stringify(msg));
    }
  },

  /* ── 接続状態 ────────────────────────────────────── */

  setConnected(connected) {
    this.connected = connected;
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (connected) {
      dot.className = 'status-dot connected';
      text.textContent = '接続中';
    } else {
      dot.className = 'status-dot error';
      text.textContent = '未接続';
    }
  },

  reloadStream() {
    if (this._img) {
      this._img.src = `/stream?t=${Date.now()}`;
    }
  },

  /* ── カメラ選択 ──────────────────────────────────── */

  async loadCameraList() {
    try {
      const data = await apiFetch('/camera/list');
      const select = document.getElementById('cameraSelect');
      select.innerHTML = '';
      data.cameras.forEach(idx => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `カメラ ${idx}`;
        select.appendChild(opt);
      });
      const status = await apiFetch('/camera/status');
      if (status.opened) {
        select.value = status.index;
      }
    } catch (e) { /* 無視 */ }
  },

  async switchCamera(index) {
    try {
      await apiFetch('/camera/configure', {
        method: 'POST',
        body: { index },
      });
      this.reloadStream();
      Toast.success(`カメラ ${index} に切り替えました`);
    } catch (e) {
      Toast.error('カメラ切り替えに失敗: ' + e.message);
    }
  },
};
