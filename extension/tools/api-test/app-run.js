// UI · Kiểm thử API — Runner: phạm vi chạy (request / folder / collection / preset), kiểm tra trước khi chạy, chạy qua
// ApiEngine (tuần tự theo phụ thuộc, song song khi an toàn), kết quả + evidence + export, chạy lại case lỗi, Run Preset.
(() => {
  const { $, $$, esc, toast, debounce } = Ui;
  const App = window.App;
  const PAGE_SIZES = [25, 50, 100];
  const STATUS_BADGE = { PASS: 'badge-success', FAIL: 'badge-error', ERROR: 'badge-warning', SKIPPED: 'badge-skip' };
  const STATUS_ICON = { PASS: 'check_circle', FAIL: 'cancel', ERROR: 'error', SKIPPED: 'skip_next' };
  const badge = st => (st ? `<span class="badge ${STATUS_BADGE[st]}"><span class="ms sm" aria-hidden="true">${STATUS_ICON[st]}</span> ${st}</span>` : '<span class="badge badge-skip"><span class="ms sm spin" aria-hidden="true">progress_activity</span> Đang chạy</span>');
  const reportBusy = busy => { try { if (parent !== window) parent.postMessage({ type: 'tool-busy', busy }, '*'); } catch {} };
  const defaultCfg = () => ({ scope: { type: 'collection', collectionId: null, targets: [] }, envId: null, mode: 'sequential', concurrency: 3, timeout: 30000, delay: 0, priorities: [], stopOnCritical: false, retryErrors: 0, useSessionVars: false, presetId: null });
  const R = { cfg: defaultCfg(), plan: null, checks: { scripts: new Map(), perms: new Map() }, run: null, runtime: null, f: { status: 'all', request: '', folder: null, q: '', page: 0, size: 50 }, token: 0 };
  App.runActive = () => !!R.run?.running;

  App.initRun = () => {
    const W = App.W;
    const saved = W.meta.ui.runner;
    if (saved && typeof saved === 'object') R.cfg = { ...defaultCfg(), ...saved, scope: { ...defaultCfg().scope, ...(saved.scope || {}) } };
    if (W.lastRun) R.run = { ...W.lastRun, running: false, restored: true };
    $('#navRunDot').classList.toggle('hidden', !R.run);
    App.on('vars', () => { if (App.state.nav === 'run' && !R.run?.running) renderPreRun(); });
    App.on('env', () => { if (App.state.nav === 'run' && !R.run?.running) renderRun(); });
    App.on('suite', () => { if (App.state.nav === 'run' && !R.run?.running) renderPreRun(); });
  };
  const saveCfg = () => { App.W.meta.ui.runner = JSON.parse(JSON.stringify(R.cfg)); App.saveUi(); };

  // ---------- Phạm vi ----------
  function scopeIds() {
    const W = App.W, sc = R.cfg.scope;
    if (sc.type === 'requests') return sc.ids.filter(id => W.get(id)?.type === 'request');
    if (!sc.collectionId || !W.get(sc.collectionId)) return [];
    return ApiEngine.requestsFor(W, sc.collectionId, sc.targets.filter(t => W.get(t)));
  }
  function scopeLabel() {
    const W = App.W, sc = R.cfg.scope;
    if (sc.type === 'requests') { const ids = scopeIds(); return ids.length === 1 ? `Request “${W.get(ids[0]).name}”` : `${ids.length} request`; }
    const col = W.get(sc.collectionId);
    if (!col) return 'Chưa chọn';
    const t = sc.targets.filter(x => W.get(x));
    return t.length ? `${col.name} › ${t.map(x => W.get(x).name).join(', ')}` : `Collection “${col.name}”`;
  }
  // Mở Runner với phạm vi cho trước; start = chạy luôn nếu không có lỗi chặn
  App.runScope = ({ collectionId, targets = [], ids = null, start = true } = {}) => {
    if (R.run?.running) { App.setNav('run'); toast('Đang chạy: đợi xong hoặc bấm Stop', 'warn'); return; }
    R.cfg.scope = ids ? { type: 'requests', ids } : { type: 'collection', collectionId, targets };
    R.cfg.presetId = null;
    saveCfg();
    App.setNav('run');
    if (start) setTimeout(() => startRun({ auto: true }), 0);
  };
  App.runRequest = id => {
    const n = App.W.get(id);
    if (!n) return;
    const col = App.W.collectionOf(id);
    App.runScope(col ? { collectionId: col.id, targets: [id] } : { ids: [id] });
  };

  // ================= VẼ RUNNER =================
  function renderRun() {
    const box = $('#view-run');
    const W = App.W;
    const running = !!R.run?.running;
    const cols = W.collections();
    const sc = R.cfg.scope;
    if (sc.type === 'collection' && !W.get(sc.collectionId)) sc.collectionId = cols[0]?.id || null;
    const presets = W.presetList();
    const envs = W.envList();
    const curPreset = R.cfg.presetId && W.preset(R.cfg.presetId);
    const lock = running ? ' disabled' : '';
    box.innerHTML = `
      <section class="run-results ${R.run ? '' : 'hidden'}" id="runResults" aria-label="Kết quả"></section>
      <div class="view-head pad">
        <div><p class="eyebrow">Runner</p><h2>${R.run ? 'Lần chạy tiếp theo' : 'Chạy test'} ${App.helpBtn?.('runner', 'Hướng dẫn Runner & Preset') || ''}</h2></div>
      </div>
      ${App.tip?.('runner', '<b>3 bước:</b> ① chọn <b>Chạy gì</b> (collection, tích folder / request) → ② xem <b>Kiểm tra trước khi chạy</b>, sửa mục đỏ → ③ <b>Run</b>. Chạy ổn rồi thì <b>Lưu cấu hình thành preset</b> để lần sau chỉ cần bấm Run.', 'runner') || ''}
      <div class="run-wrap">
        <section class="card run-cfg" aria-labelledby="presetH">
          <div class="sec-h row"><h3 id="presetH"><span class="ms sm" aria-hidden="true">bookmarks</span>Preset</h3><span class="spacer"></span>
            <button type="button" class="btn btn-sm" data-run-act="save-preset"${lock}><span class="ms sm" aria-hidden="true">bookmark_add</span>${curPreset ? 'Lưu thành preset mới' : 'Lưu cấu hình thành preset'}</button></div>
          ${presets.length ? `<div class="preset-list">${presets.map(p => {
            const col = W.get(p.collectionId);
            return `<div class="preset${p.id === R.cfg.presetId ? ' on' : ''}">
              <button type="button" class="preset-main" data-preset="${esc(p.id)}"${lock}><b>${esc(p.name)}</b><span class="muted small">${esc(col ? col.name : 'Collection đã xoá')}${p.targets.length ? ` · ${p.targets.length} mục` : ''} · ${esc(W.envs[p.envId]?.name || 'env đang dùng')}</span></button>
              <button type="button" class="btn btn-sm btn-primary" data-preset-run="${esc(p.id)}"${lock}${col ? '' : ' disabled'} title="Chọn preset và Run"><span class="ms sm fill" aria-hidden="true">play_arrow</span><span class="lbl">Run</span></button>
              <button type="button" class="icon-btn" data-preset-menu="${esc(p.id)}" aria-haspopup="menu" aria-label="Thao tác với preset ${esc(p.name)}"${lock}><span class="ms sm" aria-hidden="true">more_vert</span></button>
            </div>`;
          }).join('')}</div>` : '<p class="muted small">Chưa có preset. Lưu cấu hình chạy (vd Smoke, Regression) để lần sau chỉ cần chọn rồi Run.</p>'}
          ${curPreset && presetDirty(curPreset) ? `<div class="d-msg warn"><span class="ms sm" aria-hidden="true">edit</span><span>Cấu hình đã khác preset <b>${esc(curPreset.name)}</b>.</span><button type="button" class="btn btn-sm" data-run-act="update-preset"${lock}>Lưu thay đổi vào preset</button></div>` : ''}

          <div class="sec-h"><h3><span class="ms sm" aria-hidden="true">account_tree</span>Chạy gì</h3></div>
          ${sc.type === 'requests' ? `<p class="small">${esc(scopeLabel())} <button type="button" class="link-btn" data-run-act="to-collection"${lock}>Chọn theo collection</button></p>`
            : cols.length ? `<label for="runCol">Collection</label><select id="runCol"${lock}>${cols.map(c => `<option value="${esc(c.id)}"${c.id === sc.collectionId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              <div class="scope-tree" id="scopeTree" role="group" aria-label="Chọn folder / request">${scopeTreeHtml(lock)}</div>
              <p class="muted small">${sc.targets.length ? `Đang chọn ${sc.targets.length} mục. <button type="button" class="link-btn" data-run-act="all"${lock}>Chạy cả collection</button>` : 'Không tích mục nào = chạy cả collection.'} Mục đang tắt (<span class="ms sm inline-ic" aria-hidden="true">block</span>) luôn bị bỏ qua.</p>`
              : `<div class="empty-state small"><span class="ms lg" aria-hidden="true">inventory_2</span><h3>Chưa có collection</h3><p class="muted">Lưu request vào collection để chạy nhiều request cùng lúc.</p><button type="button" class="btn btn-primary btn-sm" data-run-act="new-col">Tạo collection</button></div>`}

          <div class="sec-h"><h3><span class="ms sm" aria-hidden="true">tune</span>Cách chạy</h3></div>
          <div class="form-grid two">
            <div><label for="runEnv">Environment</label><select id="runEnv"${lock}><option value="">Đang dùng${W.activeEnv() ? `: ${esc(W.activeEnv().name)}` : ' (không có)'}</option>${envs.map(e => `<option value="${esc(e.id)}"${e.id === R.cfg.envId ? ' selected' : ''}>${esc(e.name)}${W.isProdEnv(e) ? ' · PROD' : ''}</option>`).join('')}</select></div>
            <div><label for="runMode">Chế độ</label><select id="runMode"${lock}><option value="sequential"${R.cfg.mode === 'sequential' ? ' selected' : ''}>Tuần tự (an toàn, khuyên dùng)</option><option value="parallel"${R.cfg.mode === 'parallel' ? ' selected' : ''}>Song song khi an toàn</option></select></div>
          </div>
          <details class="adv" id="runAdv">
            <summary><span class="ms sm chev" aria-hidden="true">chevron_right</span>Tuỳ chọn nâng cao <span class="muted small">Timeout ${R.cfg.timeout / 1000}s${R.cfg.mode === 'parallel' ? ` · ${R.cfg.concurrency} luồng` : ''}${R.cfg.delay ? ` · nghỉ ${R.cfg.delay} ms` : ''}${R.cfg.priorities.length ? ` · ${R.cfg.priorities.join('/')}` : ''}</span></summary>
            <div class="form-grid three">
              <div><label for="runTimeout">Timeout <span class="hint">ms / request</span></label><input id="runTimeout" type="number" min="1000" max="120000" value="${R.cfg.timeout}" inputmode="numeric"${lock}></div>
              <div><label for="runConc">Số luồng song song <span class="hint">1–5</span></label><input id="runConc" type="number" min="1" max="5" value="${R.cfg.concurrency}" inputmode="numeric"${R.cfg.mode === 'parallel' ? lock : ' disabled'}></div>
              <div><label for="runDelay">Nghỉ giữa request <span class="hint">ms</span></label><input id="runDelay" type="number" min="0" max="60000" value="${R.cfg.delay}" inputmode="numeric"${lock}></div>
            </div>
            <div class="prio-pick" role="group" aria-label="Chỉ chạy priority"><span class="label">Chỉ chạy priority</span>${ApiSchema.PRIORITIES.map(p => `<label class="chip-check"><input type="checkbox" data-prio="${p}" ${R.cfg.priorities.includes(p) ? 'checked' : ''}${lock}> ${p}</label>`).join('')}<span class="muted small">(không tích = mọi priority)</span></div>
            <label class="check"><input type="checkbox" id="runStop" ${R.cfg.stopOnCritical ? 'checked' : ''}${lock}> Dừng sớm khi một case <b>P0</b> FAIL / ERROR</label>
            <div class="inline-field"><label for="runRetry">Tự thử lại lỗi mạng / timeout</label><select id="runRetry"${lock}>${[0, 1, 2].map(x => `<option value="${x}"${R.cfg.retryErrors === x ? ' selected' : ''}>${x ? `${x} lần` : 'Không'}</option>`).join('')}</select><span class="muted small">chỉ GET / HEAD / OPTIONS; request ghi dữ liệu không bao giờ tự thử lại</span></div>
            <label class="check"><input type="checkbox" id="runSess" ${R.cfg.useSessionVars ? 'checked' : ''}${lock}> Bắt đầu với Runtime variables của phiên <span class="muted small">(${Object.keys(W.runtime()).length} biến do Send đặt; mặc định chạy sạch)</span></label>
          </details>
        </section>

        <section class="card prerun" id="preRun" aria-live="polite"></section>
      </div>`;
    renderPreRun();
    renderResults();
  }
  App.renderRun = renderRun;
  function scopeTreeHtml(lock) {
    const W = App.W, sc = R.cfg.scope;
    const sel = new Set(sc.targets);
    const rows = [];
    const walk = (n, d, inherited) => {
      for (const c of W.children(n.id)) {
        const on = sel.has(c.id) || inherited;
        rows.push(`<label class="scope-row${c.enabled === false ? ' off' : ''}" style="--lvl:${d}"><input type="checkbox" data-target="${esc(c.id)}" ${on ? 'checked' : ''}${inherited || c.enabled === false ? ' disabled' : lock}>
          ${c.type === 'request' ? Ui.methodTag(c.method) : '<span class="ms sm" aria-hidden="true">folder</span>'}<span class="sr-name">${esc(c.name)}</span>
          ${c.enabled === false ? '<span class="ms sm muted" title="Đang tắt khi chạy" aria-label="Đang tắt">block</span>' : c.type === 'request' ? `<span class="muted small">${W.suite(c.id)?.cases.length || 'mặc định 2xx'}</span>` : ''}</label>`);
        if (c.type === 'folder' && c.enabled !== false) walk(c, d + 1, on);
      }
    };
    const col = W.get(sc.collectionId);
    if (col) walk(col, 0, false);
    return rows.join('') || '<p class="muted small">Collection trống.</p>';
  }
  function presetDirty(p) {
    const c = R.cfg;
    return p.collectionId !== (c.scope.type === 'collection' ? c.scope.collectionId : null) || JSON.stringify(p.targets) !== JSON.stringify(c.scope.targets || [])
      || (p.envId || null) !== (c.envId || null) || p.mode !== c.mode || p.concurrency !== c.concurrency || p.timeout !== c.timeout || p.delay !== c.delay
      || JSON.stringify(p.priorities) !== JSON.stringify(c.priorities) || p.stopOnCritical !== c.stopOnCritical || p.retryErrors !== c.retryErrors || p.useSessionVars !== c.useSessionVars;
  }
  const presetData = () => {
    const c = R.cfg;
    return { collectionId: c.scope.collectionId, targets: [...c.scope.targets], envId: c.envId || null, mode: c.mode, concurrency: c.concurrency, timeout: c.timeout, delay: c.delay,
      priorities: [...c.priorities], stopOnCritical: c.stopOnCritical, retryErrors: c.retryErrors, useSessionVars: c.useSessionVars };
  };
  function loadPreset(id) {
    const p = App.W.preset(id);
    if (!p) return;
    R.cfg = { ...defaultCfg(), scope: { type: 'collection', collectionId: p.collectionId, targets: [...p.targets] }, envId: p.envId, mode: p.mode, concurrency: p.concurrency,
      timeout: p.timeout, delay: p.delay, priorities: [...p.priorities], stopOnCritical: p.stopOnCritical, retryErrors: p.retryErrors, useSessionVars: p.useSessionVars, presetId: p.id };
    saveCfg();
  }

  // ---------- Thay đổi cấu hình ----------
  const num = (v, min, max, d) => { const n = Number(v); return v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };
  $('#view-run').addEventListener('change', e => {
    if (R.run?.running) return;
    const t = e.target, c = R.cfg;
    if (t.id === 'runCol') { c.scope = { type: 'collection', collectionId: t.value, targets: [] }; }
    else if (t.dataset.target) {
      const id = t.dataset.target;
      if (t.checked) {
        // Chọn folder → bỏ các mục con đã chọn riêng (đã nằm trong folder)
        const sub = new Set(App.W.descendants(id).map(x => x.id));
        c.scope.targets = [...c.scope.targets.filter(x => !sub.has(x)), id];
      } else c.scope.targets = c.scope.targets.filter(x => x !== id);
    }
    else if (t.id === 'runEnv') c.envId = t.value || null;
    else if (t.id === 'runMode') c.mode = t.value;
    else if (t.id === 'runTimeout') c.timeout = num(t.value, 1000, 120000, 30000);
    else if (t.id === 'runConc') c.concurrency = num(t.value, 1, 5, 3);
    else if (t.id === 'runDelay') c.delay = num(t.value, 0, 60000, 0);
    else if (t.dataset.prio) c.priorities = $$('[data-prio]:checked').map(x => x.dataset.prio);
    else if (t.id === 'runStop') c.stopOnCritical = t.checked;
    else if (t.id === 'runRetry') c.retryErrors = Number(t.value);
    else if (t.id === 'runSess') c.useSessionVars = t.checked;
    else return;
    saveCfg();
    const adv = $('#runAdv')?.open;
    const focusSel = t.id ? '#' + t.id : t.dataset.target ? `[data-target="${CSS.escape(t.dataset.target)}"]` : t.dataset.prio ? `[data-prio="${t.dataset.prio}"]` : null;
    renderRun();
    if (adv) $('#runAdv').open = true;
    if (focusSel) $(focusSel)?.focus();
  });
  $('#view-run').addEventListener('click', async e => {
    const W = App.W;
    const pr = e.target.closest('[data-preset]');
    if (pr) { loadPreset(pr.dataset.preset); renderRun(); toast(`Đã chọn preset ${W.preset(pr.dataset.preset).name}`, 'info', 2000); return; }
    const prr = e.target.closest('[data-preset-run]');
    if (prr) { loadPreset(prr.dataset.presetRun); renderRun(); startRun({ auto: true }); return; }
    const pm = e.target.closest('[data-preset-menu]');
    if (pm) { presetMenu(pm.dataset.presetMenu, pm); return; }
    const fx = e.target.closest('[data-fix]');
    if (fx) { applyFix(JSON.parse(fx.dataset.fix), fx); return; }
    const a = e.target.closest('[data-run-act]')?.dataset.runAct;
    if (!a) return;
    if (a === 'run') startRun();
    else if (a === 'stop') { R.run?.ctrl?.abort(); toast('Đang dừng: case đang chạy kết thúc ngay, các case còn lại là SKIPPED', 'warn'); }
    else if (a === 'all') { R.cfg.scope.targets = []; saveCfg(); renderRun(); }
    else if (a === 'to-collection') { R.cfg.scope = { type: 'collection', collectionId: W.collections()[0]?.id || null, targets: [] }; saveCfg(); renderRun(); }
    else if (a === 'new-col') App.newCollection();
    else if (a === 'save-preset') {
      const name = await Ui.promptBox({ title: 'Lưu cấu hình thành preset', label: 'Tên preset', placeholder: 'vd Smoke Test, Regression, Health Check', okText: 'Lưu',
        hint: 'Preset lưu: collection, mục được chọn, environment, chế độ chạy và tuỳ chọn. Không lưu token / giá trị bí mật.' });
      if (!name) return;
      if (R.cfg.scope.type !== 'collection' || !R.cfg.scope.collectionId) { toast('Preset cần chọn theo collection', 'warn'); return; }
      const p = W.createPreset({ name, ...presetData() });
      R.cfg.presetId = p.id;
      saveCfg();
      renderRun();
      toast(`Đã lưu preset ${name}`, 'ok', 2500);
    } else if (a === 'update-preset') {
      W.updatePreset(R.cfg.presetId, presetData());
      renderRun();
      toast('Đã lưu thay đổi vào preset', 'ok', 2000);
    } else if (a === 'xlsx' || a === 'zip') exportRun(e.target.closest('[data-run-act]'), a);
    else if (a === 'retry-fail' || a === 'retry-error') retry(a === 'retry-fail' ? 'FAIL' : 'ERROR');
    else if (a === 'rerun') { R.cfg.presetId = R.run?.presetId && W.preset(R.run.presetId) ? R.run.presetId : R.cfg.presetId; startRun(); }
    else if (a === 'clear') {
      const ok = await Ui.confirmBox('Xoá kết quả?', '<p>Kết quả lần chạy gần nhất sẽ bị xoá khỏi máy. Nên Export trước nếu cần lưu bằng chứng.</p>', 'Xoá');
      if (!ok) return;
      R.run = null;
      R.runtime = null;
      W.saveLastRun(null);
      $('#navRunDot').classList.add('hidden');
      renderRun();
    }
  });
  function presetMenu(id, anchor) {
    const W = App.W, p = W.preset(id);
    Ui.menu(anchor, [
      { label: 'Đổi tên', icon: 'edit', action: async () => { const v = await Ui.promptBox({ title: 'Đổi tên preset', label: 'Tên', value: p.name }); if (v) { W.updatePreset(id, { name: v }); renderRun(); } } },
      { label: 'Nhân bản', icon: 'content_copy', action: () => { const c = W.createPreset({ ...p, name: `${p.name} (bản sao)` }); loadPreset(c.id); renderRun(); } },
      { label: 'Ghi cấu hình hiện tại vào preset', icon: 'save', action: () => { W.updatePreset(id, presetData()); loadPreset(id); renderRun(); toast('Đã cập nhật preset', 'ok', 2000); } },
      'sep',
      { label: 'Xoá', icon: 'delete', danger: true, action: async () => {
        const ok = await Ui.confirmBox(`Xoá preset ${p.name}?`, '<p>Chỉ xoá cấu hình chạy, không xoá request hay test case. Có thể hoàn tác ngay sau khi xoá.</p>', 'Xoá');
        if (!ok) return;
        const snap = W.removePreset(id);
        if (R.cfg.presetId === id) { R.cfg.presetId = null; saveCfg(); }
        renderRun();
        toast(`Đã xoá preset ${p.name}`, 'info', 10000, { label: 'Hoàn tác', fn: () => { W.restorePreset(snap); renderRun(); } });
      } },
    ]);
  }

  // ================= KIỂM TRA TRƯỚC KHI CHẠY =================
  function buildPlan(extra = {}) {
    const W = App.W, c = R.cfg;
    return ApiEngine.plan(W, {
      requestIds: extra.requestIds || scopeIds(), envId: c.envId || W.meta.activeEnvId, priorities: c.priorities, mode: c.mode,
      runtime: extra.runtime || (c.useSessionVars ? W.runtime() : {}), only: extra.only,
    });
  }
  // Kiểm tra cần chờ: cú pháp script (sandbox) và quyền host của Chrome
  async function asyncChecks(plan) {
    const errs = [];
    for (const x of plan.items) {
      for (const [k, code] of [['pre', x.compose.scripts.pre], ['post', x.compose.scripts.post]]) {
        if (!code.trim()) continue;
        if (!R.checks.scripts.has(code)) R.checks.scripts.set(code, (await ApiScript.check(code)).error || '');
        const er = R.checks.scripts.get(code);
        if (er) errs.push({ msg: `${k === 'pre' ? 'Pre-request' : 'Post-response'} script của “${x.node.name}” có lỗi cú pháp: ${er}`, fix: { kind: 'script', requestId: x.requestId } });
      }
    }
    const urls = plan.items.map(x => ApiEngine.targetUrl(x.compose)).filter(Boolean);
    const missing = [];
    for (const u of urls) {
      let o;
      try { o = new URL(u).origin; } catch { continue; }
      if (!R.checks.perms.has(o)) R.checks.perms.set(o, await ApiTransport.hasPermission(u));
      if (!R.checks.perms.get(o) && !missing.includes(u)) missing.push(u);
    }
    if (missing.length) errs.push({ msg: `Chrome chưa cấp quyền cho extension truy cập ${[...new Set(missing.map(u => new URL(u).host))].join(', ')}`, fix: { kind: 'permission', urls: missing } });
    return errs;
  }
  const FIX_LABEL = { var: 'Nhập giá trị', host: 'Cho phép', body: 'Mở request', request: 'Mở request', script: 'Mở Scripts', review: 'Xem case', env: 'Environments', scope: 'Chọn phạm vi', permission: 'Cấp quyền' };
  async function renderPreRun() {
    const box = $('#preRun');
    if (!box) return;
    const W = App.W;
    if (R.run?.running) {
      box.innerHTML = `<div class="sec-h row"><h3><span class="ms sm spin" aria-hidden="true">progress_activity</span>Đang chạy</h3><span class="spacer"></span><button type="button" class="btn btn-danger btn-sm" data-run-act="stop"><span class="ms sm fill" aria-hidden="true">stop</span>Stop</button></div>
        <p class="muted small">${esc(R.run.scopeLabel)} · ${esc(R.run.envName)}. Có thể xem kết quả ngay bên dưới khi từng case xong.</p>`;
      return;
    }
    const plan = R.plan = buildPlan();
    const token = ++R.token;
    const draw = (asyncErrs, pending) => {
      if (token !== R.token) return;
      const errs = [...plan.errors, ...asyncErrs];
      const varErrs = errs.filter(x => x.fix?.kind === 'var');
      const others = errs.filter(x => x.fix?.kind !== 'var');
      const li = (x, kind) => `<li class="${kind}${x.kind === 'prod' ? ' prod' : ''}${x.kind === 'info' ? ' info' : ''}"><span class="ms sm" aria-hidden="true">${kind === 'err' ? 'block' : x.kind === 'info' ? 'info' : 'warning'}</span><span>${esc(x.msg)}</span>${x.fix && FIX_LABEL[x.fix.kind] && x.fix.kind !== 'var' ? `<button type="button" class="btn btn-sm" data-fix='${esc(JSON.stringify(x.fix))}'>${FIX_LABEL[x.fix.kind]}</button>` : ''}</li>`;
      const order = plan.items.map(x => x.node.name);
      box.innerHTML = `
        <div class="sec-h row"><h3><span class="ms sm" aria-hidden="true">${errs.length ? 'error' : 'task_alt'}</span>${errs.length ? 'Chưa thể chạy' : 'Sẵn sàng chạy'}</h3></div>
        <dl class="pre-grid">
          <div class="pre-item${plan.isProd ? ' danger' : ''}"><dt><span class="ms sm" aria-hidden="true">dns</span>Environment</dt><dd><b>${esc(plan.envName)}</b>${plan.isProd ? ' <span class="badge badge-error">Production</span>' : ''}</dd></div>
          <div class="pre-item"><dt><span class="ms sm" aria-hidden="true">account_tree</span>Phạm vi</dt><dd class="clamp-2">${esc(scopeLabel())}</dd></div>
          <div class="pre-item"><dt><span class="ms sm" aria-hidden="true">http</span>Request</dt><dd><b>${plan.counts.requests}</b>${plan.items.some(x => x.synthetic) ? ` · ${plan.items.filter(x => x.synthetic).length} dùng kiểm tra mặc định` : ''}</dd></div>
          <div class="pre-item"><dt><span class="ms sm" aria-hidden="true">checklist</span>Test case sẽ chạy</dt><dd><b>${plan.counts.cases}</b>${plan.counts.total - plan.counts.cases ? ` · ${plan.counts.total - plan.counts.cases} SKIPPED` : ''}</dd></div>
          <div class="pre-item${plan.counts.mutating ? ' warnish' : ''}"><dt><span class="ms sm" aria-hidden="true">edit_note</span>Ghi dữ liệu</dt><dd>${plan.counts.mutating ? `<b>${plan.counts.mutating}</b> case ${esc(plan.mutatingMethods.join('/'))}` : 'Không'}</dd></div>
          <div class="pre-item"><dt><span class="ms sm" aria-hidden="true">shield</span>Host</dt><dd class="clamp-2">${esc(plan.hosts.join(', ') || '—')}</dd></div>
        </dl>
        ${plan.items.length > 1 ? `<details class="adv order-adv"><summary><span class="ms sm chev" aria-hidden="true">chevron_right</span>Thứ tự chạy <span class="muted small">${plan.items.length} request</span></summary>
          <ol class="run-order">${plan.items.map(x => `<li>${Ui.methodTag(x.node.method)} ${esc(x.node.name)}${x.deps.size ? ` <span class="muted small">sau ${[...x.deps].map(d => esc(W.get(d)?.name || '')).join(', ')}</span>` : ''}${[...x.makes].length ? ` <span class="badge badge-secondary" title="Sinh biến">→ ${[...x.makes].map(esc).join(', ')}</span>` : ''}</li>`).join('')}</ol></details>` : ''}
        ${varErrs.length ? `<div class="fill-box"><p class="fill-title"><span class="ms sm" aria-hidden="true">key</span>Nhập giá trị còn thiếu <span class="muted small">(lưu vào ${esc(plan.envName)})</span></p>
          ${varErrs.map(x => `${App.fillInput(x.fix.name, { envId: plan.envId, scope: 'run' })}<p class="muted small fill-hint">${esc(x.msg)}</p>`).join('')}</div>` : ''}
        <ul class="blockers">${others.map(x => li(x, 'err')).join('')}${plan.warnings.map(x => li(x, 'warn')).join('')}</ul>
        <div class="run-cta">
          <button class="btn btn-primary btn-big" type="button" data-run-act="run"${errs.length || pending || !plan.counts.cases ? ' disabled' : ''}><span class="ms fill" aria-hidden="true">play_arrow</span><span>Run ${plan.counts.cases} case</span></button>
          <span class="muted small">${pending ? '<span class="ms sm spin" aria-hidden="true">progress_activity</span> Đang kiểm tra script / quyền…' : errs.length ? `${errs.length} mục cần sửa trước khi chạy` : order.length > 1 ? `Thứ tự: ${esc(order.slice(0, 4).join(' → '))}${order.length > 4 ? ' → …' : ''}` : ''}</span>
        </div>`;
    };
    draw([], true);
    const asyncErrs = await asyncChecks(plan).catch(() => []);
    plan.asyncErrors = asyncErrs;
    draw(asyncErrs, false);
  }
  async function applyFix(fix, btn) {
    const W = App.W;
    switch (fix.kind) {
      case 'var': App.openEnvManager(fix.envId, { focusVar: fix.name }); break;
      case 'host': App.allowHost(fix.host, fix.envId); renderPreRun(); break;
      case 'body': App.select(fix.requestId, { tab: 'body' }); break;
      case 'request': App.select(fix.requestId); break;
      case 'script': App.select(fix.requestId, { tab: 'scripts' }); break;
      case 'review': {
        const x = R.plan?.items.find(i => i.cases.some(k => !k.skip && /^\s*NEEDS_REVIEW/i.test(k.kase.note || '')));
        if (x) App.select(x.requestId, { tab: 'tests' });
        break;
      }
      case 'env': App.openEnvManager(fix.envId || W.meta.activeEnvId); break;
      case 'scope': $('#runCol')?.focus(); break;
      case 'permission': if (await App.grantPermission(fix.urls)) { R.checks.perms.clear(); renderPreRun(); } break;
    }
    btn?.blur();
  }

  // ================= CHẠY =================
  async function startRun({ auto = false, plan: given, label } = {}) {
    if (R.run?.running) return;
    const W = App.W;
    const plan = given || buildPlan();
    const asyncErrs = given?.asyncErrors || await asyncChecks(plan).catch(() => []);
    const errs = [...plan.errors, ...asyncErrs];
    if (errs.length || !plan.counts.cases) {
      if (!auto) toast(`${errs.length || 'Không có'} ${errs.length ? 'mục cần sửa trước khi chạy' : 'case nào để chạy'}`, 'warn');
      renderPreRun();
      $('#preRun')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Xác nhận: PRODUCTION hoặc có request ghi dữ liệu. Nút Huỷ được focus mặc định; chưa gửi gì trước khi xác nhận
    if (plan.isProd || plan.counts.mutating) {
      const mutReqs = plan.items.filter(x => x.cases.some(k => !k.skip && ApiEngine.MUTATING.includes(ApiEngine.methodOf(x.node, k.kase))));
      const ok = await Ui.confirmBox(plan.isProd ? 'Run trên PRODUCTION?' : 'Run các request ghi dữ liệu?',
        `${plan.isProd ? '<div class="prod-note"><span class="ms sm fill" aria-hidden="true">warning</span><span>Request sẽ gửi tới hệ thống <b>production</b>.</span></div>' : ''}
         <p>Environment <b>${esc(plan.envName)}</b> · ${plan.counts.requests} request · ${plan.counts.cases} case sẽ gửi${plan.counts.mutating ? `, trong đó <b>${plan.counts.mutating} case ${esc(plan.mutatingMethods.join('/'))}</b> có thể tạo / sửa / xoá dữ liệu thật` : ''}.</p>
         ${mutReqs.length ? `<p class="small"><b>Request ghi dữ liệu:</b></p><ul class="confirm-list">${mutReqs.slice(0, 10).map(x => `<li>${Ui.methodTag(x.node.method)} ${esc(x.node.name)}</li>`).join('')}${mutReqs.length > 10 ? `<li class="muted">…và ${mutReqs.length - 10} request khác</li>` : ''}</ul>` : ''}
         <p class="muted small">Host đích: ${esc(plan.hosts.join(', ') || '—')}. Tool không tự thử lại request ghi dữ liệu.</p>`,
        plan.isProd ? 'Tôi hiểu, Run trên PROD' : 'Run');
      if (!ok) return;
    }
    const c = R.cfg;
    const env = W.envs[plan.envId];
    const runId = ApiRunner.newRunId();
    const secretValues = [...new Set(plan.items.flatMap(x => x.compose.secretValues))];
    const red = ApiRedact.create(secretValues);
    const run = R.run = {
      runId, running: true, ctrl: new AbortController(), startedAt: Date.now(), finishedAt: null,
      envName: env?.name || '(không có)', envId: plan.envId, mode: ApiTransport.mode, isProd: plan.isProd,
      scopeLabel: label || scopeLabel(), presetId: c.presetId, presetName: c.presetId ? W.preset(c.presetId)?.name || '' : '',
      total: plan.counts.total, results: [], current: '',
      items: plan.items.map(x => ({
        requestId: x.requestId, requestName: x.node.name, method: x.node.method, path: W.path(x.requestId).map(p => p.name).join(' / '),
        suite: W.suite(x.requestId) ? JSON.parse(JSON.stringify(W.suite(x.requestId))) : null,
        scripts: { pre: x.compose.scripts.pre, post: x.compose.scripts.post }, url: red.url(x.node.url),
      })),
    };
    R.f = { ...R.f, status: 'all', request: '', folder: null, q: '', page: 0 };
    reportBusy(true);
    $('#app').classList.add('is-running');
    $('#navRunDot').classList.remove('hidden');
    App.setNav('run');
    const tick = setInterval(() => { const d = $('#kpiDur'); if (d && R.run === run) d.textContent = Ui.fmtDur(Date.now() - run.startedAt); }, 1000);
    let failed = '';
    try {
      const out = await ApiEngine.run(plan, {
        W, runId, signal: run.ctrl.signal,
        settings: { timeout: c.timeout, delay: c.delay, concurrency: c.mode === 'parallel' ? c.concurrency : 1, stopOnCritical: c.stopOnCritical, retryErrors: c.retryErrors },
        onItem: x => { run.current = x.node.name; renderProgress(); },
        onResult: r => { run.results.push(r); onProgress(r); },
      });
      R.runtime = out.runtime; // chỉ giữ trong bộ nhớ: dùng cho "Chạy lại case lỗi"
    } catch (x) { failed = x.message; console.error(x); }
    clearInterval(tick);
    await ApiTransport.cleanup();
    run.aborted = run.ctrl.signal.aborted;
    run.running = false;
    run.finishedAt = Date.now();
    run.current = '';
    delete run.ctrl;
    reportBusy(false);
    $('#app').classList.remove('is-running');
    W.saveLastRun(storable(run));
    App.renderTests?.();
    const k = ApiReport.counts(run.results);
    if (failed) toast('Runner dừng vì lỗi: ' + failed, 'err', 10000);
    else toast(`Xong: ${k.PASS} PASS · ${k.FAIL} FAIL · ${k.ERROR} ERROR · ${k.SKIPPED} SKIPPED`, k.FAIL + k.ERROR ? 'warn' : 'ok', 6000);
    if (k.FAIL + k.ERROR) R.f.status = 'issues';
    if (App.state.nav === 'run') renderRun();
  }
  const storable = run => JSON.parse(JSON.stringify(run)); // kết quả đã che; AbortController đã bỏ
  // Chạy lại case FAIL / ERROR của lần trước, dùng biến runtime cuối của lần đó (nếu còn trong bộ nhớ)
  async function retry(status) {
    const W = App.W, run = R.run;
    if (!run || run.running) return;
    const pick = run.results.filter(r => (status === 'FAIL' ? r.status === 'FAIL' : r.status === 'ERROR' && r.errorKind !== 'cancelled') && r.requestId && W.get(r.requestId));
    if (!pick.length) { toast('Không có case nào để chạy lại', 'info'); return; }
    const only = new Set(pick.map(r => `${r.requestId}::${r.caseId}`));
    const ids = [...new Set(pick.map(r => r.requestId))];
    const mut = pick.filter(r => ApiEngine.MUTATING.includes(r.method));
    if (mut.length) {
      const ok = await Ui.confirmBox('Chạy lại request ghi dữ liệu?', `<p>${mut.length} case ${esc([...new Set(mut.map(r => r.method))].join('/'))} sẽ được gửi lại. Request đã tạo dữ liệu ở lần trước có thể tạo <b>bản ghi trùng</b>.</p>`, 'Chạy lại');
      if (!ok) return;
    }
    if (!R.runtime) toast('Biến runtime của lần chạy trước không còn (đã tải lại trang): request cần biến từ request khác có thể báo thiếu biến.', 'warn', 8000);
    const plan = ApiEngine.plan(W, { requestIds: ids, envId: run.envId || W.meta.activeEnvId, priorities: [], mode: R.cfg.mode, runtime: R.runtime || {}, only });
    plan.asyncErrors = await asyncChecks(plan).catch(() => []);
    startRun({ plan, label: `Chạy lại ${pick.length} case ${status} · ${run.scopeLabel}` });
  }

  // ================= KẾT QUẢ =================
  function onProgress(r) {
    if (App.state.nav !== 'run') return;
    renderProgress();
    renderKpis();
    if (rVisible(r)) renderTable(); // chỉ vẽ lại trang đang xem
    if (Ui.currentDrawer() === $('#evDrawer') && ev.index === r.index) renderEvidence();
  }
  // Kết quả theo hướng "máy đo": tiêu đề + hành động · dải chỉ số · biểu đồ vạch (mỗi case một vạch) · danh sách gom theo request.
  // Chạy xong mà có FAIL / ERROR thì mặc định chỉ hiện các case đó (R.f.status = 'issues').
  function renderResults() {
    const box = $('#runResults');
    if (!box) return;
    const run = R.run;
    box.classList.toggle('hidden', !run);
    if (!run) return;
    const reqOpts = run.items.map(x => `<option value="${esc(x.requestId)}"${R.f.request === x.requestId ? ' selected' : ''}>${esc(x.method)} ${esc(x.requestName)}</option>`).join('');
    const folders = [...new Set(run.results.map(r => r.folderPath || ''))];
    box.innerHTML = `
      <div class="run-head">
        <div class="min0">
          <p class="eyebrow" id="runStatus" aria-live="polite"></p>
          <h2 class="run-title">${run.running ? 'Đang chạy' : `Kết quả ${esc(Ui.fmtTime(run.startedAt).split(' ')[0])}`}</h2>
          <p class="run-sub" id="countBig"></p>
        </div>
        <span class="spacer"></span>
        <div class="run-actions" id="runActions"></div>
      </div>
      <div class="bar" role="progressbar" aria-label="Tiến độ" aria-valuemin="0" aria-valuemax="100" id="barWrap"><div id="barFill"></div></div>
      ${run.restored ? `<p class="muted small restored-note"><span class="ms sm" aria-hidden="true">history</span> Kết quả lần chạy lúc ${esc(Ui.fmtTime(run.startedAt))} (đã lưu trên máy${run.trimmed ? ', body đã rút gọn' : ''}). Request / test case có thể đã thay đổi sau đó.</p>` : ''}
      <div class="kpis" id="kpis"></div>
      <div class="trace" id="runTrace"></div>
      <div class="toolbar list-toolbar">
        <div class="chips" id="rFilters" role="group" aria-label="Lọc theo trạng thái"></div>
        <span class="spacer"></span>
        ${folders.length > 1 ? `<label class="visually-hidden" for="rFolder">Folder</label><select id="rFolder" class="filter-select"><option value="__all"${R.f.folder == null ? ' selected' : ''}>Mọi folder</option>${folders.map(f => `<option value="${esc(f)}"${R.f.folder === f ? ' selected' : ''}>${esc(f || '(ngay trong collection)')}</option>`).join('')}</select>` : ''}
        ${run.items.length > 1 ? `<label class="visually-hidden" for="rReq">Request</label><select id="rReq" class="filter-select"><option value="">Mọi request</option>${reqOpts}</select>` : ''}
        <div class="search-box"><span class="ms sm" aria-hidden="true">search</span><input type="search" id="rSearch" value="${esc(R.f.q)}" placeholder="Tìm TC ID, tên, lý do…" aria-label="Tìm kết quả"></div>
      </div>
      <div class="rlist" id="rBody" role="list" aria-label="Kết quả từng case"></div>
      <div class="empty hidden" id="rEmpty">Không có case nào khớp bộ lọc.</div>
      <div class="pager" id="rPager"></div>`;
    renderProgress();
    renderKpis();
    renderTable();
  }
  function renderProgress() {
    const run = R.run;
    if (!run || !$('#countBig')) return;
    const done = run.results.length;
    const pct = run.total ? Math.round((done / run.total) * 100) : 0;
    $('#runStatus').innerHTML = run.running
      ? `<span class="s-dot run"></span>Đang chạy${run.current ? ` · ${esc(run.current)}` : ''}`
      : `<span class="s-dot ${run.aborted ? 'stop' : 'ok'}"></span>${run.aborted ? 'Đã dừng' : 'Hoàn tất'}`;
    $('#countBig').innerHTML = [run.presetName && `<b>${esc(run.presetName)}</b>`, `<b>${esc(run.envName)}</b>`, esc(run.scopeLabel), `${done} / ${run.total} case`].filter(Boolean).join(' · ');
    $('#barWrap').classList.toggle('hidden', !run.running);
    $('#barFill').style.width = (run.running ? pct : 100) + '%';
    $('#barWrap').setAttribute('aria-valuenow', run.running ? pct : 100);
    const k = ApiReport.counts(run.results);
    const bad = k.FAIL + run.results.filter(r => r.status === 'ERROR' && r.errorKind !== 'cancelled').length;
    $('#runActions').innerHTML = run.running
      ? '<button class="btn btn-danger btn-sm" type="button" data-run-act="stop"><span class="ms sm fill" aria-hidden="true">stop</span>Stop</button>'
      : `${k.FAIL ? `<button class="btn btn-sm" type="button" data-run-act="retry-fail"><span class="ms sm" aria-hidden="true">replay</span>Chạy lại ${k.FAIL} FAIL</button>` : ''}
        ${bad - k.FAIL ? `<button class="btn btn-sm" type="button" data-run-act="retry-error"><span class="ms sm" aria-hidden="true">replay</span>Chạy lại ${bad - k.FAIL} ERROR</button>` : ''}
        <button class="btn btn-sm" type="button" data-run-act="xlsx"><span class="ms sm" aria-hidden="true">table_view</span>Export Excel</button>
        <button class="btn btn-sm" type="button" data-run-act="zip" title="Excel + evidence JSON đầy đủ + test suite + scripts"><span class="ms sm" aria-hidden="true">folder_zip</span>Export ZIP</button>
        <button class="btn btn-sm btn-primary" type="button" data-run-act="rerun"><span class="ms sm fill" aria-hidden="true">play_arrow</span>Chạy lại tất cả</button>
        <button class="icon-btn" type="button" data-run-act="clear" aria-label="Xoá kết quả" title="Xoá kết quả"><span class="ms" aria-hidden="true">delete</span></button>`;
  }
  function renderKpis() {
    const run = R.run;
    if (!run || !$('#kpis')) return;
    const c = ApiReport.counts(run.results);
    const dur = (run.finishedAt || Date.now()) - run.startedAt;
    const k = (key, label, n, kind, tip) => `<button type="button" class="kpi ${kind}${R.f.status === key ? ' on' : ''}" data-rf="${key}" aria-pressed="${R.f.status === key}" title="${tip} · bấm để lọc"><span class="kpi-l">${label}</span><span class="kpi-n">${n}</span></button>`;
    $('#kpis').innerHTML = `<div class="kpi big" title="PASS / (Tổng − SKIPPED)"><span class="kpi-l">Tỉ lệ đạt</span><span class="kpi-n">${ApiReport.pct(c.passRate)}</span></div>`
      + k('PASS', 'Pass', c.PASS, 'pass', 'Đúng mong đợi') + k('FAIL', 'Fail', c.FAIL, 'fail', 'API trả sai: báo dev')
      + k('ERROR', 'Error', c.ERROR, 'error', 'Chưa kiểm thử được, thường do cấu hình') + k('SKIPPED', 'Skipped', c.SKIPPED, 'skip', 'Không chạy')
      + `<div class="kpi static"><span class="kpi-l">Thời gian</span><span class="kpi-n" id="kpiDur">${Ui.fmtDur(dur)}</span></div>`;
    const n = { all: run.results.length, issues: c.FAIL + c.ERROR };
    // Lọc theo từng trạng thái bằng ô chỉ số ở trên; ở đây chỉ còn hai lối tắt
    $('#rFilters').innerHTML = [['issues', 'Cần xem'], ['all', 'Tất cả']]
      .filter(([key]) => key === 'all' || n[key] || R.f.status === key)
      .map(([key, l]) => `<button type="button" class="chip${R.f.status === key ? ' on' : ''}${key === 'issues' ? ' chip-issue' : ''}" data-rf="${key}" aria-pressed="${R.f.status === key}">${l} <b>${n[key]}</b></button>`).join('');
    renderTrace();
  }
  // Biểu đồ vạch: mỗi case một vạch theo thứ tự chạy, cao = thời gian phản hồi (thang căn bậc hai để case nhanh vẫn thấy), màu = trạng thái.
  // Vạch gom theo request, có nhãn tên request bên dưới; bấm vạch để mở evidence.
  function renderTrace() {
    const run = R.run, box = $('#runTrace');
    if (!run || !box) return;
    const list = run.results;
    if (!list.length) { box.innerHTML = ''; return; }
    const max = Math.max(1, ...list.map(r => r.durationMs || 0));
    const groups = [];
    for (const r of list) {
      const g = groups[groups.length - 1];
      if (g && g.id === r.requestId) g.rs.push(r); else groups.push({ id: r.requestId, name: r.requestName, rs: [r] });
    }
    const tick = r => {
      const h = r.status === 'SKIPPED' || r.durationMs == null ? 6 : Math.max(8, Math.round(Math.sqrt((r.durationMs || 0) / max) * 100));
      const k = r.kase || { id: r.caseId };
      return `<button type="button" class="tk ${(r.status || 'run').toLowerCase()}" style="height:${h}%" data-ri="${r.index}" title="${esc(`${k.id} · ${r.status || 'đang chạy'}${r.durationMs != null ? ` · ${Ui.fmtDur(r.durationMs)}` : ''}`)}" aria-label="${esc(`${k.id} ${r.status || ''}`)}"></button>`;
    };
    box.innerHTML = `<div class="tr-h"><span>Mỗi vạch là 1 case · cao = thời gian phản hồi (tối đa ${esc(Ui.fmtDur(max))})</span><span class="spacer"></span>
        <span class="lg pass">Pass</span><span class="lg fail">Fail</span><span class="lg error">Error</span><span class="lg skip">Skipped</span></div>
      <div class="tr-plot">${groups.map(g => `<div class="tr-g" style="flex:${g.rs.length}">${g.rs.map(tick).join('')}</div>`).join('')}</div>
      <div class="tr-lbl">${groups.map(g => `<span style="flex:${g.rs.length}" title="${esc(g.name)}">${esc(g.name)}</span>`).join('')}</div>`;
  }
  const rVisible = r => {
    const f = R.f.status;
    if (f === 'issues' && !(r.status === 'FAIL' || r.status === 'ERROR')) return false;
    if (f !== 'all' && f !== 'issues' && r.status !== f) return false;
    if (R.f.request && r.requestId !== R.f.request) return false;
    if (R.f.folder != null && (r.folderPath || '') !== R.f.folder) return false;
    if (!R.f.q) return true;
    const k = r.kase || {};
    return [k.id, k.name, k.group, r.reason, r.evidenceId, r.requestName].some(x => Ui.norm(x).includes(Ui.norm(R.f.q)));
  };
  const filtered = () => R.run.results.filter(rVisible);
  // Một câu "mong đợi → nhận" cho dòng kết quả: lỗi status trước, rồi kiểm tra sai đầu tiên, rồi thời gian
  function diffHtml(r, k) {
    if (r.status === 'ERROR' || r.status === 'SKIPPED' || !r.response) {
      return `${r.errorKind && r.status !== 'PASS' ? `<b class="kind-tag">${esc(ApiReport.ERROR_KIND[r.errorKind] || r.errorKind)}</b>` : ''}<span class="clamp-1">${esc(r.reason || '')}</span>`;
    }
    const sc = r.statusCheck;
    if (sc && !sc.pass) return `<span class="dk">status</span><s>${esc(ApiReport.fmtCodes(sc.expected))}</s><b class="got">${esc(sc.actual)}</b>`;
    const a = (r.assertions || []).find(x => !x.pass);
    if (a) {
      const where = a.source === 'time' ? 'thời gian' : a.source === 'script' ? 'pm.test' : a.source === 'header' ? `header ${a.path}` : a.path === '$' ? 'body' : `body${String(a.path).replace(/^\$/, '')}`;
      return `<span class="dk">${esc(where)}</span>${a.expected ? `<s>${esc(a.operator === 'lte' ? '≤ ' + a.expected : a.expected)}</s>` : ''}<b class="got clamp-1">${esc(a.actual || a.reason)}</b>`;
    }
    return `<span class="dk">status</span><span class="ok-t">${esc(sc?.actual ?? r.response.status)}</span>${k.synthetic ? '<span class="muted small">kiểm tra mặc định 2xx</span>' : ''}`;
  }
  function rowHtml(r) {
    const k = r.kase || { id: r.caseId, name: r.caseId, expect: { statusCodes: [] } };
    const st = (r.status || 'pending').toLowerCase();
    return `<div class="rrow st-${st}" data-ri="${r.index}" tabindex="0" role="listitem" aria-label="${esc(`${k.id} ${k.name}: ${r.status || 'đang chạy'}`)}">
      <span class="ms sm${r.status ? ' fill' : ' spin'} r-ic" aria-hidden="true">${STATUS_ICON[r.status] || 'progress_activity'}</span>
      <span class="tc-id">${esc(k.id)}</span>
      ${k.priority ? `<span class="tc-p p-${esc(k.priority.toLowerCase())}">${esc(k.priority)}</span>` : '<span></span>'}
      <span class="r-name clamp-1">${esc(k.name)}</span>
      <span class="r-diff">${diffHtml(r, k)}</span>
      <span class="r-dur">${r.durationMs != null ? Ui.fmtDur(r.durationMs) : ''}</span>
    </div>`;
  }
  function renderTable() {
    const body = $('#rBody');
    if (!body) return;
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / R.f.size));
    R.f.page = Math.min(R.f.page, pages - 1);
    const page = rows.slice(R.f.page * R.f.size, (R.f.page + 1) * R.f.size);
    const html = [];
    let open = false, last = null;
    for (const r of page) {
      if (r.requestId !== last) {
        if (open) html.push('</div>');
        last = r.requestId;
        const c = ApiReport.counts(R.run.results.filter(x => x.requestId === r.requestId));
        const item = R.run.items.find(x => x.requestId === r.requestId);
        html.push(`<div class="rgrp"><div class="rgrp-h">${Ui.methodTag(r.method || item?.method || '')}<b>${esc(r.requestName)}</b><span class="muted small clamp-1">${esc(r.folderPath || r.collectionName || '')}</span><span class="spacer"></span>
          <span class="gr-cnt">${c.PASS ? `<span class="ok-t">${c.PASS} pass</span>` : ''}${c.FAIL ? `<span class="err-t">${c.FAIL} fail</span>` : ''}${c.ERROR ? `<span class="warn-t">${c.ERROR} error</span>` : ''}${c.SKIPPED ? `<span class="muted">${c.SKIPPED} skipped</span>` : ''}</span></div>`);
        open = true;
      }
      html.push(rowHtml(r));
    }
    if (open) html.push('</div>');
    body.innerHTML = html.join('');
    $('#rEmpty').classList.toggle('hidden', rows.length > 0);
    if (!rows.length) $('#rEmpty').innerHTML = R.run.results.length ? 'Không có case nào khớp bộ lọc. <button type="button" class="link-btn" data-rf="all">Xem tất cả</button>' : R.run.running ? 'Đang chạy case đầu tiên…' : 'Chưa có kết quả.';
    renderPager(rows.length);
    renderExportLabels();
  }
  function renderPager(total) {
    const el = $('#rPager');
    if (!el) return;
    const pages = Math.max(1, Math.ceil(total / R.f.size));
    if (total <= PAGE_SIZES[0]) { el.innerHTML = total ? `<span class="muted small">${total} dòng</span>` : ''; return; }
    el.innerHTML = `<span class="muted small">${R.f.page * R.f.size + 1}–${Math.min(total, (R.f.page + 1) * R.f.size)} / ${total}</span><span class="spacer"></span>
      <label class="small muted" for="rSize">Mỗi trang</label><select id="rSize" class="pg-size">${PAGE_SIZES.map(n => `<option${n === R.f.size ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <button type="button" class="icon-btn" data-rpg="-1" aria-label="Trang trước"${R.f.page === 0 ? ' disabled' : ''}><span class="ms" aria-hidden="true">chevron_left</span></button>
      <span class="small">Trang ${R.f.page + 1}/${pages}</span>
      <button type="button" class="icon-btn" data-rpg="1" aria-label="Trang sau"${R.f.page >= pages - 1 ? ' disabled' : ''}><span class="ms" aria-hidden="true">chevron_right</span></button>`;
  }
  const setFilter = s => { R.f.status = s; R.f.page = 0; renderKpis(); renderTable(); };
  $('#view-run').addEventListener('click', e => {
    const rf = e.target.closest('[data-rf]');
    if (rf) { setFilter(rf.closest('#kpis') && R.f.status === rf.dataset.rf ? 'all' : rf.dataset.rf); return; }
    const pg = e.target.closest('[data-rpg]');
    if (pg) { R.f.page += Number(pg.dataset.rpg); renderTable(); return; }
    const tr = e.target.closest('[data-ri]');
    if (tr) openEvidence(Number(tr.dataset.ri), tr);
  });
  $('#view-run').addEventListener('change', e => {
    if (e.target.id === 'rReq') { R.f.request = e.target.value; R.f.page = 0; renderTable(); }
    if (e.target.id === 'rFolder') { R.f.folder = e.target.value === '__all' ? null : e.target.value; R.f.page = 0; renderTable(); }
    if (e.target.id === 'rSize') { R.f.size = Number(e.target.value); R.f.page = 0; renderTable(); }
  });
  $('#view-run').addEventListener('input', debounce(e => { if (e.target.id === 'rSearch') { R.f.q = e.target.value.trim(); R.f.page = 0; renderTable(); } }, 200));
  $('#view-run').addEventListener('keydown', e => {
    const tr = e.target.closest('.rrow[data-ri]');
    if (!tr || e.target !== tr) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEvidence(Number(tr.dataset.ri), tr); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = $$('#rBody .rrow');
      all[all.indexOf(tr) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  });

  // ---------- Export ----------
  // Mô tả bộ lọc đang dùng (rỗng = không lọc)
  function filterLabel() {
    const f = R.f, run = R.run;
    const STATUS = { issues: 'FAIL + ERROR', FAIL: 'FAIL', ERROR: 'ERROR', PASS: 'PASS', SKIPPED: 'SKIPPED' };
    return [
      STATUS[f.status] ? `Trạng thái: ${STATUS[f.status]}` : '',
      f.folder != null ? `Folder: ${f.folder || '(ngay trong collection)'}` : '',
      f.request ? `Request: ${run.items.find(x => x.requestId === f.request)?.requestName || f.request}` : '',
      f.q ? `Tìm: “${f.q}”` : '',
    ].filter(Boolean).join(' · ');
  }
  // Nhãn nút export cho biết đang lọc bao nhiêu case
  function renderExportLabels() {
    const run = R.run;
    if (!run || run.running) return;
    const n = filtered().length, all = run.results.length;
    for (const [act, text] of [['xlsx', 'Export Excel'], ['zip', 'Export ZIP']]) {
      const b = $(`#runActions [data-run-act="${act}"]`);
      if (!b) continue;
      b.lastChild.textContent = n < all ? `${text} (${n}/${all})` : text;
      b.setAttribute('aria-haspopup', n < all ? 'menu' : 'false');
    }
  }
  // Đang lọc → hỏi xuất theo bộ lọc hay toàn bộ
  function exportRun(btn, kind) {
    const run = R.run;
    if (!run || run.running) return;
    const n = filtered().length, all = run.results.length;
    if (n === all) { doExport(btn, kind, false); return; }
    Ui.menu(btn, [
      { label: `Theo bộ lọc hiện tại (${n} case)`, icon: 'filter_alt', hint: filterLabel(), disabled: !n, action: () => doExport(btn, kind, true) },
      { label: `Toàn bộ kết quả (${all} case)`, icon: 'select_all', action: () => doExport(btn, kind, false) },
    ]);
  }
  async function doExport(btn, kind, onlyFiltered) {
    const run = R.run;
    const W = App.W;
    // Che thêm giá trị bí mật đang biết trong suite / scripts trước khi đưa vào file
    const secrets = [...W.envList().flatMap(e => e.vars.filter(v => v.secret || ApiRedact.isSecretName(v.key)).map(v => v.value)),
      ...W.meta.globals.vars.filter(v => v.secret || ApiRedact.isSecretName(v.key)).map(v => v.value),
      ...Object.entries(W.runtime()).filter(([k]) => ApiRedact.isSecretName(k)).map(([, v]) => String(v))].filter(v => v && v.length >= 4);
    const red = ApiRedact.create(secrets);
    const data = { ...run, redactSuite: t => red.text(t) };
    if (onlyFiltered) {
      data.results = filtered();
      const ids = new Set(data.results.map(r => r.requestId));
      data.items = run.items.filter(x => ids.has(x.requestId));
      data.filterLabel = filterLabel();
      data.totalAll = run.results.length;
    }
    const name = `qa-api-report-${run.runId}${onlyFiltered ? '-loc' : ''}.${kind}`;
    btn.disabled = true;
    const icon = btn.querySelector('.ms'), old = icon.textContent;
    icon.textContent = 'progress_activity';
    icon.classList.add('spin');
    try {
      const blob = kind === 'xlsx' ? await ApiReport.excel(data) : await ApiReport.zip(data);
      Ui.download(blob, name);
      toast(blob.truncated && kind === 'xlsx' ? `Đã xuất ${name}. Một số ô quá dài được ghi TRUNCATED, dùng Export ZIP để có evidence đầy đủ.` : `Đã xuất ${name}`, blob.truncated && kind === 'xlsx' ? 'warn' : 'ok', 6000);
    } catch (x) { toast('Không xuất được file: ' + x.message, 'err', 8000); }
    finally { icon.textContent = old; icon.classList.remove('spin'); btn.disabled = false; }
  }

  // ================= EVIDENCE =================
  const ev = { index: -1, tab: 'assert' };
  const KIND_HINT = {
    variable: 'Biến chưa có giá trị nên request không được gửi. Nhập giá trị trong Environment, hoặc chạy kèm request sinh ra biến.',
    dependency: 'Request chạy trước không lấy được biến cần dùng nên request này không được gửi. Xem kết quả của request đó.',
    policy: 'Bị chặn bởi Allowed hosts / chính sách bảo mật. Request không được gửi (hoặc response bị bỏ vì redirect sang host lạ).',
    permission: 'Chrome chưa cấp quyền truy cập host cho extension.',
    network: 'Không nhận được response: timeout, sai địa chỉ, máy chủ tắt, lỗi chứng chỉ hoặc mất mạng. Không phải lỗi nghiệp vụ của API.',
    script: 'Script (Pre-request / Post-response) lỗi khi chạy. Xem tab Console.',
    build: 'Không ghép được request (vd body JSON sai, URL ghi đè sai).',
    evaluate: 'Có response nhưng tool không chấm được.',
    cancelled: 'Tester bấm Stop khi case đang chạy: không tính là lỗi của API.',
  };
  function openEvidence(i, opener) {
    const r = R.run?.results[i];
    if (!r) return;
    ev.index = i;
    ev.tab = r.status === 'ERROR' && !r.response ? 'req' : 'assert';
    renderEvidence();
    Ui.openDrawer($('#evDrawer'), opener);
  }
  // Kết quả gần nhất của một case: tab Tests của request hiện ĐẠT / SAI ngay trên thẻ case và mở được evidence
  const caseIdx = (reqId, caseId) => { const list = R.run?.results || []; for (let i = list.length - 1; i >= 0; i--) if (list[i].requestId === reqId && list[i].caseId === caseId) return i; return -1; };
  App.caseResult = (reqId, caseId) => R.run?.results[caseIdx(reqId, caseId)] || null;
  App.openCaseEvidence = (reqId, caseId, opener) => { const i = caseIdx(reqId, caseId); if (i >= 0) openEvidence(i, opener); };
  function showEvTab(tab) {
    ev.tab = tab;
    for (const t of ['assert', 'req', 'res', 'console']) { $('#ev-' + t).classList.toggle('hidden', t !== tab); $('#ev-tab-' + t).setAttribute('aria-selected', t === tab); }
  }
  $('#evDrawer .drawer-tabs').addEventListener('click', e => { const t = e.target.closest('[data-ev]'); if (t) showEvTab(t.dataset.ev); });
  function evStep(d) {
    const list = filtered().map(r => r.index);
    const next = list[list.indexOf(ev.index) + d];
    if (next == null) return;
    ev.index = next;
    renderEvidence();
  }
  $('#evPrev').addEventListener('click', () => evStep(-1));
  $('#evNext').addEventListener('click', () => evStep(1));
  document.addEventListener('keydown', e => {
    if (Ui.currentDrawer() !== $('#evDrawer') || e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); evStep(-1); }
    if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); evStep(1); }
  });
  const curlOf = req => {
    const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
    return [`curl -X ${req.method} ${q(req.url)}`, ...Object.entries(req.headers || {}).map(([k, v]) => `-H ${q(`${k}: ${v}`)}`), ...(req.body != null ? [`--data-raw ${q(req.body)}`] : [])].join(' \\\n  ');
  };
  const queryOf = url => { try { return Object.fromEntries(new URL(url).searchParams); } catch { return {}; } };
  function renderEvidence() {
    const r = R.run.results[ev.index];
    const k = r.kase || { id: r.caseId, name: r.caseId, expect: { statusCodes: [], assertions: [] } };
    const req = r.request, res = r.response;
    const list = filtered().map(x => x.index);
    const pos = list.indexOf(ev.index);
    $('#evPrev').disabled = pos <= 0;
    $('#evNext').disabled = pos < 0 || pos >= list.length - 1;
    $('#evTitle').innerHTML = `${esc(k.id)} ${badge(r.status)}`;
    $('#evSub').textContent = k.name;
    const sc = r.statusCheck;
    // Mã HTTP dùng font mono, phần chú thích tiếng Việt dùng font giao diện
    const expected = k.synthetic ? '2xx' : ApiReport.fmtCodes(k.expect?.statusCodes) + (k.expect?.maxTimeMs ? ` · ≤ ${k.expect.maxTimeMs} ms` : '');
    const expectedNote = k.synthetic ? '<span class="muted small"> (mặc định, request chưa có test case)</span>' : '';
    const failedRows = r.assertions.filter(a => !a.pass);
    $('#evSummary').innerHTML = `
      <dl class="ev-meta">
        <div><dt>Request</dt><dd>${r.method ? Ui.methodTag(r.method) : ''} ${esc(r.requestName || '—')}${r.folderPath || r.collectionName ? `<span class="muted small"> · ${esc([r.collectionName, r.folderPath].filter(Boolean).join(' / '))}</span>` : ''}</dd></div>
        <div><dt>Expected → Actual</dt><dd><span class="mono">${esc(expected)}</span>${expectedNote} → ${res ? `<span class="mono http-${String(res.status)[0]}">${res.status}</span> ${sc ? (sc.pass ? '<span class="ok-t">✓</span>' : '<span class="err-t">✗</span>') : ''}` : '<span class="muted">không có response</span>'}</dd></div>
        <div><dt>Thời gian</dt><dd>${Ui.fmtDur(r.durationMs)} · ${esc(Ui.fmtTime(r.startedAt))}</dd></div>
        <div><dt>Evidence ID</dt><dd><code>${esc(r.evidenceId)}</code>${k.priority ? ` · ${esc(k.priority)}` : ''}</dd></div>
      </dl>
      ${r.reason && r.status !== 'PASS' ? `<div class="d-msg ${r.status === 'FAIL' ? 'err' : r.status === 'SKIPPED' ? 'info' : 'warn'}"><span class="ms sm" aria-hidden="true">${r.status === 'FAIL' ? 'cancel' : r.status === 'SKIPPED' ? 'skip_next' : 'error'}</span><span>
        <b>${r.status === 'FAIL' ? (failedRows.some(a => a.source === 'script') && !failedRows.some(a => a.source !== 'script') && sc?.pass !== false ? 'pm.test sai' : 'Sai so với Expected') : r.errorKind ? ApiReport.ERROR_KIND[r.errorKind] || 'Lỗi' : r.status === 'SKIPPED' ? 'Không chạy' : 'Lỗi'}:</b> ${esc(r.reason)}
        ${r.errorKind && KIND_HINT[r.errorKind] ? `<br><span class="small">${esc(KIND_HINT[r.errorKind])}</span>` : ''}</span></div>` : ''}
      ${r.redacted ? '<p class="muted small"><span class="ms sm" aria-hidden="true">visibility_off</span> Dữ liệu nhạy cảm (token, cookie, password…) đã được che bằng ****</p>' : ''}`;
    // Kiểm tra (assertion sai lên đầu)
    const rows = [];
    if (sc) rows.push({ src: 'status', path: 'HTTP status', op: 'in', exp: k.synthetic ? '2xx' : ApiReport.fmtCodes(sc.expected), act: sc.actual ?? '(không có response)', pass: sc.actual == null ? null : sc.pass, reason: sc.actual != null && !sc.pass ? 'Status code không thuộc Expected' : '' });
    for (const a of r.assertions) rows.push({ src: a.source, path: a.path, op: a.operator, exp: a.expected, act: a.actual, pass: a.pass, reason: a.reason });
    rows.sort((a, b) => (a.pass === false ? 0 : 1) - (b.pass === false ? 0 : 1));
    const failN = rows.filter(x => x.pass === false).length;
    $('#evCntAssert').textContent = rows.length ? (failN ? `${failN} ✗` : `${rows.length} ✓`) : '';
    $('#ev-assert').innerHTML = rows.length ? `<div class="table-wrap as-view"><table>
        <thead><tr><th>Kết quả</th><th>Kiểm tra</th><th>Phép so</th><th>Expected</th><th>Actual</th><th>Lý do</th></tr></thead>
        <tbody>${rows.map(x => `<tr class="${x.pass === false ? 'no' : ''}">
          <td>${x.pass == null ? '<span class="muted">—</span>' : x.pass ? '<span class="badge badge-success"><span class="ms sm" aria-hidden="true">check</span> PASS</span>' : '<span class="badge badge-error"><span class="ms sm" aria-hidden="true">close</span> FAIL</span>'}</td>
          <td><span class="src-tag">${esc(x.src)}</span> <code>${esc(x.path)}</code></td><td><code>${esc(x.op)}</code></td><td><code>${esc(x.exp)}</code></td><td><code>${esc(x.act)}</code></td><td class="small">${esc(x.reason)}</td>
        </tr>`).join('')}</tbody></table></div>` : `<p class="muted">${r.status === 'SKIPPED' ? 'Case không được chạy.' : 'Không có kiểm tra.'}</p>`;
    $('#ev-req').innerHTML = req ? `
      <div class="code-head">${Ui.methodTag(req.method)}<code class="wrap-any">${esc(req.url)}</code></div>
      <div class="row-actions"><button class="btn btn-sm" type="button" data-ev-copy="curl"><span class="ms sm" aria-hidden="true">terminal</span><span class="lbl">Copy cURL</span></button><span class="muted small">Đã che token / secret</span></div>
      <h4>Headers</h4>${App.kvTable(req.headers, 'Không có header')}
      ${Object.keys(queryOf(req.url)).length ? `<h4>Query params</h4>${App.kvTable(queryOf(req.url))}` : ''}
      <h4>Body ${req.bodyMode ? `<span class="muted small">${esc(req.bodyMode)}</span>` : ''}</h4>${req.body != null ? `<pre class="code-view">${esc(ApiReport.pretty(req.body))}</pre>` : '<p class="muted small">Không có body</p>'}`
      : `<p class="muted">Request chưa được tạo / chưa gửi${r.errorKind ? ` (${esc(ApiReport.ERROR_KIND[r.errorKind] || r.errorKind)})` : ''}.</p>`;
    $('#ev-res').innerHTML = res ? `
      <div class="code-head"><span class="badge http-badge http-${String(res.status)[0]}">${res.status} ${esc(res.statusText || '')}</span><span class="muted small">${Ui.fmtDur(r.durationMs)} · ${Ui.fmtBytes(res.size)}${res.redirected ? ` · redirect → ${esc(res.url)}` : ''}${res.truncated ? ' · bị cắt ở giới hạn đọc' : ''}</span></div>
      <div class="row-actions"><button class="btn btn-sm" type="button" data-ev-copy="body"><span class="ms sm" aria-hidden="true">content_copy</span><span class="lbl">Copy body</span></button></div>
      <h4>Body</h4><pre class="code-view tall">${esc(ApiReport.pretty(res.body) || '(body trống)')}</pre>
      <details class="adv"><summary><span class="ms sm chev" aria-hidden="true">chevron_right</span>Response headers <span class="muted small">${Object.keys(res.headers || {}).length}</span></summary>${App.kvTable(res.headers, 'Không có header')}</details>`
      : `<div class="d-msg warn"><span class="ms sm" aria-hidden="true">cloud_off</span><span>Không có response${r.transportError ? ': ' + esc(r.transportError) : ''}.</span></div>`;
    const logs = r.scriptLogs || [], warns = r.warnings || [], saved = Object.entries(r.extracted || {});
    $('#evCntConsole').textContent = logs.length + warns.length || '';
    $('#ev-console').innerHTML = (warns.length ? `<h4>Cảnh báo</h4><ul class="warn-list">${warns.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '')
      + (r.transportError ? `<h4>Lỗi kỹ thuật</h4><pre class="code-view">${esc(r.transportError)}</pre>` : '')
      + `<h4>Console</h4>${logs.length ? `<pre class="code-view">${esc(logs.join('\n'))}</pre>` : '<p class="muted small">Không có log.</p>'}`
      + (saved.length ? `<h4>Biến đã lưu</h4><pre class="code-view">${esc(saved.map(([a, b]) => `${a} = ${b}`).join('\n'))}</pre>` : '');
    showEvTab(ev.tab);
  }
  $('#evDrawer').addEventListener('click', e => {
    const b = e.target.closest('[data-ev-copy]');
    if (!b) return;
    const r = R.run.results[ev.index];
    Ui.copyText(b.dataset.evCopy === 'curl' ? curlOf(r.request) : ApiReport.pretty(r.response.body), b);
  });

  addEventListener('beforeunload', e => { if (R.run?.running) { e.preventDefault(); e.returnValue = ''; } });
})();
