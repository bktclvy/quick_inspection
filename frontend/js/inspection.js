/* ============================================================
   検査ページ — AppState購読、パラメータ除去（セットアップに移動）
   ============================================================ */

const InspectionPage = {
  history: [],
  maxHistory: 50,
  triggerMode: 'auto_background',
  inspecting: false,

  init() {
    // 開始/停止
    document.getElementById('inspStartBtn').addEventListener('click', () => this.startInspection());
    document.getElementById('inspStopBtn').addEventListener('click', () => this.stopInspection());

    // カウンターリセット
    document.getElementById('resetCounterBtn').addEventListener('click', () => this.resetCounters());

    // WebSocket経由の状態更新を監視
    CameraFeed.onStateUpdate((data) => this.handleStateUpdate(data));

    // スペースキーで手動トリガー
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        const page = document.querySelector('.page.active');
        if (page && page.id === 'page-inspection' && this.triggerMode === 'manual' && this.inspecting) {
          e.preventDefault();
          CameraFeed.sendInspectionMsg({ action: 'manual_trigger' });
        }
      }
    });

    // AppState購読: 製品選択
    AppState.on('product', (id) => {
      this._onProductChange(id);
    });
  },

  _onProductChange(productId) {
    const startBtn = document.getElementById('inspStartBtn');
    startBtn.disabled = !productId || this.inspecting;
    if (productId && !this.inspecting) {
      this.loadCounters();
    }
  },

  async checkInspectionStatus() {
    try {
      const status = await apiFetch('/inspection/status');
      if (status.active && status.product_id) {
        AppState.inspectionProductId = status.product_id;
        this.inspecting = true;
        // グローバルセレクターを検査中の製品に合わせる
        await AppState.selectProduct(status.product_id);
        document.getElementById('inspStartBtn').disabled = true;
        document.getElementById('inspStopBtn').disabled = false;
        document.getElementById('globalProductSelect').disabled = true;
        this.loadCounters();
      }
    } catch (e) { /* 無視 */ }
  },

  async startInspection() {
    const productId = AppState.selectedProductId;
    if (!productId) return;
    try {
      await apiFetch('/inspection/start', {
        method: 'POST',
        body: { product_id: productId },
      });
      this.inspecting = true;
      AppState.inspectionProductId = productId;
      document.getElementById('inspStartBtn').disabled = true;
      document.getElementById('inspStopBtn').disabled = false;
      document.getElementById('globalProductSelect').disabled = true;
      CameraFeed.connectInspectionWS();
      Toast.info('検査開始');
    } catch (e) {
      Toast.error('検査開始に失敗: ' + e.message);
    }
  },

  async stopInspection() {
    try {
      await apiFetch('/inspection/stop', { method: 'POST' });
      this.inspecting = false;
      AppState.inspectionProductId = null;
      document.getElementById('inspStartBtn').disabled = !AppState.selectedProductId;
      document.getElementById('inspStopBtn').disabled = true;
      document.getElementById('globalProductSelect').disabled = false;
      Toast.info('検査停止');
    } catch (e) {
      Toast.error(e.message);
    }
  },

  /* ── 状態更新ハンドラー ──────────────────────────── */

  handleStateUpdate(data) {
    if (data.type !== 'state_update') return;
    if (!this.inspecting) return;

    const card = document.getElementById('judgmentCard');
    const stateEl = document.getElementById('judgmentState');
    const labelEl = document.getElementById('judgmentLabel');
    const confEl = document.getElementById('judgmentConfidence');
    const progressEl = document.getElementById('judgmentProgress');

    if (data.counters) {
      document.getElementById('counterTotal').textContent = data.counters.total;
      document.getElementById('counterOk').textContent = data.counters.ok;
      document.getElementById('counterNg').textContent = data.counters.ng;
    }

    if (data.trigger_mode) {
      this.triggerMode = data.trigger_mode;
    }

    const state = data.state;
    stateEl.textContent = state.toUpperCase().replace('_', ' ');

    switch (state) {
      case 'idle':
        card.className = 'judgment-card';
        labelEl.textContent = '待機中';
        confEl.textContent = '';
        if (data.trigger_mode === 'auto_background') {
          if (data.needs_background) {
            progressEl.textContent = '背景未撮影 → セットアップで撮影してください';
          } else if (data.bg_diff != null) {
            progressEl.textContent = `背景差分: ${data.bg_diff}`;
          } else {
            progressEl.textContent = '';
          }
        } else if (data.match_scores) {
          const scores = Object.values(data.match_scores).filter(s => s !== null);
          if (scores.length > 0) {
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            progressEl.textContent = `マッチ: ${(avg * 100).toFixed(0)}%`;
            if (data.trigger_count > 0) {
              progressEl.textContent += ` (${data.trigger_count}/${data.trigger_required})`;
            }
          } else {
            progressEl.textContent = data.trigger_mode === 'manual' ? 'スペースキーで検査' : 'テンプレート未登録';
          }
        } else {
          progressEl.textContent = data.trigger_mode === 'manual' ? 'スペースキーで検査' : '';
        }
        document.getElementById('roiResultsCard').style.display = 'none';
        break;

      case 'detecting':
        card.className = 'judgment-card detecting';
        labelEl.textContent = '物体検出中...';
        confEl.textContent = '';
        if (data.stability_count != null) {
          progressEl.textContent = `安定待ち: ${data.stability_count}/${data.stability_required}`;
        } else {
          progressEl.textContent = '';
        }
        break;

      case 'inspecting':
        card.className = 'judgment-card detecting';
        labelEl.textContent = '検査中...';
        confEl.textContent = '';
        progressEl.textContent = '';
        break;

      case 'judged':
        this._showJudged(data, card, labelEl, confEl, progressEl);
        break;

      case 'waiting_removal':
        stateEl.textContent = '除去待ち';
        if (data.overall_judgment) {
          const isOk = data.overall_judgment.toUpperCase() === 'OK';
          card.className = `judgment-card ${isOk ? 'ok' : 'ng'}`;
          labelEl.textContent = data.overall_judgment.toUpperCase();
        }
        progressEl.textContent = 'ワークを取り除いてください';
        confEl.textContent = '';
        break;
    }
  },

  _showJudged(data, card, labelEl, confEl, progressEl) {
    const isOk = data.overall_judgment.toUpperCase() === 'OK';
    card.className = `judgment-card ${isOk ? 'ok' : 'ng'}`;
    labelEl.textContent = data.overall_judgment.toUpperCase();
    confEl.textContent = `${(data.overall_confidence * 100).toFixed(1)}%`;
    progressEl.textContent = '';

    if (data.roi_results && data.roi_results.length > 0) {
      const container = document.getElementById('roiResultsContainer');
      container.innerHTML = data.roi_results.map(r => {
        if (r.error) {
          return `<div class="roi-result-item error">
            <span class="roi-result-name">${r.roi_name}</span>
            <span class="roi-result-badge ng">ERR</span>
          </div>`;
        }
        const ok = r.judgment.toUpperCase() === 'OK';
        return `<div class="roi-result-item ${ok ? 'ok' : 'ng'}">
          <span class="roi-result-name">${r.roi_name}</span>
          <span class="roi-result-badge ${ok ? 'ok' : 'ng'}">${r.judgment}</span>
          <span class="roi-result-conf mono-sm">${(r.confidence * 100).toFixed(1)}%</span>
        </div>`;
      }).join('');
      document.getElementById('roiResultsCard').style.display = '';
    }

    AudioFeedback.play(isOk ? 'ok' : 'ng');
    this.addHistory(data);
  },

  /* ── 履歴 ───────────────────────────────────────── */

  addHistory(data) {
    if (!data.overall_judgment) return;
    if (this.history.length > 0) {
      const last = this.history[0];
      if (Date.now() - last.time < 1000 && last.judgment === data.overall_judgment) return;
    }
    this.history.unshift({
      judgment: data.overall_judgment,
      confidence: data.overall_confidence,
      time: Date.now(),
    });
    if (this.history.length > this.maxHistory) this.history.pop();
    this.renderHistory();
  },

  renderHistory() {
    const list = document.getElementById('historyList');
    if (this.history.length === 0) {
      list.innerHTML = '<div class="history-empty">まだ判定がありません</div>';
      return;
    }
    list.innerHTML = this.history.map((h) => {
      const cls = h.judgment.toUpperCase() === 'OK' ? 'ok' : 'ng';
      return `
        <div class="history-item">
          <span class="history-badge ${cls}">${h.judgment.toUpperCase()}</span>
          <span class="history-conf">${(h.confidence * 100).toFixed(1)}%</span>
          <span class="history-time">${formatTime(new Date(h.time))}</span>
        </div>`;
    }).join('');
  },

  /* ── カウンター ──────────────────────────────────── */

  async loadCounters() {
    const pid = AppState.selectedProductId;
    if (!pid) return;
    try {
      const data = await apiFetch(`/products/${pid}/counters`);
      document.getElementById('counterTotal').textContent = data.total;
      document.getElementById('counterOk').textContent = data.ok;
      document.getElementById('counterNg').textContent = data.ng;
    } catch (e) { /* 無視 */ }
  },

  async resetCounters() {
    const pid = AppState.selectedProductId;
    if (!pid) return;
    try {
      await apiFetch(`/products/${pid}/counters/reset`, { method: 'POST' });
      document.getElementById('counterTotal').textContent = '0';
      document.getElementById('counterOk').textContent = '0';
      document.getElementById('counterNg').textContent = '0';
      Toast.info('カウンターをリセットしました');
    } catch (e) {
      Toast.error(e.message);
    }
  },
};
