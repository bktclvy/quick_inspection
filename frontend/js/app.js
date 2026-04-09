/* ============================================================
   メインアプリケーション — 2ページルーティング、AppState初期化
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  // ─── 初期化 ─────────────────────────────────────────
  Toast.init();
  CameraFeed.init();
  CameraFeed.connectInspectionWS();

  // ─── ページナビゲーション（2ページ）──────────────────
  const tabs = document.querySelectorAll('.nav-tab');
  const pages = document.querySelectorAll('.page');

  function switchPage(pageName) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.page === pageName));
    pages.forEach(p => p.classList.toggle('active', p.id === `page-${pageName}`));
    AppState.switchPage(pageName);

    // 検査操作ボタンの表示切替
    const inspControls = document.getElementById('inspectionControls');
    inspControls.style.display = (pageName === 'inspection') ? '' : 'none';

    // カメラフィードをアクティブページにマウント
    if (pageName === 'inspection') {
      CameraFeed.mountTo('inspCameraContainer');
      ROIManager.setMode('readonly');
    } else if (pageName === 'setup') {
      // 学習ステップの場合はカメラ非表示なのでマウントしない
      const panel = document.getElementById('setupCameraPanel');
      if (panel && panel.style.display !== 'none') {
        CameraFeed.mountTo('setupCameraContainer');
      }
      ROIManager.setMode('editable');
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchPage(tab.dataset.page));
  });

  // ─── グローバル製品セレクター ────────────────────────
  const globalSelect = document.getElementById('globalProductSelect');
  globalSelect.addEventListener('change', (e) => {
    AppState.selectProduct(e.target.value || null);
  });

  // 製品一覧が更新されたらセレクター更新
  AppState.on('products', (products) => {
    const current = globalSelect.value;
    globalSelect.innerHTML = '<option value="">-- 選択 --</option>';
    products.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (ROI: ${p.roi_count || 0})`;
      globalSelect.appendChild(opt);
    });
    if (current) globalSelect.value = current;
  });

  // 製品選択が変わったらセレクターを同期
  AppState.on('product', (id) => {
    globalSelect.value = id || '';
  });

  // ─── 各モジュール初期化 ──────────────────────────────
  InspectionPage.init();
  SetupPage.init();
  TrainingStep.init();

  // ─── AppState初期化 ──────────────────────────────────
  await AppState.loadProducts();

  // 検査ページを初期表示、カメラをマウント
  CameraFeed.mountTo('inspCameraContainer');
  ROIManager.setMode('readonly');

  // 検査状態の復元
  InspectionPage.checkInspectionStatus();
});
