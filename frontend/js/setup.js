/* ============================================================
   セットアップページ — ワークフローステッパー統合
   ============================================================ */

const SetupPage = {
  currentStep: 0,
  selectedClass: '',
  selectedRoiId: '',
  recentCaptures: [],

  stepIds: ['step-roi', 'step-template', 'step-dataset', 'step-training', 'step-assign'],

  init() {
    // 製品CRUD
    document.getElementById('addProductBtn').addEventListener('click', () => this.addProduct());
    document.getElementById('newProductName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addProduct();
    });

    // ROI設定
    document.getElementById('setupRoiEditBtn').addEventListener('click', () => {
      if (ROIManager.editMode) {
        ROIManager.disableEditMode();
        document.getElementById('setupRoiEditBtn').textContent = 'ROI追加';
      } else {
        ROIManager.enableEditMode();
        document.getElementById('setupRoiEditBtn').textContent = '完了';
      }
    });

    // パラメータコントロール
    const matchSlider = document.getElementById('matchThreshold');
    const matchVal = document.getElementById('matchThresholdVal');
    matchSlider.addEventListener('input', () => {
      matchVal.textContent = parseFloat(matchSlider.value).toFixed(2);
    });
    matchSlider.addEventListener('change', () => this.saveConfig());

    const removalSlider = document.getElementById('removalThreshold');
    const removalVal = document.getElementById('removalThresholdVal');
    removalSlider.addEventListener('input', () => {
      removalVal.textContent = parseFloat(removalSlider.value).toFixed(2);
    });
    removalSlider.addEventListener('change', () => this.saveConfig());

    document.getElementById('triggerFrames').addEventListener('change', () => this.saveConfig());
    document.getElementById('judgedDisplayMs').addEventListener('change', () => this.saveConfig());
    document.getElementById('triggerMode').addEventListener('change', () => this.saveConfig());

    // データセット撮影
    document.getElementById('captureBtn').addEventListener('click', () => this.capture());
    document.getElementById('addClassBtn').addEventListener('click', () => this.addClass());
    document.getElementById('newClassName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addClass();
    });
    document.getElementById('captureClassSelect').addEventListener('change', (e) => {
      this.selectedClass = e.target.value;
      this.highlightClass(this.selectedClass);
      this.loadThumbnails(this.selectedClass);
    });
    document.getElementById('captureRoiSelect').addEventListener('change', (e) => {
      this.selectedRoiId = e.target.value;
      this.loadClasses();
    });
    document.getElementById('importBtn').addEventListener('click', () => this.importFolder());
    document.getElementById('openDatasetFolderBtn').addEventListener('click', () => this.openFolder());

    // スペースキー（データ収集 or モデル割当テスト）
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        const page = document.querySelector('.page.active');
        if (page && page.id === 'page-setup') {
          if (this.currentStep === 2) {
            e.preventDefault();
            this.capture();
          } else if (this.currentStep === 4) {
            e.preventDefault();
            this.runPredictOnce();
          }
        }
      }
    });

    // モデル割当テストボタン
    document.getElementById('assignTestBtn').addEventListener('click', () => this.runPredictOnce());

    // ステッパーナビゲーション
    document.querySelectorAll('.setup-step').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = parseInt(btn.dataset.step);
        this.goToStep(step);
      });
    });

    // ROI変更通知
    ROIManager.onChange((rois) => {
      this.renderROIPanel(rois);
      this.renderTemplatePanel(rois);
      this.updateRoiSelect(rois);
      this.renderAssignPanel(rois);
      this.updateStepperStates();
    });

    // AppState購読
    AppState.on('product', (id) => {
      this._onProductChange(id);
    });
    AppState.on('products', () => {
      this.renderProductList();
    });
  },

  _onProductChange(productId) {
    ROIManager.setProduct(productId);
    this.currentStep = 0;
    this.goToStep(0);
    if (productId) {
      this.loadConfig();
      this.loadClasses();
    }
    this.highlightProductInList();
  },

  /* ── ステッパー ──────���───────────────────────────── */

  goToStep(step) {
    this.currentStep = step;

    // ステッパーボタン更新
    document.querySelectorAll('.setup-step').forEach(btn => {
      const s = parseInt(btn.dataset.step);
      btn.classList.toggle('active', s === step);
    });

    // パネル表示切替
    this.stepIds.forEach((id, i) => {
      const panel = document.getElementById(id);
      if (panel) panel.classList.toggle('active', i === step);
    });

    // カメラパネル表示制御（学習ステップではカメラ非表示）
    const cameraPanel = document.getElementById('setupCameraPanel');
    if (step === 3) {
      cameraPanel.style.display = 'none';
    } else {
      cameraPanel.style.display = '';
      // セットアップページが表示中ならカメラをマウント
      const page = document.querySelector('.page.active');
      if (page && page.id === 'page-setup') {
        CameraFeed.mountTo('setupCameraContainer');
      }
    }

    // ステップ別の初期化
    if (step === 3) {
      TrainingStep.onStepActivated();
    }
    if (step === 4) {
      this.loadAssignPanel();
    }
  },

  updateStepperStates() {
    const rois = ROIManager.rois;
    const hasRois = rois.length > 0;
    const allTemplates = hasRois && rois.every(r => r.has_template);

    document.querySelectorAll('.setup-step').forEach(btn => {
      const s = parseInt(btn.dataset.step);
      // ready/completed状態の更新
      if (s === 0) {
        btn.classList.toggle('completed', hasRois);
      } else if (s === 1) {
        btn.classList.toggle('disabled', !hasRois);
        btn.classList.toggle('completed', allTemplates);
      } else if (s === 2) {
        btn.classList.toggle('disabled', !allTemplates);
      }
      // ステップ3,4はデータ/モデル有無で判定（簡略化: 常にenabled）
    });
  },

  /* ── 製品管理 ───────────────────────���──────────── */

  renderProductList() {
    const products = AppState.products;
    const list = document.getElementById('productList');
    if (products.length === 0) {
      list.innerHTML = '<div class="history-empty">製品がありません</div>';
      return;
    }
    list.innerHTML = products.map(p => `
      <div class="product-item ${p.id === AppState.selectedProductId ? 'active' : ''}" data-id="${p.id}">
        <span class="product-item__name">${p.name}</span>
        <span class="product-item__info">${p.roi_count || 0} ROI</span>
        <button class="product-item__delete" data-delete="${p.id}" title="削除">&times;</button>
      </div>
    `).join('');

    list.querySelectorAll('.product-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-delete')) return;
        AppState.selectProduct(el.dataset.id);
      });
    });

    list.querySelectorAll('.product-item__delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        if (!confirm('この製品を削除しますか？')) return;
        try {
          await apiFetch(`/products/${id}`, { method: 'DELETE' });
          if (AppState.selectedProductId === id) {
            await AppState.selectProduct(null);
          }
          Toast.success('製品を削除しました');
          await AppState.loadProducts();
        } catch (err) {
          Toast.error(err.message);
        }
      });
    });
  },

  highlightProductInList() {
    document.querySelectorAll('.product-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === AppState.selectedProductId);
    });
  },

  async addProduct() {
    const input = document.getElementById('newProductName');
    const name = input.value.trim();
    if (!name) return;
    try {
      const p = await apiFetch('/products', { method: 'POST', body: { name } });
      input.value = '';
      Toast.success(`製品「${name}���を作成しました`);
      await AppState.loadProducts();
      AppState.selectProduct(p.id);
    } catch (e) {
      Toast.error(e.message);
    }
  },

  /* ── ROIパネル（ステップ1）──────────────────────── */

  renderROIPanel(rois) {
    const panel = document.getElementById('setupRoiList');
    if (!rois || rois.length === 0) {
      panel.innerHTML = '<div class="text-muted" style="padding:8px 0">ROI未設定。「ROI追加」でカメラ上に矩形を描画してください。</div>';
      return;
    }
    panel.innerHTML = rois.map(r => `
      <div class="roi-panel-item" data-roi-id="${r.id}">
        <div class="roi-panel-header">
          <span class="roi-panel-color" style="background:${r.color}"></span>
          <span class="roi-panel-name">${r.name}</span>
          ${r.has_template ? '<span class="roi-panel-tpl">TPL</span>' : ''}
          ${r.model_name ? `<span class="roi-panel-model">${r.model_name}</span>` : ''}
        </div>
        <div class="roi-panel-actions">
          <button class="btn btn--xs btn--danger roi-del-btn" data-roi="${r.id}">削除</button>
        </div>
      </div>
    `).join('');

    rois.forEach(roi => {
      const delBtn = document.querySelector(`.roi-del-btn[data-roi="${roi.id}"]`);
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          if (confirm(`ROI「${roi.name}」を削除しますか���`)) {
            ROIManager.deleteROI(roi.id);
          }
        });
      }
    });
  },

  /* ── テンプレートパネル（ステップ2）─────────────── */

  renderTemplatePanel(rois) {
    const panel = document.getElementById('templateList');
    if (!rois || rois.length === 0) {
      panel.innerHTML = '<div class="text-muted" style="padding:8px 0">先にROIを設定してくだ���い。</div>';
      return;
    }
    const pid = AppState.selectedProductId;
    panel.innerHTML = rois.map(r => `
      <div class="template-item">
        <div class="template-header">
          <span class="roi-panel-color" style="background:${r.color}"></span>
          <span class="template-name">${r.name}</span>
          ${r.has_template ? '<span class="roi-panel-tpl">撮影済み</span>' : '<span class="text-muted">未撮��</span>'}
        </div>
        ${r.has_template && pid ?
          `<img class="template-preview" src="/api/products/${pid}/rois/${r.id}/template?t=${Date.now()}" alt="Template">` : ''}
        <button class="btn btn--sm btn--primary template-capture-btn" data-roi="${r.id}">基準撮影</button>
      </div>
    `).join('');

    panel.querySelectorAll('.template-capture-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await ROIManager.captureTemplate(btn.dataset.roi);
        Toast[ok ? 'success' : 'error'](ok ? '基準画像を撮影しました' : '撮影失敗');
      });
    });
  },

  /* ── データ収集（ステップ3）────���─────────────────── */

  updateRoiSelect(rois) {
    const select = document.getElementById('captureRoiSelect');
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

  async loadClasses() {
    const pid = AppState.selectedProductId;
    if (!pid) return;
    try {
      let url = `/products/${pid}/dataset/classes`;
      if (this.selectedRoiId) url += `?roi_id=${this.selectedRoiId}`;
      const data = await apiFetch(url);
      this.renderClasses(data.classes);
      this.updateClassSelect(data.classes);
    } catch (e) {
      // 製品にデータセットがまだない場合がある
    }
  },

  renderClasses(classes) {
    const list = document.getElementById('classList');
    if (!classes || classes.length === 0) {
      list.innerHTML = '<div class="history-empty">クラスがありません</div>';
      return;
    }
    list.innerHTML = classes.map(c => {
      const j = (c.judgment || 'ng').toUpperCase();
      const jClass = c.judgment === 'ok' ? 'judgment-ok' : 'judgment-ng';
      return `
      <div class="class-item ${c.name === this.selectedClass ? 'active' : ''}" data-class="${c.name}">
        <span class="class-item__judgment ${jClass}">${j}</span>
        <span class="class-item__name">${c.name}</span>
        <span class="class-item__count">${c.count} 枚</span>
        <button class="class-item__delete" data-delete="${c.name}" title="削除">&times;</button>
      </div>`;
    }).join('');

    list.querySelectorAll('.class-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-delete')) return;
        const name = el.dataset.class;
        this.selectedClass = name;
        document.getElementById('captureClassSelect').value = name;
        this.highlightClass(name);
        this.loadThumbnails(name);
      });
    });

    list.querySelectorAll('.class-item__delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.delete;
        if (!confirm(`クラス「${name}」を削除しますか？`)) return;
        try {
          const pid = AppState.selectedProductId;
          let url = `/products/${pid}/dataset/class/${name}`;
          if (this.selectedRoiId) url += `?roi_id=${this.selectedRoiId}`;
          await apiFetch(url, { method: 'DELETE' });
          Toast.success(`クラス「${name}」を削除しま���た`);
          this.loadClasses();
        } catch (err) {
          Toast.error(err.message);
        }
      });
    });
  },

  updateClassSelect(classes) {
    const select = document.getElementById('captureClassSelect');
    const current = select.value;
    select.innerHTML = '<option value="">-- 選択 --</option>';
    (classes || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      const j = (c.judgment || 'ng').toUpperCase();
      opt.textContent = `[${j}] ${c.name} (${c.count})`;
      select.appendChild(opt);
    });
    if (current && classes.some(c => c.name === current)) {
      select.value = current;
    }
  },

  highlightClass(name) {
    document.querySelectorAll('.class-item').forEach(el => {
      el.classList.toggle('active', el.dataset.class === name);
    });
  },

  async addClass() {
    const pid = AppState.selectedProductId;
    if (!pid) {
      Toast.info('先に製品を選択してください');
      return;
    }
    const input = document.getElementById('newClassName');
    const name = input.value.trim();
    if (!name) return;

    const judgment = document.getElementById('newClassJudgment').value;
    try {
      const body = { class_name: name, judgment };
      if (this.selectedRoiId) body.roi_id = this.selectedRoiId;
      await apiFetch(`/products/${pid}/dataset/class`, {
        method: 'POST',
        body,
      });
      input.value = '';
      Toast.success(`クラス「${name}」(${judgment.toUpperCase()}) を作成しました`);
      this.loadClasses();
    } catch (e) {
      Toast.error(e.message);
    }
  },

  async capture() {
    const pid = AppState.selectedProductId;
    if (!pid) {
      Toast.info('先に製品を選択してください');
      return;
    }
    if (!this.selectedClass) {
      Toast.info('撮影先のクラスを選���してください');
      return;
    }

    CameraFeed.triggerFlash();
    AudioFeedback.play('capture');

    try {
      const body = { class_name: this.selectedClass };
      if (this.selectedRoiId) body.roi_id = this.selectedRoiId;
      const result = await apiFetch(`/products/${pid}/dataset/capture`, {
        method: 'POST',
        body,
      });
      Toast.success(`${this.selectedClass} に撮影しました (${result.count} 枚)`);
      this.loadClasses();

      this.recentCaptures.unshift({
        class_name: result.class_name,
        filename: result.filename,
      });
      if (this.recentCaptures.length > 12) this.recentCaptures.pop();
      this.renderThumbnails();
    } catch (e) {
      Toast.error('撮影に失敗: ' + e.message);
    }
  },

  async importFolder() {
    const pid = AppState.selectedProductId;
    if (!pid || !this.selectedClass) {
      Toast.info('製品とクラス��選択してください');
      return;
    }
    Toast.info('フォルダを選択してください...');
    try {
      const body = { class_name: this.selectedClass };
      if (this.selectedRoiId) body.roi_id = this.selectedRoiId;
      const result = await apiFetch(`/products/${pid}/dataset/import-folder`, {
        method: 'POST',
        body,
      });
      if (result.imported > 0) {
        Toast.success(result.message);
        this.loadClasses();
        this.loadThumbnails(this.selectedClass);
      } else {
        Toast.info(result.message);
      }
    } catch (e) {
      Toast.error('インポートに失敗: ' + e.message);
    }
  },

  async openFolder() {
    const pid = AppState.selectedProductId;
    if (!pid) return;
    try {
      await apiFetch(`/open-folder/datasets?product_id=${pid}`);
    } catch (e) {
      Toast.error(e.message);
    }
  },

  async loadThumbnails(className) {
    const pid = AppState.selectedProductId;
    if (!className || !pid) return;
    try {
      let url = `/products/${pid}/dataset/images/${className}`;
      if (this.selectedRoiId) url += `?roi_id=${this.selectedRoiId}`;
      const data = await apiFetch(url);
      this.recentCaptures = data.images.slice(0, 12).map(f => ({
        class_name: className,
        filename: f,
      }));
      this.renderThumbnails();
    } catch (e) { /* 無視 */ }
  },

  renderThumbnails() {
    const grid = document.getElementById('thumbnailGrid');
    if (this.recentCaptures.length === 0) {
      grid.innerHTML = '<div class="history-empty">まだ撮影がありません</div>';
      return;
    }
    const pid = AppState.selectedProductId;
    const roiParam = this.selectedRoiId ? `&roi_id=${this.selectedRoiId}` : '';
    grid.innerHTML = this.recentCaptures.map(c => `
      <div class="thumbnail-item" data-class="${c.class_name}" data-file="${c.filename}">
        <img src="/api/products/${pid}/dataset/file/${c.class_name}/${c.filename}?_=${Date.now()}${roiParam}" alt="${c.filename}" loading="lazy">
      </div>
    `).join('');

    grid.querySelectorAll('.thumbnail-item').forEach(el => {
      el.addEventListener('click', async () => {
        const cls = el.dataset.class;
        const file = el.dataset.file;
        try {
          const delBody = { class_name: cls, filename: file };
          if (this.selectedRoiId) delBody.roi_id = this.selectedRoiId;
          await apiFetch(`/products/${pid}/dataset/delete-image`, {
            method: 'POST',
            body: delBody,
          });
          el.remove();
          this.loadClasses();
          Toast.info('画像を削除しました');
        } catch (e) {
          Toast.error(e.message);
        }
      });
    });
  },

  /* ── モデル割当パネル（ステップ5）─────────────── */

  async loadAssignPanel() {
    const pid = AppState.selectedProductId;
    if (!pid) return;
    // モデル一覧を取得してから描画
    try {
      const data = await apiFetch(`/products/${pid}/models`);
      this.renderAssignPanel(ROIManager.rois, data.models || []);
    } catch (e) {
      this.renderAssignPanel(ROIManager.rois, []);
    }
    TrainingStep.loadSavedModels();
  },

  renderAssignPanel(rois, models) {
    const panel = document.getElementById('assignRoiList');
    if (!panel) return;
    if (!rois || rois.length === 0) {
      panel.innerHTML = '<div class="text-muted" style="padding:8px 0">先にROIを設定してください。</div>';
      return;
    }
    // modelsが渡されない場合は空配列
    if (!models) models = [];

    panel.innerHTML = rois.map(r => `
      <div class="assign-roi-item">
        <span class="assign-roi-color" style="background:${r.color}"></span>
        <span class="assign-roi-name">${r.name}</span>
        <select class="select-sm assign-roi-select" data-roi="${r.id}">
          <option value="">モデル未割当</option>
          ${models.map(m => `<option value="${m.model_name}" ${r.model_name === m.model_name ? 'selected' : ''}>${m.model_name} (${(m.best_val_accuracy * 100).toFixed(1)}%)</option>`).join('')}
        </select>
        <span class="assign-roi-status ${r.model_name ? 'assigned' : 'unassigned'}">${r.model_name ? '割当済' : '未割当'}</span>
      </div>
    `).join('');

    panel.querySelectorAll('.assign-roi-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const roiId = sel.dataset.roi;
        const modelName = sel.value || null;
        await ROIManager.assignModel(roiId, modelName);
        Toast.success(modelName ? `${modelName} を割���当てました` : 'モデル割当を解除しました');
      });
    });
  },

  async runPredictOnce() {
    const pid = AppState.selectedProductId;
    if (!pid) { Toast.info('製品を選択してください'); return; }

    const btn = document.getElementById('assignTestBtn');
    btn.disabled = true;
    btn.textContent = '推論中...';

    try {
      const data = await apiFetch(`/products/${pid}/predict-once`, { method: 'POST' });
      const container = document.getElementById('assignTestResults');
      container.innerHTML = data.results.map(r => {
        if (r.error) {
          return `<div class="assign-test-result-item">
            <span class="assign-roi-color" style="background:${this._getRoiColor(r.roi_id)}"></span>
            <span>${r.roi_name}</span>
            <span class="text-muted">${r.error}</span>
          </div>`;
        }
        const jClass = r.judgment === 'ok' ? 'ok' : 'ng';
        return `<div class="assign-test-result-item">
          <span class="assign-roi-color" style="background:${this._getRoiColor(r.roi_id)}"></span>
          <span>${r.roi_name}</span>
          <span class="test-result-judgment ${jClass}">${r.judgment.toUpperCase()}</span>
          <span>${r.predicted_class}</span>
          <span class="test-result-confidence">${(r.confidence * 100).toFixed(1)}%</span>
        </div>`;
      }).join('');
    } catch (e) {
      Toast.error('検査テスト失敗: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '検査テスト';
    }
  },

  _getRoiColor(roiId) {
    const roi = (ROIManager.rois || []).find(r => r.id === roiId);
    return roi ? roi.color : '#999';
  },

  /* ── 設定 ──────────────────────────────────────────── */

  async loadConfig() {
    const pid = AppState.selectedProductId;
    if (!pid) return;
    try {
      const cfg = await apiFetch(`/products/${pid}/config`);
      document.getElementById('matchThreshold').value = cfg.match_threshold;
      document.getElementById('matchThresholdVal').textContent = cfg.match_threshold.toFixed(2);
      document.getElementById('triggerFrames').value = cfg.trigger_frames;
      document.getElementById('removalThreshold').value = cfg.removal_threshold;
      document.getElementById('removalThresholdVal').textContent = cfg.removal_threshold.toFixed(2);
      document.getElementById('judgedDisplayMs').value = cfg.judged_display_ms;
      document.getElementById('triggerMode').value = cfg.trigger_mode;
    } catch (e) { /* 無視 */ }
  },

  async saveConfig() {
    const pid = AppState.selectedProductId;
    if (!pid) return;
    try {
      await apiFetch(`/products/${pid}/config`, {
        method: 'PUT',
        body: {
          match_threshold: parseFloat(document.getElementById('matchThreshold').value),
          trigger_frames: parseInt(document.getElementById('triggerFrames').value),
          removal_threshold: parseFloat(document.getElementById('removalThreshold').value),
          judged_display_ms: parseInt(document.getElementById('judgedDisplayMs').value),
          trigger_mode: document.getElementById('triggerMode').value,
        },
      });
    } catch (e) {
      Toast.error('設定の保存に失敗: ' + e.message);
    }
  },
};
