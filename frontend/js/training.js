/* ============================================================
   学習ステップ — セットアップ内のステップ4として動作
   ============================================================ */

const TrainingStep = {
  ws: null,
  lossChart: null,
  accChart: null,
  isRunning: false,
  chartsInitialized: false,

  init() {
    document.getElementById('startTrainBtn').addEventListener('click', () => this.startTraining());
    document.getElementById('startBatchTrainBtn').addEventListener('click', () => this.startBatchTraining());
    document.getElementById('stopTrainBtn').addEventListener('click', () => this.stopTraining());
    document.getElementById('openModelFolderBtn').addEventListener('click', async () => {
      const pid = AppState.selectedProductId;
      if (!pid) return;
      try {
        await apiFetch(`/open-folder/models?product_id=${pid}`);
      } catch (e) { Toast.error(e.message); }
    });

    this._initAugPanel();
    this.connectWS();

    // ROI変更時にROIセレクター更新
    AppState.on('rois', (rois) => {
      this._updateRoiSelect(rois);
    });
  },

  _initAugPanel() {
    const toggle = document.getElementById('toggleAugPanel');
    const panel = document.getElementById('augPanel');
    toggle.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'flex';
      toggle.textContent = open ? '設定 ▼' : '設定 ▲';
    });

    // スライダーの値表示を連動
    for (const key of ['Rotation', 'Zoom', 'Brightness', 'Contrast']) {
      const slider = document.getElementById(`aug${key}`);
      const valSpan = document.getElementById(`aug${key}Val`);
      slider.addEventListener('input', () => {
        valSpan.textContent = parseFloat(slider.value).toFixed(2);
      });
    }

    // リセットボタン
    document.getElementById('augResetBtn').addEventListener('click', () => {
      document.getElementById('augHFlip').checked = true;
      document.getElementById('augVFlip').checked = false;
      for (const [key, def] of [['Rotation', 0.1], ['Zoom', 0.1], ['Brightness', 0.1], ['Contrast', 0.1]]) {
        const slider = document.getElementById(`aug${key}`);
        slider.value = def;
        document.getElementById(`aug${key}Val`).textContent = def.toFixed(2);
      }
      document.getElementById('augPreviewGrid').innerHTML = '';
    });

    // プレビューボタン
    document.getElementById('augPreviewBtn').addEventListener('click', () => this._previewAugmentation());
  },

  _getAugConfig() {
    return {
      horizontal_flip: document.getElementById('augHFlip').checked,
      vertical_flip: document.getElementById('augVFlip').checked,
      rotation: parseFloat(document.getElementById('augRotation').value),
      zoom: parseFloat(document.getElementById('augZoom').value),
      brightness: parseFloat(document.getElementById('augBrightness').value),
      contrast: parseFloat(document.getElementById('augContrast').value),
    };
  },

  async _previewAugmentation() {
    const pid = AppState.selectedProductId;
    if (!pid) { Toast.info('製品を選択してください'); return; }

    const btn = document.getElementById('augPreviewBtn');
    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
      const roiId = document.getElementById('trainRoiSelect').value || undefined;
      const data = await apiFetch(`/products/${pid}/augmentation/preview`, {
        method: 'POST',
        body: {
          augmentation: this._getAugConfig(),
          image_size: parseInt(document.getElementById('trainImageSize').value) || 224,
          roi_id: roiId,
        },
      });

      const grid = document.getElementById('augPreviewGrid');
      let html = `<div class="aug-preview-item aug-original">
        <img src="data:image/jpeg;base64,${data.original}" alt="元画像">
        <div class="aug-preview-label">元画像</div>
      </div>`;
      data.samples.forEach((b64, i) => {
        html += `<div class="aug-preview-item">
          <img src="data:image/jpeg;base64,${b64}" alt="拡張${i + 1}">
        </div>`;
      });
      grid.innerHTML = html;
    } catch (e) {
      Toast.error('プレビュー失敗: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'プレビュー';
    }
  },

  _updateRoiSelect(rois) {
    const select = document.getElementById('trainRoiSelect');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">全体 (フルフレーム)</option>';
    (rois || []).forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      select.appendChild(opt);
    });
    if (current) select.value = current;
  },

  // 学習ステップが表示されたときにChart.jsを初期化（display:noneだとサイズ0になるため）
  onStepActivated() {
    if (!this.chartsInitialized) {
      this.initCharts();
      this.chartsInitialized = true;
    } else {
      // リサイズ対応
      if (this.lossChart) this.lossChart.resize();
      if (this.accChart) this.accChart.resize();
    }
    this.loadSavedModels();
  },

  initCharts() {
    const chartOpts = (yLabel) => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { family: "'Outfit', sans-serif", size: 12 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'エポック', font: { family: "'Outfit', sans-serif" } },
          grid: { color: 'rgba(0,0,0,0.04)' },
        },
        y: {
          title: { display: true, text: yLabel, font: { family: "'Outfit', sans-serif" } },
          grid: { color: 'rgba(0,0,0,0.06)' },
          beginAtZero: true,
        },
      },
    });

    this.lossChart = new Chart(document.getElementById('lossChart'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: '訓練損失',
            data: [],
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2,
          },
          {
            label: '検証損失',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2,
          },
        ],
      },
      options: chartOpts('損失'),
    });

    this.accChart = new Chart(document.getElementById('accuracyChart'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: '訓練精度',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2,
          },
          {
            label: '検証精度',
            data: [],
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.08)',
            fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2,
          },
        ],
      },
      options: chartOpts('精度'),
    });
  },

  connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws/training`);

    this.ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      this.handleWSMessage(data);
    };

    this.ws.onclose = () => {
      setTimeout(() => this.connectWS(), 3000);
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  },

  handleWSMessage(data) {
    if (data.type === 'epoch_end') {
      this.updateProgress(data);
      this.updateCharts(data);
    } else if (data.type === 'training_complete') {
      this.onTrainingComplete(data);
    } else if (data.type === 'batch_progress') {
      this.onBatchProgress(data);
    } else if (data.type === 'batch_roi_error') {
      Toast.error(`ROI「${data.roi_name}」の学習でエラー: ${data.error}`);
    } else if (data.type === 'batch_complete') {
      this.onBatchComplete(data);
    } else if (data.type === 'error') {
      Toast.error('学習エラー: ' + data.error);
      this.setRunning(false);
    } else if (data.type === 'status') {
      if (data.state === 'stopped') {
        Toast.info('学習を停止しました');
        this.setRunning(false);
      }
    }
  },

  updateProgress(data) {
    document.getElementById('progressBarContainer').style.display = 'flex';
    document.getElementById('metricsGrid').style.display = 'grid';

    const pct = (data.epoch / data.total_epochs * 100).toFixed(0);
    document.getElementById('progressBarFill').style.width = `${pct}%`;
    document.getElementById('progressBarLabel').textContent = `${data.epoch} / ${data.total_epochs}`;

    document.getElementById('metricLoss').textContent = data.train_loss.toFixed(4);
    document.getElementById('metricAcc').textContent = (data.train_accuracy * 100).toFixed(1) + '%';
    document.getElementById('metricValLoss').textContent = data.val_loss.toFixed(4);
    document.getElementById('metricValAcc').textContent = (data.val_accuracy * 100).toFixed(1) + '%';

    document.getElementById('progressSummary').innerHTML = `
      <div style="font-weight:600; color: var(--accent-blue);">学習中...</div>
    `;
  },

  updateCharts(data) {
    if (!this.lossChart || !this.accChart) return;
    const label = `${data.epoch}`;

    this.lossChart.data.labels.push(label);
    this.lossChart.data.datasets[0].data.push(data.train_loss);
    this.lossChart.data.datasets[1].data.push(data.val_loss);
    this.lossChart.update();

    this.accChart.data.labels.push(label);
    this.accChart.data.datasets[0].data.push(data.train_accuracy);
    this.accChart.data.datasets[1].data.push(data.val_accuracy);
    this.accChart.update();
  },

  onTrainingComplete(data) {
    this.setRunning(false);
    const meta = data.meta;
    document.getElementById('progressSummary').innerHTML = `
      <div style="font-weight:600; color: var(--accent-green);">学習完了</div>
      <div class="mono-sm" style="margin-top:0.25rem">
        精度: ${(meta.best_val_accuracy * 100).toFixed(1)}% |
        所要時間: ${meta.elapsed_seconds.toFixed(0)}秒
      </div>
    `;

    if (data.history) {
      this.resetCharts();
      const h = data.history;
      for (let i = 0; i < h.loss.length; i++) {
        const label = `${i + 1}`;
        this.lossChart.data.labels.push(label);
        this.lossChart.data.datasets[0].data.push(h.loss[i]);
        this.lossChart.data.datasets[1].data.push(h.val_loss[i]);
        this.accChart.data.labels.push(label);
        this.accChart.data.datasets[0].data.push(h.accuracy[i]);
        this.accChart.data.datasets[1].data.push(h.val_accuracy[i]);
      }
      this.lossChart.update();
      this.accChart.update();
    }

    Toast.success(`学習完了: ${meta.model_name} (精度 ${(meta.best_val_accuracy * 100).toFixed(1)}%)`);
    this.loadSavedModels();
  },

  resetCharts() {
    if (!this.lossChart || !this.accChart) return;
    this.lossChart.data.labels = [];
    this.lossChart.data.datasets.forEach(ds => ds.data = []);
    this.accChart.data.labels = [];
    this.accChart.data.datasets.forEach(ds => ds.data = []);
  },

  async startTraining() {
    const pid = AppState.selectedProductId;
    if (!pid) {
      Toast.info('製品を選択してください');
      return;
    }
    const roiId = document.getElementById('trainRoiSelect').value || undefined;
    const params = {
      model_name: document.getElementById('trainModelName').value.trim() || 'model_v1',
      roi_id: roiId,
      epochs: parseInt(document.getElementById('trainEpochs').value) || 20,
      learning_rate: parseFloat(document.getElementById('trainLR').value) || 0.001,
      batch_size: parseInt(document.getElementById('trainBatch').value) || 32,
      validation_split: parseFloat(document.getElementById('trainValSplit').value) || 0.2,
      image_size: parseInt(document.getElementById('trainImageSize').value) || 224,
      freeze_base: document.getElementById('trainFreeze').checked,
      augmentation: this._getAugConfig(),
    };

    try {
      this.resetCharts();
      if (this.lossChart) this.lossChart.update();
      if (this.accChart) this.accChart.update();

      document.getElementById('progressBarContainer').style.display = 'none';
      document.getElementById('metricsGrid').style.display = 'none';

      await apiFetch(`/products/${pid}/training/start`, {
        method: 'POST',
        body: params,
      });
      this.setRunning(true);
      Toast.info('学習を開始しました');
    } catch (e) {
      Toast.error('学習開始に失敗: ' + e.message);
    }
  },

  async stopTraining() {
    try {
      await apiFetch('/training/stop', { method: 'POST' });
      Toast.info('学習停止をリクエストしました');
    } catch (e) {
      Toast.error(e.message);
    }
  },

  setRunning(running) {
    this.isRunning = running;
    document.getElementById('startTrainBtn').disabled = running;
    document.getElementById('startBatchTrainBtn').disabled = running;
    document.getElementById('stopTrainBtn').disabled = !running;
    if (!running) {
      // バッチ進捗はそのまま残す（結果表示）
    }
  },

  async loadSavedModels() {
    const pid = AppState.selectedProductId;
    if (!pid) {
      document.getElementById('savedModelsList').innerHTML = '<div class="history-empty">製品を選択してください</div>';
      return;
    }
    try {
      const data = await apiFetch(`/products/${pid}/models`);
      const list = document.getElementById('savedModelsList');
      if (data.models.length === 0) {
        list.innerHTML = '<div class="history-empty">モデルがありません</div>';
        return;
      }
      list.innerHTML = data.models.map(m => `
        <div class="saved-model-item">
          <div>
            <div class="saved-model-name">${m.model_name}</div>
            <div class="mono-sm">${m.timestamp || ''}</div>
          </div>
          <span class="saved-model-acc">${(m.best_val_accuracy * 100).toFixed(1)}%</span>
          <div class="saved-model-actions">
            <button class="btn btn--sm btn--danger" onclick="TrainingStep.deleteModel('${pid}', '${m.model_name}')">削除</button>
          </div>
        </div>
      `).join('');
    } catch (e) { /* 無視 */ }
  },

  async startBatchTraining() {
    const pid = AppState.selectedProductId;
    if (!pid) {
      Toast.info('製品を選択してください');
      return;
    }
    const params = {
      epochs: parseInt(document.getElementById('trainEpochs').value) || 20,
      learning_rate: parseFloat(document.getElementById('trainLR').value) || 0.001,
      batch_size: parseInt(document.getElementById('trainBatch').value) || 32,
      validation_split: parseFloat(document.getElementById('trainValSplit').value) || 0.2,
      image_size: parseInt(document.getElementById('trainImageSize').value) || 224,
      freeze_base: document.getElementById('trainFreeze').checked,
      augmentation: this._getAugConfig(),
    };

    try {
      this.resetCharts();
      if (this.lossChart) this.lossChart.update();
      if (this.accChart) this.accChart.update();

      document.getElementById('progressBarContainer').style.display = 'none';
      document.getElementById('metricsGrid').style.display = 'none';

      const result = await apiFetch(`/products/${pid}/training/start-batch`, {
        method: 'POST',
        body: params,
      });
      this.setRunning(true);
      Toast.info(result.message);
    } catch (e) {
      Toast.error('一括学習開始に失敗: ' + e.message);
    }
  },

  onBatchProgress(data) {
    const info = document.getElementById('batchProgressInfo');
    info.style.display = 'block';
    info.innerHTML = `
      <span class="batch-progress-label">
        ROI ${data.batch_index + 1} / ${data.batch_total}:
        <strong>${data.roi_name}</strong>
      </span>
    `;
    // 新しいROIが始まるのでチャートをリセット
    this.resetCharts();
    if (this.lossChart) this.lossChart.update();
    if (this.accChart) this.accChart.update();
  },

  onBatchComplete(data) {
    this.setRunning(false);
    const info = document.getElementById('batchProgressInfo');

    const ok = data.results.filter(r => r.status === 'complete').length;
    const ng = data.results.filter(r => r.status === 'error').length;
    let html = `<strong>一括学習完了:</strong> ${ok} 成功`;
    if (ng > 0) html += ` / ${ng} エラー`;

    html += '<div class="batch-results">';
    for (const r of data.results) {
      if (r.status === 'complete') {
        const acc = (r.meta.best_val_accuracy * 100).toFixed(1);
        html += `<div class="batch-result-item batch-result--ok">${r.roi_name}: ${acc}%</div>`;
      } else {
        html += `<div class="batch-result-item batch-result--ng">${r.roi_name}: ${r.error}</div>`;
      }
    }
    html += '</div>';

    info.innerHTML = html;
    Toast.success(`一括学習完了: ${ok} ROI 成功`);
    this.loadSavedModels();
  },

  async deleteModel(productId, name) {
    if (!confirm(`モデル「${name}」を削除しますか？`)) return;
    try {
      await apiFetch(`/products/${productId}/models/${name}`, { method: 'DELETE' });
      Toast.success(`モデル「${name}」を削除しました`);
      this.loadSavedModels();
    } catch (e) {
      Toast.error(e.message);
    }
  },
};
