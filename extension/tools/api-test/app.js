// UI · Kiểm thử API — lõi: khởi động, cây Collection (sidebar), điều hướng, trạng thái lưu, Environments, Collection / Folder,
// import / export workspace. Các phần khác gắn vào window.App: app-request.js (request + Send + response),
// app-tests.js (test case), app-run.js (runner, preset, kết quả).
// Nghiệp vụ ở workspace.js / engine.js (domain) và store.js / transport.js / report.js (services); file này chỉ giữ state + render.
(() => {
  const { $, $$, esc, toast, debounce, norm } = Ui;
  const LEGACY_KEY = 'api-test-v2', LEGACY_SUITE = 'api-test-v2-suite';
  const ENV_COLOR_LABEL = { green: 'Xanh lá', blue: 'Xanh dương', yellow: 'Vàng', red: 'Đỏ', gray: 'Xám' };
  const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/i;

  const App = window.App = {
    W: null,
    state: { nav: 'requests', sel: null, envSel: null, q: '', expanded: new Set() },
  };
  const S = App.state;

  // ---------- Sự kiện nội bộ ----------
  const bus = new Map();
  App.on = (ev, fn) => { if (!bus.has(ev)) bus.set(ev, new Set()); bus.get(ev).add(fn); };
  App.emit = (ev, p) => bus.get(ev)?.forEach(fn => { try { fn(p); } catch (e) { console.error(e); } });

  // ---------- Tiện ích dùng chung ----------
  App.env = () => App.W.activeEnv();
  App.isBusy = () => !!App.runActive?.();
  App.saveUi = debounce(() => {
    App.W.meta.ui = { ...App.W.meta.ui, sel: S.sel, nav: S.nav, expanded: [...S.expanded], sbW: App.W.meta.ui.sbW, splitH: App.W.meta.ui.splitH, rt: App.W.meta.ui.rt, runner: App.W.meta.ui.runner };
    App.W.saveMeta();
  }, 800);
  const isSecretKey = k => ApiRedact.isSecretName(k);
  // Ô điền nhanh giá trị biến (ghi vào environment đang dùng, hoặc Globals nếu chưa có environment)
  App.fillInput = (name, { envId = App.W.meta.activeEnvId, label = '', scope = 'x' } = {}) => {
    const env = App.W.envs[envId];
    const v = env ? env.vars.find(x => x.key === name) : App.W.meta.globals.vars.find(x => x.key === name);
    const secret = v?.secret || isSecretKey(name);
    const id = `fill-${scope}-${name.replace(/[^\w-]/g, '_')}`;
    return `<div class="fill-row">
      <label for="${id}">${label || `<code>{{${esc(name)}}}</code>`} <span class="muted small">→ ${esc(env ? env.name : 'Globals')}</span></label>
      <div class="fill-in"><input id="${id}" type="${secret ? 'password' : 'text'}" class="mono-in" data-fill="${esc(name)}" data-fill-env="${esc(envId || '')}" autocomplete="off" spellcheck="false"
        placeholder="${/url|host/i.test(name) ? 'https://api.dev.example.com' : secret ? 'Dán token / secret' : 'Giá trị'}"${App.isBusy() ? ' disabled' : ''}>
        ${secret ? `<button type="button" class="kv-eye" data-fill-eye aria-label="Hiện / ẩn ${esc(name)}"><span class="ms sm" aria-hidden="true">visibility</span></button>` : ''}</div>
    </div>`;
  };
  function setVarValue(name, value, envId) {
    const env = App.W.envs[envId];
    const list = env ? env.vars : App.W.meta.globals.vars;
    let v = list.find(x => x.key === name);
    if (!v) { v = { key: name, value: '', enabled: true }; if (isSecretKey(name)) v.secret = true; list.push(v); }
    v.value = value;
    v.enabled = true;
    if (env) App.W.touchEnv(env.id); else App.W.saveMeta();
  }
  App.setVarValue = setVarValue;
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset?.fill == null) return;
    setVarValue(t.dataset.fill, t.value, t.dataset.fillEnv || null);
  });
  document.addEventListener('change', e => { if (e.target.dataset?.fill != null) App.emit('vars'); });
  document.addEventListener('click', e => {
    const eye = e.target.closest('[data-fill-eye]');
    if (!eye) return;
    const inp = eye.parentElement.querySelector('input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    eye.firstElementChild.textContent = inp.type === 'password' ? 'visibility' : 'visibility_off';
  });
  // Cho phép host: thêm vào Allowed hosts của environment (hoặc Globals)
  App.allowHost = (host, envId = App.W.meta.activeEnvId) => {
    const env = App.W.envs[envId];
    const cur = env ? env.allowHosts : App.W.meta.globals.allowHosts;
    const list = ApiPolicy.parseList(cur);
    if (!list.includes(host.toLowerCase())) list.push(host.toLowerCase());
    if (env) App.W.updateEnv(env.id, { allowHosts: list.join('\n') });
    else { App.W.meta.globals.allowHosts = list.join('\n'); App.W.saveMeta(); }
    toast(`Đã cho phép ${host} (${env ? env.name : 'Globals'})`, 'ok', 3000);
    App.emit('vars');
  };
  // Chrome host permission (extension): phải xin trong thao tác bấm
  App.grantPermission = async urls => {
    const ok = await ApiTransport.requestPermission(urls);
    toast(ok ? 'Đã cấp quyền truy cập host' : 'Chưa được cấp quyền: Chrome chặn request tới host này', ok ? 'ok' : 'warn');
    App.emit('vars');
    return ok;
  };

  // ================= KHỞI ĐỘNG =================
  function readLegacy() {
    try {
      const v2 = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
      const s = localStorage.getItem(LEGACY_SUITE);
      return v2 || s ? { v2, suite: s } : null;
    } catch { return null; }
  }
  async function boot() {
    let opened;
    try { opened = await ApiStore.open(); } catch (e) {
      toast('Không đọc được dữ liệu đã lưu: ' + e.message, 'err', 12000);
      opened = { records: {}, session: {} };
    }
    const io = { put: ApiStore.put, remove: ApiStore.remove, setSession: ApiStore.setSession };
    const empty = !opened.records.meta;
    const records = empty ? ApiWorkspace.fresh() : opened.records;
    const W = App.W = ApiWorkspace.load(records, opened.session, io);
    if (empty) {
      for (const [k, v] of Object.entries(records)) ApiStore.put(k, v);
      const legacy = readLegacy();
      if (legacy) {
        const data = ApiWorkspace.fromLegacy(legacy.v2, legacy.suite);
        if (data) {
          W.importData(data, 'replace');
          W.meta.legacyMigrated = true;
          W.saveMeta();
          toast('Đã chuyển request, test case, scripts và environment từ phiên bản trước sang workspace mới.', 'ok', 8000);
        }
      }
    }
    if (W.problems?.length) toast(`Đã khôi phục workspace, ${W.problems.length} mục hỏng được sửa / bỏ qua: ${W.problems.slice(0, 2).join('; ')}${W.problems.length > 2 ? '…' : ''}`, 'warn', 12000);
    const ui = W.meta.ui || {};
    S.expanded = new Set(Array.isArray(ui.expanded) ? ui.expanded : W.collections().map(c => c.id));
    S.sel = ui.sel && W.get(ui.sel) ? ui.sel : null;
    if (ui.sbW) document.documentElement.style.setProperty('--sb-w', ui.sbW + 'px');
    if (narrow()) { $('#btnSidebar').setAttribute('aria-expanded', 'false'); $('#btnSidebar .ms').textContent = 'left_panel_open'; }
    ApiStore.onState(renderSaveState);
    renderEnvSelect();
    renderTree();
    App.initRequest?.();
    App.initTests?.();
    App.initRun?.();
    setNav(['requests', 'envs', 'run'].includes(ui.nav) ? ui.nav : 'requests', { initial: true });
    App.renderGuidePill?.();
    addEventListener('pagehide', () => { ApiStore.flush(); ApiTransport.cleanup(); });
  }
  document.addEventListener('DOMContentLoaded', () => { boot().catch(e => { console.error(e); toast('Lỗi khởi động: ' + e.message, 'err', 15000); }); });

  // ---------- Trạng thái lưu ----------
  function renderSaveState(s) {
    const el = $('#saveState');
    const map = {
      saving: ['progress_activity', 'Đang lưu…', 'saving'], saved: ['cloud_done', 'Đã lưu', 'saved'],
      error: ['error', 'Lưu thất bại', 'error'], quota: ['storage', 'Bộ nhớ đầy', 'error'],
    };
    const [ic, text, kind] = map[s.state] || map.saved;
    el.className = 'save-state ' + kind;
    el.title = s.message || (kind === 'saved' ? 'Mọi thay đổi đã được lưu trên máy này' : '');
    el.innerHTML = `<span class="ms sm${kind === 'saving' ? ' spin' : ''}" aria-hidden="true">${ic}</span><span class="lbl">${text}</span>${kind === 'error' ? '<button type="button" class="link-btn" data-save-retry>Thử lại</button>' : ''}`;
    if (kind === 'error' && s.message) toast(s.message, 'err', 10000, s.state === 'quota' ? { label: 'Export', fn: () => exportWorkspace() } : null);
  }
  $('#saveState').addEventListener('click', e => { if (e.target.closest('[data-save-retry]')) ApiStore.retry(); });

  // ================= ĐIỀU HƯỚNG =================
  const VIEWS = ['welcome', 'request', 'node', 'envs', 'run'];
  function showView(v) { for (const x of VIEWS) $('#view-' + x).classList.toggle('hidden', x !== v); }
  function setNav(nav, { initial = false } = {}) {
    S.nav = nav;
    for (const b of $$('.ab-tab')) { const on = b.dataset.nav === nav; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }
    if (nav === 'envs') { showView('envs'); renderEnvs(); }
    else if (nav === 'run') { showView('run'); App.renderRun?.(); }
    else showSelection();
    if (!initial) App.saveUi();
    closeSidebarOverlay();
  }
  App.setNav = setNav;
  $('.ab-nav').addEventListener('click', e => { const b = e.target.closest('[data-nav]'); if (b) setNav(b.dataset.nav); });
  $('.ab-nav').addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const list = ['requests', 'envs', 'run'];
    setNav(list[(list.indexOf(S.nav) + d + list.length) % list.length]);
    $(`.ab-tab[data-nav="${S.nav}"]`).focus();
  });
  function showSelection() {
    const n = S.sel && App.W.get(S.sel);
    if (!n) { showView('welcome'); renderWelcome(); return; }
    if (n.type === 'request') { showView('request'); App.renderRequest?.(); }
    else { showView('node'); renderNode(); }
  }
  App.select = (id, { tab, nav = true } = {}) => {
    const n = App.W.get(id);
    S.sel = n ? id : null;
    if (n) for (const a of App.W.path(id).slice(0, -1)) S.expanded.add(a.id);
    if (tab && n?.type === 'request') App.setRequestTab?.(tab, { silent: true });
    renderTree();
    if (nav) setNav('requests'); else if (S.nav === 'requests') showSelection();
    App.saveUi();
  };
  App.refreshSelection = showSelection;
  function renderWelcome() {
    const W = App.W;
    const has = !W.isEmpty();
    $('#welcomeTitle').textContent = has ? 'Chọn một request' : 'Bắt đầu kiểm thử API';
    $('#welcomeSub').textContent = has
      ? 'Chọn request ở danh sách bên trái để sửa và Send, hoặc tạo request mới. Mở Runner để chạy nhiều request / cả collection.'
      : 'Dán một request từ Postman hoặc DevTools, gửi thử ngay, rồi lưu vào collection để chạy lại bất cứ lúc nào. Không cần tạo collection hay environment trước.';
    $('[data-act="import"]').classList.toggle('hidden', has);
    // Checklist bắt đầu nhanh: chỉ hiện khi còn bước chưa làm
    const ob = App.checklistHtml?.({ compact: true }) || '';
    $('#welcomeOb').innerHTML = ob.includes('data-ob-act') ? ob : '';
  }
  App.on('tree', () => { if (!S.sel && S.nav === 'requests') renderWelcome(); });
  $('#view-welcome').addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'paste') App.pasteCurlFlow?.({ parentId: null });
    else if (a === 'new-request') newRequest(null);
    else if (a === 'import') importWorkspace();
  });

  // ---------- Sidebar: thu gọn / đổi độ rộng / overlay khi hẹp ----------
  const narrow = () => matchMedia('(max-width: 760px)').matches;
  function toggleSidebar(force) {
    const app = $('#app');
    if (narrow()) {
      const open = force ?? !app.classList.contains('sb-open');
      app.classList.toggle('sb-open', open);
      $('#sbScrim').classList.toggle('hidden', !open);
      $('#btnSidebar').setAttribute('aria-expanded', open);
      if (open) ($('#tree [tabindex="0"]') || $('#sbSearch')).focus();
    } else {
      const hide = force != null ? !force : !app.classList.contains('sb-hidden');
      app.classList.toggle('sb-hidden', hide);
      $('#btnSidebar').setAttribute('aria-expanded', !hide);
    }
    $('#btnSidebar .ms').textContent = $('#btnSidebar').getAttribute('aria-expanded') === 'true' ? 'left_panel_close' : 'left_panel_open';
  }
  function closeSidebarOverlay() { if ($('#app').classList.contains('sb-open')) toggleSidebar(false); }
  $('#btnSidebar').addEventListener('click', () => toggleSidebar());
  $('#sbScrim').addEventListener('click', () => toggleSidebar(false));
  (() => {
    const rz = $('#sbResizer');
    const set = w => {
      w = Math.max(200, Math.min(520, Math.round(w)));
      document.documentElement.style.setProperty('--sb-w', w + 'px');
      App.W.meta.ui.sbW = w;
      App.saveUi();
    };
    rz.addEventListener('pointerdown', e => {
      e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      const left = $('#sidebar').getBoundingClientRect().left;
      const move = ev => set(ev.clientX - left);
      const up = () => { rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); };
      rz.addEventListener('pointermove', move);
      rz.addEventListener('pointerup', up);
    });
    rz.addEventListener('keydown', e => {
      const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
      if (!d) return;
      e.preventDefault();
      set($('#sidebar').getBoundingClientRect().width + d);
    });
  })();

  // ================= CÂY COLLECTION =================
  const TYPE_ICON = { collection: 'inventory_2', folder: 'folder' };
  function caseCount(id) { return App.W.suite(id)?.cases.length || 0; }
  function treeRows() {
    const W = App.W;
    const found = W.search(S.q);
    const rows = [];
    const visible = n => !found || found.show.has(n.id);
    const push = (n, level) => {
      if (!visible(n)) return;
      const container = n.type !== 'request';
      const open = container && (found ? true : S.expanded.has(n.id));
      rows.push({ n, level, container, open });
      if (open) for (const c of W.children(n.id)) push(c, level + 1);
    };
    const drafts = W.drafts().filter(visible);
    if (drafts.length) {
      rows.push({ header: 'Chưa lưu', hint: 'Request chưa thuộc collection nào' });
      for (const d of drafts) push(d, 1);
    }
    const cols = W.collections();
    if (cols.length && drafts.length) rows.push({ header: 'Collections' });
    for (const c of cols) push(c, 1);
    return { rows, found };
  }
  function renderTree() {
    const { rows, found } = treeRows();
    const tree = $('#tree');
    const hl = s => {
      if (!S.q) return esc(s);
      const words = norm(S.q).split(/\s+/).filter(Boolean);
      const n = norm(s);
      const w = words.find(x => n.includes(x));
      if (!w) return esc(s);
      const i = n.indexOf(w);
      return esc(s.slice(0, i)) + `<mark>${esc(s.slice(i, i + w.length))}</mark>` + esc(s.slice(i + w.length));
    };
    if (!rows.length) {
      tree.innerHTML = found
        ? `<div class="tree-empty"><span class="ms" aria-hidden="true">search_off</span><p>Không tìm thấy “${esc(S.q)}”.</p><button type="button" class="btn btn-sm" data-tree-act="clear-search">Xoá tìm kiếm</button></div>`
        : `<div class="tree-empty"><span class="ms" aria-hidden="true">inventory_2</span><p><b>Chưa có collection</b><br><span class="muted small">Collection gom các request của một API / dự án để chạy cùng nhau.</span></p>
            <button type="button" class="btn btn-sm btn-primary" data-tree-act="new-collection"><span class="ms sm" aria-hidden="true">add</span>Tạo collection</button>
            <button type="button" class="btn btn-sm" data-tree-act="paste"><span class="ms sm" aria-hidden="true">content_paste</span>Dán cURL</button></div>`;
      return;
    }
    const focusId = S.sel && rows.some(r => r.n?.id === S.sel) ? S.sel : rows.find(r => r.n)?.n.id;
    tree.innerHTML = rows.map(r => {
      if (r.header) return `<div class="tr-section" role="presentation">${esc(r.header)}${r.hint ? `<span class="ms sm" aria-hidden="true" title="${esc(r.hint)}">info</span>` : ''}</div>`;
      const n = r.n;
      const sel = n.id === S.sel;
      const cc = n.type === 'request' ? caseCount(n.id) : 0;
      const off = n.enabled === false;
      return `<div class="tr-row t-${n.type}${sel ? ' sel' : ''}${off ? ' off' : ''}${found?.hits.has(n.id) ? ' hit' : ''}" role="treeitem" data-id="${esc(n.id)}" aria-level="${r.level}" aria-selected="${sel}"
          ${r.container ? `aria-expanded="${r.open}"` : ''} tabindex="${n.id === focusId ? 0 : -1}" style="--lvl:${r.level - 1}" title="${esc(n.type === 'request' ? `${n.method} ${n.url}` : n.name)}">
        ${r.container ? `<span class="tr-tw ms sm" data-twisty aria-hidden="true">chevron_right</span>` : '<span class="tr-tw"></span>'}
        ${n.type === 'request' ? `<span class="tr-m m-${esc(n.method.toLowerCase())}">${esc(n.method === 'DELETE' ? 'DEL' : n.method === 'OPTIONS' ? 'OPT' : n.method)}</span>` : `<span class="ms sm tr-ic" aria-hidden="true">${r.open && n.type === 'folder' ? 'folder_open' : TYPE_ICON[n.type]}</span>`}
        <span class="tr-name">${hl(n.name)}</span>
        ${off ? '<span class="ms sm tr-off" aria-label="Đang tắt khi chạy" title="Đang tắt: bỏ qua khi chạy collection / folder">block</span>' : ''}
        ${cc ? `<span class="tr-n" title="${cc} test case">${cc}</span>` : ''}
        <button type="button" class="tr-more" data-more tabindex="-1" aria-label="Thao tác với ${esc(n.name)}"><span class="ms sm" aria-hidden="true">more_horiz</span></button>
      </div>`;
    }).join('');
  }
  App.renderTree = renderTree;
  App.on('tree', renderTree);
  App.on('suite', renderTree);

  const sbSearch = $('#sbSearch');
  sbSearch.addEventListener('input', debounce(() => { S.q = sbSearch.value.trim(); renderTree(); }, 120));
  sbSearch.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sbSearch.value) { e.preventDefault(); e.stopPropagation(); sbSearch.value = ''; S.q = ''; renderTree(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('#tree [role=treeitem]')?.focus(); }
  });
  function toggle(id, open) {
    if (open ?? !S.expanded.has(id)) S.expanded.add(id); else S.expanded.delete(id);
    renderTree();
    App.saveUi();
    $(`#tree [data-id="${CSS.escape(id)}"]`)?.focus();
  }
  $('#tree').addEventListener('click', e => {
    const act = e.target.closest('[data-tree-act]')?.dataset.treeAct;
    if (act === 'clear-search') { sbSearch.value = ''; S.q = ''; renderTree(); sbSearch.focus(); return; }
    if (act === 'new-collection') { newCollection(); return; }
    if (act === 'paste') { App.pasteCurlFlow?.({ parentId: null }); return; }
    const row = e.target.closest('.tr-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-more]')) { nodeMenu(id, e.target.closest('[data-more]')); return; }
    if (e.target.closest('[data-twisty]')) { toggle(id); return; }
    if (App.W.get(id).type !== 'request') S.expanded.add(id);
    App.select(id);
    closeSidebarOverlay();
  });
  $('#tree').addEventListener('dblclick', e => { const row = e.target.closest('.tr-row'); if (row && !e.target.closest('button')) renameNode(row.dataset.id); });
  $('#tree').addEventListener('contextmenu', e => {
    const row = e.target.closest('.tr-row');
    if (!row) return;
    e.preventDefault();
    nodeMenu(row.dataset.id, row, { x: e.clientX, y: e.clientY });
  });
  $('#tree').addEventListener('keydown', e => {
    const row = e.target.closest('.tr-row');
    if (!row) return;
    const id = row.dataset.id, n = App.W.get(id);
    const rows = $$('#tree .tr-row');
    const i = rows.indexOf(row);
    const focus = r => { if (!r) return; rows.forEach(x => (x.tabIndex = -1)); r.tabIndex = 0; r.focus(); };
    const container = n.type !== 'request';
    const open = row.getAttribute('aria-expanded') === 'true';
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); if (App.W.reorder(id, e.key === 'ArrowUp' ? -1 : 1)) { renderTree(); $(`#tree [data-id="${CSS.escape(id)}"]`)?.focus(); } return; }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focus(rows[i + 1]); break;
      case 'ArrowUp': e.preventDefault(); if (i === 0) sbSearch.focus(); else focus(rows[i - 1]); break;
      case 'Home': e.preventDefault(); focus(rows[0]); break;
      case 'End': e.preventDefault(); focus(rows.at(-1)); break;
      case 'ArrowRight': e.preventDefault(); if (container && !open) toggle(id, true); else if (container) focus(rows[i + 1]); break;
      case 'ArrowLeft': e.preventDefault(); if (container && open) toggle(id, false); else if (n.parentId) focus($(`#tree [data-id="${CSS.escape(n.parentId)}"]`)); break;
      case 'Enter': case ' ': e.preventDefault(); App.select(id); break;
      case 'F2': e.preventDefault(); renameNode(id); break;
      case 'Delete': e.preventDefault(); deleteNode(id); break;
      case 'ContextMenu': e.preventDefault(); nodeMenu(id, row); break;
      default: if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); nodeMenu(id, row); }
    }
  });

  // ---------- Thao tác trên node ----------
  async function newCollection() {
    const name = await Ui.promptBox({ title: 'Tạo collection', label: 'Tên collection', placeholder: 'vd Student API', okText: 'Tạo' });
    if (!name) return null;
    const c = App.W.createCollection({ name });
    S.expanded.add(c.id);
    App.select(c.id);
    toast(`Đã tạo collection ${name}`, 'ok', 2500);
    return c;
  }
  App.newCollection = newCollection;
  async function newFolder(parentId) {
    const name = await Ui.promptBox({ title: 'Tạo folder', label: 'Tên folder', placeholder: 'vd Authentication', okText: 'Tạo' });
    if (!name) return;
    const f = App.W.createFolder(parentId, { name });
    S.expanded.add(parentId);
    S.expanded.add(f.id);
    App.select(f.id);
  }
  function newRequest(parentId, data = {}) {
    const r = App.W.createRequest(parentId, { name: 'Request mới', method: 'GET', url: '', auth: { type: parentId ? 'inherit' : 'none' }, ...data });
    if (parentId) S.expanded.add(parentId);
    App.select(r.id, { tab: 'params' });
    setTimeout(() => $('#rqUrl')?.focus(), 30);
    return r;
  }
  App.newRequest = newRequest;
  async function renameNode(id) {
    const n = App.W.get(id);
    if (!n) return;
    const name = await Ui.promptBox({ title: `Đổi tên ${n.type === 'request' ? 'request' : n.type}`, label: 'Tên mới', value: n.name, okText: 'Đổi tên' });
    if (!name || name === n.name) return;
    App.W.rename(id, name);
    renderTree();
    App.refreshSelection();
    $(`#tree [data-id="${CSS.escape(id)}"]`)?.focus();
  }
  App.renameNode = renameNode;
  function moveTargets(id) {
    const W = App.W, n = W.get(id);
    const opts = [];
    if (n.type === 'request') opts.push({ value: '', label: 'Chưa lưu (không thuộc collection)', depth: 0 });
    const walk = (x, depth) => {
      opts.push({ value: x.id, label: x.name, depth, disabled: !W.canMove(id, x.id) && x.id !== n.parentId });
      for (const c of W.children(x.id)) if (c.type === 'folder') walk(c, depth + 1);
    };
    for (const c of W.collections()) walk(c, 0);
    return opts;
  }
  async function moveNode(id, { title } = {}) {
    const n = App.W.get(id);
    const opts = moveTargets(id);
    if (!opts.some(o => o.value && !o.disabled)) {
      const c = await Ui.confirmBox('Chưa có collection', '<p>Tạo một collection để lưu request này?</p>', 'Tạo collection', { danger: false });
      if (!c) return;
      const col = await newCollection();
      if (col) { App.W.move(id, col.id); App.select(id); toast(`Đã lưu vào ${col.name}`, 'ok', 2500); }
      return;
    }
    const to = await Ui.chooseBox({ title: title || `Di chuyển "${n.name}"`, label: 'Tới', options: opts, value: n.parentId || opts.find(o => o.value && !o.disabled)?.value, okText: 'Di chuyển' });
    if (to == null || to === (n.parentId || '')) return;
    try {
      App.W.move(id, to || null);
      if (to) S.expanded.add(to);
      App.select(id, { nav: S.nav === 'requests' });
      toast(to ? `Đã chuyển vào ${App.W.get(to).name}` : 'Đã chuyển vào Chưa lưu', 'ok', 2500);
    } catch (e) { toast(e.message, 'err'); }
  }
  App.moveNode = moveNode;
  App.saveDraftTo = id => moveNode(id, { title: 'Lưu request vào collection' });
  function duplicateNode(id) {
    const c = App.W.duplicate(id);
    if (!c) return;
    App.select(c.id, { nav: S.nav === 'requests' });
    toast(`Đã nhân bản: ${c.name}`, 'ok', 2500);
  }
  async function deleteNode(id) {
    if (App.isBusy()) { toast('Đang chạy: bấm Stop trước khi xoá', 'warn'); return; }
    const W = App.W, n = W.get(id);
    if (!n) return;
    const all = [n, ...W.descendants(id)];
    const reqs = all.filter(x => x.type === 'request');
    const cases = reqs.reduce((s, r) => s + caseCount(r.id), 0);
    const what = n.type === 'request' ? `request <b>${esc(n.name)}</b>${cases ? ` cùng ${cases} test case` : ''}` : `${n.type} <b>${esc(n.name)}</b> cùng ${reqs.length} request${cases ? ` và ${cases} test case` : ''} bên trong`;
    const ok = await Ui.confirmBox(`Xoá ${n.type === 'request' ? 'request' : n.type}?`, `<p>Xoá ${what}. Có thể hoàn tác ngay sau khi xoá.</p>`, 'Xoá');
    if (!ok) return;
    const snap = W.remove(id);
    if (S.sel && !W.get(S.sel)) S.sel = n.parentId && W.get(n.parentId) ? n.parentId : null;
    renderTree();
    App.refreshSelection();
    App.emit('tree');
    toast(`Đã xoá ${n.name}`, 'info', 10000, { label: 'Hoàn tác', fn: () => { W.restore(snap); App.select(id, { nav: S.nav === 'requests' }); toast('Đã hoàn tác', 'ok', 2000); } });
  }
  App.deleteNode = deleteNode;
  function nodeMenu(id, anchor, pos) {
    const W = App.W, n = W.get(id);
    if (!n) return;
    const container = n.type !== 'request';
    const list = W.siblings(id);
    const i = list ? list.indexOf(id) : -1;
    const items = [];
    if (container) {
      items.push({ label: 'Thêm request', icon: 'add', action: () => newRequest(id) });
      items.push({ label: 'Thêm folder', icon: 'create_new_folder', action: () => newFolder(id) });
      items.push({ label: `Run ${n.type === 'collection' ? 'collection' : 'folder'}`, icon: 'play_arrow', action: () => App.runScope?.({ collectionId: W.collectionOf(id)?.id || id, targets: n.type === 'collection' ? [] : [id] }) });
      items.push('sep');
    } else {
      items.push({ label: 'Mở', icon: 'open_in_new', action: () => App.select(id) });
      items.push({ label: 'Run tests', icon: 'play_arrow', disabled: !n.parentId && !caseCount(id), action: () => App.runRequest?.(id) });
      items.push({ label: 'Copy as cURL', icon: 'terminal', action: () => App.copyAsCurl?.(id) });
      items.push('sep');
    }
    items.push({ label: 'Đổi tên', icon: 'edit', hint: 'F2', action: () => renameNode(id) });
    items.push({ label: 'Nhân bản', icon: 'content_copy', action: () => duplicateNode(id) });
    if (n.type === 'request' && !n.parentId) items.push({ label: 'Lưu vào collection…', icon: 'save', action: () => App.saveDraftTo(id) });
    else if (n.type !== 'collection') items.push({ label: 'Di chuyển tới…', icon: 'drive_file_move', action: () => moveNode(id) });
    if (n.parentId || n.type === 'collection') {
      items.push({ label: n.enabled === false ? 'Bật khi chạy' : 'Tắt khi chạy', icon: n.enabled === false ? 'toggle_on' : 'toggle_off',
        action: () => { W.setEnabled(id, n.enabled === false); renderTree(); App.refreshSelection(); toast(n.enabled === false ? `Đã tắt ${n.name}: bỏ qua khi chạy` : `Đã bật ${n.name}`, 'info', 2500); } });
    }
    if (list && list.length > 1) {
      items.push({ label: 'Lên trên', icon: 'arrow_upward', hint: 'Alt+↑', disabled: i <= 0, action: () => { W.reorder(id, -1); renderTree(); } });
      items.push({ label: 'Xuống dưới', icon: 'arrow_downward', hint: 'Alt+↓', disabled: i >= list.length - 1, action: () => { W.reorder(id, 1); renderTree(); } });
    }
    items.push('sep', { label: 'Xoá', icon: 'delete', hint: 'Del', danger: true, action: () => deleteNode(id) });
    Ui.menu(anchor, items, pos);
  }
  App.nodeMenu = nodeMenu;

  // ---------- Nút Tạo mới (+) ----------
  function newTarget() {
    const n = S.sel && App.W.get(S.sel);
    if (!n) return null;
    return n.type === 'request' ? n.parentId : n.id;
  }
  $('#btnNew').addEventListener('click', e => {
    const parent = newTarget();
    const W = App.W;
    Ui.menu(e.currentTarget, [
      { label: parent ? `Request trong "${W.get(parent).name}"` : 'Request (chưa lưu)', icon: 'add_box', action: () => newRequest(parent) },
      { label: 'Request từ cURL / fetch', icon: 'content_paste', action: () => App.pasteCurlFlow?.({ parentId: parent }) },
      'sep',
      { label: 'Collection', icon: 'inventory_2', action: () => newCollection() },
      { label: parent ? `Folder trong "${W.get(parent).name}"` : 'Folder (chọn collection trước)', icon: 'create_new_folder', disabled: !parent, action: () => newFolder(parent) },
    ]);
  });
  $('#btnPasteCurl').addEventListener('click', () => App.pasteCurlFlow?.({ parentId: newTarget() }));

  // ================= ENVIRONMENT: CHỌN NHANH =================
  function renderEnvSelect() {
    const W = App.W, cur = W.activeEnv();
    $('#envSelect').innerHTML = W.envList().map(e => `<option value="${esc(e.id)}"${e.id === cur?.id ? ' selected' : ''}>${esc(e.name)}${W.isProdEnv(e) ? ' · PROD' : ''}</option>`).join('')
      + `<option value=""${!cur ? ' selected' : ''}>Không dùng environment</option><option value="__manage">Quản lý environments…</option>`;
    $('#envTopDot').dataset.color = cur?.color || 'none';
    $('#envPickTop').classList.toggle('prod', W.isProdEnv(cur));
    $('#envPickTop').title = cur ? `Environment: ${cur.name}${W.isProdEnv(cur) ? ' (PRODUCTION)' : ''}` : 'Chưa chọn environment';
  }
  App.renderEnvSelect = renderEnvSelect;
  $('#envSelect').addEventListener('change', e => {
    const v = e.target.value;
    if (v === '__manage') { renderEnvSelect(); S.envSel = App.W.meta.activeEnvId; setNav('envs'); return; }
    if (App.isBusy()) { toast('Đang chạy: đổi environment sau khi chạy xong', 'warn'); renderEnvSelect(); return; }
    App.W.setActiveEnv(v || null);
    renderEnvSelect();
    const env = App.env();
    toast(env ? `Đang dùng ${env.name}` : 'Không dùng environment', App.W.isProdEnv(env) ? 'warn' : 'info', 2500);
    App.emit('env');
    App.emit('vars');
    if (S.nav === 'envs') renderEnvs();
  });

  // ================= ENVIRONMENTS (quản lý) =================
  function usedVars() {
    // Biến request trong workspace đang dùng → số request dùng
    const W = App.W, out = new Map();
    for (const n of Object.values(W.nodes)) {
      if (n.type !== 'request') continue;
      const f = W.varFlow(n.id);
      for (const v of new Set([...f.uses, ...f.caseUses])) { if (!out.has(v)) out.set(v, []); out.get(v).push(n); }
    }
    return out;
  }
  function hostChipsHtml(text) {
    const list = ApiPolicy.parseList(text);
    return list.map((h, i) => {
      const internal = !h.startsWith('*.') && ApiPolicy.isPrivateHost(h.replace(/:\d+$/, ''));
      return `<span class="host-chip${internal ? ' internal' : ''}" title="${internal ? 'Host nội bộ' : h.startsWith('*.') ? 'Mọi subdomain' : 'Host'}">
        <span class="ms sm" aria-hidden="true">${h.startsWith('*.') ? 'public' : internal ? 'lan' : 'dns'}</span>${esc(h)}
        <button type="button" data-host-del="${i}" aria-label="Bỏ host ${esc(h)}"><span class="ms sm" aria-hidden="true">close</span></button></span>`;
    }).join('');
  }
  // Ô nhập Allowed hosts dạng thẻ: get() → chữ, set(chữ)
  function bindHostBox(box, get, set) {
    const input = box.querySelector('.host-input');
    const msg = box.parentElement.querySelector('.host-msg');
    const redraw = (m = '') => {
      box.querySelector('.host-chips').innerHTML = hostChipsHtml(get());
      box.classList.toggle('empty', !ApiPolicy.parseList(get()).length);
      if (msg) { msg.textContent = m || (ApiPolicy.parseList(get()).length ? '' : 'Chưa có host nào: request sẽ bị chặn.'); msg.className = 'host-msg ' + (m ? 'err-t' : ApiPolicy.parseList(get()).length ? '' : 'warn-t'); }
    };
    const add = text => {
      const list = ApiPolicy.parseList(get()), bad = [];
      for (const raw of String(text).split(/[\s,;]+/)) {
        const h = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!h) continue;
        if (!HOST_RE.test(h)) bad.push(raw.trim());
        else if (!list.includes(h)) list.push(h);
      }
      set(list.join('\n'));
      redraw(bad.length ? `Không phải host hợp lệ: ${bad.join(', ')}` : '');
    };
    const commit = () => { if (input.value.trim()) { add(input.value); input.value = ''; } };
    input.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && input.value.trim()) { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value) { const l = ApiPolicy.parseList(get()); if (l.length) { l.pop(); set(l.join('\n')); redraw(); } }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('paste', () => setTimeout(commit, 0));
    box.addEventListener('click', e => {
      const del = e.target.closest('[data-host-del]');
      if (del) { const l = ApiPolicy.parseList(get()); l.splice(Number(del.dataset.hostDel), 1); set(l.join('\n')); redraw(); input.focus(); return; }
      if (e.target === box || e.target.classList.contains('host-chips')) input.focus();
    });
    redraw();
    return { redraw, add };
  }
  App.bindHostBox = bindHostBox;
  const hostBoxHtml = (id, ph = 'api.dev.example.com') => `<div class="host-box" id="${id}"><div class="host-chips"></div><input type="text" class="host-input mono-in" spellcheck="false" autocomplete="off" placeholder="${ph}" aria-label="Thêm allowed host"></div><div class="host-foot"><span class="host-msg" role="status"></span></div>`;

  function renderEnvs() {
    const W = App.W;
    const box = $('#view-envs');
    if (S.envSel !== 'globals' && S.envSel !== 'runtime' && !W.envs[S.envSel]) S.envSel = W.meta.activeEnvId || W.envList()[0]?.id || 'globals';
    const used = usedVars();
    const rt = W.runtime();
    box.innerHTML = `
      <div class="view-head pad">
        <div><h2>Environments ${App.helpBtn?.('vars', 'Hướng dẫn biến & environment') || ''}</h2><p class="muted small">Cấu hình một lần, dùng cho mọi request: <code>{{baseUrl}}</code>, token, header chung, host được phép gửi. Thứ tự ưu tiên biến: <b>Runtime › Environment › Collection › Globals</b>.</p></div>
        <button type="button" class="btn btn-primary btn-sm" data-env-act="new"><span class="ms sm" aria-hidden="true">add</span>Tạo environment</button>
      </div>
      ${App.tip?.('envs', '<b>Mẹo:</b> chọn environment bên trái, điền <code>baseUrl</code> và token, thêm host vào <b>Allowed hosts</b>. Đổi environment ở thanh trên cùng là mọi request đổi theo.', 'vars') || ''}
      <div class="env-layout">
        <nav class="env-list" aria-label="Danh sách environment">
          ${W.envList().map(e => `<button type="button" class="env-item${S.envSel === e.id ? ' on' : ''}" data-env-pick="${esc(e.id)}" aria-current="${S.envSel === e.id}">
            <span class="env-dot" data-color="${esc(e.color)}" aria-hidden="true"></span>
            <span class="env-txt"><b>${esc(e.name)}</b><span>${e.vars.filter(v => v.key && v.value !== '').length} biến · ${ApiPolicy.parseList(e.allowHosts).length} host</span></span>
            ${e.id === W.meta.activeEnvId ? '<span class="badge badge-primary">Đang dùng</span>' : ''}${W.isProdEnv(e) ? '<span class="badge badge-error">PROD</span>' : ''}
          </button>`).join('') || '<p class="muted small env-none">Chưa có environment nào.</p>'}
          <div class="env-sep"></div>
          <button type="button" class="env-item${S.envSel === 'globals' ? ' on' : ''}" data-env-pick="globals"><span class="ms sm" aria-hidden="true">public</span><span class="env-txt"><b>Globals</b><span>Dùng cho mọi environment</span></span></button>
          <button type="button" class="env-item${S.envSel === 'runtime' ? ' on' : ''}" data-env-pick="runtime"><span class="ms sm" aria-hidden="true">bolt</span><span class="env-txt"><b>Runtime (phiên)</b><span>${Object.keys(rt).length} biến do Send / extract / script đặt</span></span></button>
        </nav>
        <div class="env-edit" id="envEdit"></div>
      </div>`;
    const ed = $('#envEdit');
    if (S.envSel === 'runtime') return renderRuntime(ed);
    const isG = S.envSel === 'globals';
    const env = isG ? null : W.envs[S.envSel];
    if (!isG && !env) {
      ed.innerHTML = `<div class="empty-state"><span class="ms lg" aria-hidden="true">dns</span><h3>Chưa có environment</h3><p class="muted">Tạo DEV, STAGING… để đổi máy chủ / token chỉ bằng một lần chọn.</p><button type="button" class="btn btn-primary" data-env-act="new">Tạo environment</button></div>`;
      return;
    }
    const target = isG ? W.meta.globals : env;
    const resolvedHave = new Set(target.vars.filter(v => v.key && v.value !== '').map(v => v.key));
    const missing = [...used].filter(([v]) => !resolvedHave.has(v) && !(isG ? false : W.meta.globals.vars.some(g => g.key === v && g.value !== '')))
      .filter(([v, reqs]) => !reqs.every(r => W.collectionOf(r.id)?.vars.some(x => x.key === v && x.value !== '')))
      .filter(([v]) => !W.producers(v).length); // biến do request khác sinh ra (extract / script) không cần nhập tay
    ed.innerHTML = `
      ${isG ? `<div class="env-title"><h3><span class="ms sm" aria-hidden="true">public</span> Globals</h3><p class="muted small">Biến và host dùng chung cho mọi environment. Environment có biến cùng tên sẽ ghi đè.</p></div>`
        : `<div class="env-title">
            <input type="text" class="title-in" id="envName" value="${esc(env.name)}" aria-label="Tên environment">
            <div class="row-actions">
              ${env.id === W.meta.activeEnvId ? '<span class="badge badge-primary">Đang dùng</span>' : `<button type="button" class="btn btn-sm" data-env-act="use"><span class="ms sm" aria-hidden="true">check</span>Dùng environment này</button>`}
              <button type="button" class="btn btn-sm btn-ghost" data-env-act="dup"><span class="ms sm" aria-hidden="true">content_copy</span>Nhân bản</button>
              <button type="button" class="btn btn-sm btn-ghost" data-env-act="del"><span class="ms sm" aria-hidden="true">delete</span>Xoá</button>
            </div>
          </div>
          <div class="env-props">
            <div class="color-pick" role="radiogroup" aria-label="Màu nhận diện">${ApiWorkspace.ENV_COLORS.map(c => `<button type="button" role="radio" class="color-dot" data-color="${c}" aria-checked="${env.color === c}" aria-label="${ENV_COLOR_LABEL[c]}" title="${ENV_COLOR_LABEL[c]}"></button>`).join('')}</div>
            <label class="check"><input type="checkbox" id="envProd" ${env.isProd ? 'checked' : ''}> Production <span class="muted small">(mỗi lần Run / Send ghi dữ liệu phải xác nhận)</span></label>
          </div>
          ${W.isProdEnv(env) ? '<div class="prod-note"><span class="ms sm fill" aria-hidden="true">warning</span><span><b>Production.</b> Request ghi dữ liệu (POST / PUT / PATCH / DELETE) và mọi lần Run đều phải xác nhận.</span></div>' : ''}`}
      ${missing.length ? `<div class="fill-box"><p class="fill-title"><span class="ms sm" aria-hidden="true">edit_note</span>Request đang dùng biến chưa có giá trị ở đây</p>
        ${missing.slice(0, 8).map(([v, reqs]) => `<div class="miss-var"><code>{{${esc(v)}}}</code><span class="muted small">${reqs.length} request: ${reqs.slice(0, 2).map(r => esc(r.name)).join(', ')}${reqs.length > 2 ? '…' : ''}</span><button type="button" class="btn btn-sm" data-add-var="${esc(v)}">Thêm</button></div>`).join('')}</div>` : ''}
      <section class="set-sec">
        <div class="set-h"><h3><span class="ms sm" aria-hidden="true">data_object</span>Variables</h3><p class="muted small">Dùng bằng <code>{{NAME}}</code> ở URL, params, headers, body, auth. Bấm <span class="ms sm inline-ic" aria-hidden="true">lock</span> để đánh dấu secret: chỉ giữ trong phiên trình duyệt, che trong báo cáo, không export.</p></div>
        <div class="kv" id="envVars"></div>
      </section>
      <section class="set-sec">
        <div class="set-h"><h3><span class="ms sm" aria-hidden="true">shield</span>Allowed hosts</h3><p class="muted small">Chỉ gửi request tới các host này (chống gửi nhầm sang hệ thống khác). Gõ host rồi <kbd>Enter</kbd>; <code>*.example.com</code> cho mọi subdomain; localhost / IP nội bộ phải ghi đúng tên.${isG ? '' : ' Host ở Globals cũng được tính.'}</p></div>
        ${hostBoxHtml('envHosts')}
      </section>
      ${isG ? '' : `<section class="set-sec">
        <div class="set-h"><h3><span class="ms sm" aria-hidden="true">list_alt</span>Headers của environment</h3><p class="muted small">Gửi kèm mọi request khi dùng environment này, ghi đè header trùng tên của request.</p></div>
        <div class="kv" id="envHeaders"></div>
      </section>`}`;
    const changed = () => { if (env) W.touchEnv(env.id); else W.saveMeta(); App.emit('vars'); };
    Ui.kvEditor($('#envVars'), () => target.vars, {
      secret: true, enabled: true, keyLabel: 'Variable', keyPh: 'NAME', valPh: 'value', addText: 'Thêm variable',
      empty: 'Chưa có variable.', suggest: [{ key: 'baseUrl', value: '', label: 'baseUrl' }, { key: 'TOKEN', value: '', label: 'TOKEN', secret: true }],
      onChange: changed, locked: App.isBusy,
    }).render();
    if (!isG) {
      Ui.kvEditor($('#envHeaders'), () => env.headers, {
        enabled: true, keyLabel: 'Header', keyPh: 'Header-Name', valPh: 'value', addText: 'Thêm header', empty: 'Thường không cần.',
        suggest: [{ key: 'Authorization', value: 'Bearer {{TOKEN}}', label: 'Authorization: Bearer {{TOKEN}}' }, { key: 'Accept-Language', value: 'vi', label: 'Accept-Language: vi' }],
        onChange: changed, locked: App.isBusy,
      }).render();
    }
    bindHostBox($('#envHosts'), () => target.allowHosts, v => { target.allowHosts = v; changed(); });
    $('#envName')?.addEventListener('change', e => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = env.name; return; }
      W.updateEnv(env.id, { name: v });
      renderEnvSelect();
      renderEnvs();
    });
    $('#envProd')?.addEventListener('change', e => { W.updateEnv(env.id, { isProd: e.target.checked }); renderEnvSelect(); renderEnvs(); });
    $('.color-pick')?.addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) { W.updateEnv(env.id, { color: b.dataset.color }); renderEnvSelect(); renderEnvs(); $(`.color-dot[data-color="${b.dataset.color}"]`)?.focus(); } });
  }
  App.renderEnvs = renderEnvs;
  App.openEnvManager = (envId, { focusVar, focusHosts } = {}) => {
    S.envSel = envId || App.W.meta.activeEnvId || 'globals';
    setNav('envs');
    if (focusVar) {
      const target = App.W.envs[S.envSel] || App.W.meta.globals;
      if (!target.vars.some(v => v.key === focusVar)) { target.vars.push({ key: focusVar, value: '', enabled: true, ...(isSecretKey(focusVar) ? { secret: true } : {}) }); renderEnvs(); }
      const row = $$('#envVars .kv-row').find(r => r.querySelector('[data-f="key"]')?.value === focusVar);
      row?.querySelector('[data-f="value"]')?.focus();
    }
    if (focusHosts) $('#envHosts .host-input')?.focus();
  };
  function renderRuntime(ed) {
    const W = App.W, rt = W.runtime();
    const keys = Object.keys(rt);
    const shown = k => (isSecretKey(k) ? ApiRedact.MASK : String(rt[k]).length > 120 ? String(rt[k]).slice(0, 120) + '…' : String(rt[k]));
    ed.innerHTML = `<div class="env-title"><h3><span class="ms sm" aria-hidden="true">bolt</span> Runtime variables (phiên hiện tại)</h3>
        <p class="muted small">Biến do Send đặt ra: extract từ response, <code>pm.environment.set</code> trong script. Có ưu tiên cao nhất, chỉ sống trong phiên trình duyệt và <b>không</b> tự ghi đè environment. Runner mặc định bắt đầu sạch (không dùng các biến này) trừ khi bật trong tuỳ chọn chạy.</p></div>
      ${keys.length ? `<div class="table-wrap kv-view"><table><thead><tr><th>Biến</th><th>Giá trị</th><th></th></tr></thead><tbody>
        ${keys.map(k => `<tr><th scope="row"><code>${esc(k)}</code></th><td class="mono small">${esc(shown(k))}</td><td class="rt-acts">
          <button type="button" class="btn btn-sm" data-rt-save="${esc(k)}" ${W.activeEnv() ? '' : 'disabled'} title="${W.activeEnv() ? `Lưu vào ${esc(W.activeEnv().name)}` : 'Chưa chọn environment'}">Lưu vào environment</button>
          <button type="button" class="icon-btn" data-rt-del="${esc(k)}" aria-label="Xoá ${esc(k)}"><span class="ms sm" aria-hidden="true">delete</span></button></td></tr>`).join('')}
        </tbody></table></div>
        <div class="row-actions"><button type="button" class="btn btn-sm btn-ghost" data-rt-clear><span class="ms sm" aria-hidden="true">delete_sweep</span>Xoá tất cả</button></div>`
      : '<div class="empty-state"><span class="ms lg" aria-hidden="true">bolt</span><h3>Chưa có runtime variable</h3><p class="muted">Ở tab Tests của một request, mục “Lưu biến từ response” (vd TOKEN từ $.data.access_token), rồi Send: biến xuất hiện ở đây và request khác dùng được ngay.</p></div>'}`;
  }

  $('#view-envs').addEventListener('click', async e => {
    const W = App.W;
    const pick = e.target.closest('[data-env-pick]');
    if (pick) { S.envSel = pick.dataset.envPick; renderEnvs(); $(`[data-env-pick="${CSS.escape(S.envSel)}"]`)?.focus(); return; }
    const addVar = e.target.closest('[data-add-var]');
    if (addVar) { App.openEnvManager(S.envSel === 'globals' ? null : S.envSel, { focusVar: addVar.dataset.addVar }); return; }
    const rs = e.target.closest('[data-rt-save]');
    if (rs) {
      const env = W.activeEnv();
      const k = rs.dataset.rtSave;
      setVarValue(k, String(W.runtime()[k] ?? ''), env.id);
      toast(`Đã lưu {{${k}}} vào ${env.name}${isSecretKey(k) ? ' (secret, chỉ giữ trong phiên)' : ''}`, 'ok', 3000);
      App.emit('vars');
      renderEnvs();
      return;
    }
    const rd = e.target.closest('[data-rt-del]');
    if (rd) { const rt = { ...W.runtime() }; delete rt[rd.dataset.rtDel]; W.setRuntime(rt); renderEnvs(); App.emit('vars'); return; }
    if (e.target.closest('[data-rt-clear]')) { W.setRuntime({}); renderEnvs(); App.emit('vars'); toast('Đã xoá runtime variables', 'info', 2500); return; }
    const act = e.target.closest('[data-env-act]')?.dataset.envAct;
    if (!act) return;
    if (act === 'new') {
      const name = await Ui.promptBox({ title: 'Tạo environment', label: 'Tên', placeholder: 'vd LOCAL, DEV, UAT', okText: 'Tạo',
        validate: v => (!v ? 'Không được để trống' : W.envList().some(x => x.name.toLowerCase() === v.toLowerCase()) ? 'Đã có environment trùng tên' : '') });
      if (!name) return;
      const env = W.createEnv({ name, isProd: /\bprod/i.test(name), color: /\bprod/i.test(name) ? 'red' : 'blue' });
      if (!W.meta.activeEnvId) W.setActiveEnv(env.id);
      S.envSel = env.id;
      renderEnvSelect();
      renderEnvs();
      $('#envVars [data-f="value"]')?.focus();
    } else if (act === 'use') {
      W.setActiveEnv(S.envSel);
      renderEnvSelect();
      renderEnvs();
      App.emit('env');
      App.emit('vars');
    } else if (act === 'dup') {
      const env = W.createEnv({}, { copyFrom: S.envSel });
      S.envSel = env.id;
      renderEnvSelect();
      renderEnvs();
      toast(`Đã nhân bản: ${env.name}`, 'ok', 2500);
    } else if (act === 'del') {
      const env = W.envs[S.envSel];
      const ok = await Ui.confirmBox(`Xoá environment ${env.name}?`, `<p>Xoá ${env.vars.length} biến, ${env.headers.length} header và danh sách host của <b>${esc(env.name)}</b>. Preset đang dùng environment này sẽ phải chọn lại. Có thể hoàn tác ngay sau khi xoá.</p>`, 'Xoá');
      if (!ok) return;
      const snap = W.removeEnv(env.id);
      S.envSel = W.meta.activeEnvId;
      renderEnvSelect();
      renderEnvs();
      App.emit('vars');
      toast(`Đã xoá ${env.name}`, 'info', 10000, { label: 'Hoàn tác', fn: () => { W.restoreEnv(snap); renderEnvSelect(); renderEnvs(); } });
    }
  });

  // ================= AUTHORIZATION (dùng chung cho request / folder / collection) =================
  // node.auth = { type: inherit | none | bearer | basic | apikey, … }
  App.authEditor = (box, node, { onChange, inheritNote = '' } = {}) => {
    const W = App.W;
    const draw = () => {
      const a = node.auth;
      const allowInherit = node.type !== 'collection';
      const eff = a.type === 'inherit' ? W.effectiveAuth(node.id) : null;
      const opts = [...(allowInherit ? [['inherit', 'Kế thừa từ cấp trên']] : []), ['none', 'Không xác thực'], ['bearer', 'Bearer Token'], ['basic', 'Basic Auth'], ['apikey', 'API Key']];
      const field = (f, label, ph, type = 'text') => `<div><label for="au-${f}">${label}</label><div class="fill-in"><input id="au-${f}" type="${type}" class="mono-in" data-au="${f}" value="${esc(a[f] || '')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"${App.isBusy() ? ' disabled' : ''}>${type === 'password' ? '<button type="button" class="kv-eye" data-au-eye aria-label="Hiện / ẩn"><span class="ms sm" aria-hidden="true">visibility</span></button>' : ''}</div></div>`;
      const literal = v => v && !/\{\{/.test(v);
      const lit = (a.type === 'bearer' && literal(a.token)) || (a.type === 'basic' && literal(a.password)) || (a.type === 'apikey' && literal(a.value));
      box.innerHTML = `<div class="auth-grid">
          <div><label for="au-type">Kiểu xác thực</label><select id="au-type" data-au="type"${App.isBusy() ? ' disabled' : ''}>${opts.map(([v, l]) => `<option value="${v}"${a.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          ${a.type === 'bearer' ? field('token', 'Token', '{{TOKEN}}', 'password') : ''}
          ${a.type === 'basic' ? field('username', 'Username', '{{USERNAME}}') + field('password', 'Password', '{{PASSWORD}}', 'password') : ''}
          ${a.type === 'apikey' ? field('key', 'Tên header / param', 'X-API-Key') + field('value', 'Giá trị', '{{API_KEY}}', 'password')
            + `<div><label for="au-in">Gửi ở</label><select id="au-in" data-au="in"><option value="header"${a.in !== 'query' ? ' selected' : ''}>Header</option><option value="query"${a.in === 'query' ? ' selected' : ''}>Query param</option></select></div>` : ''}
        </div>
        ${a.type === 'inherit' ? `<p class="muted small auth-note"><span class="ms sm" aria-hidden="true">subdirectory_arrow_right</span>${eff.from ? `Dùng <b>${esc({ none: 'Không xác thực', bearer: 'Bearer Token', basic: 'Basic Auth', apikey: 'API Key' }[eff.auth.type])}</b> của ${eff.from.type} <b>${esc(eff.from.name)}</b>.` : 'Cấp trên chưa đặt xác thực: request gửi không kèm Authorization.'}${inheritNote}</p>` : ''}
        ${a.type === 'none' ? '<p class="muted small auth-note">Không gửi header xác thực. Header Authorization ghi tay ở tab Headers vẫn được gửi.</p>' : ''}
        ${lit ? '<p class="warn-t small auth-note"><span class="ms sm" aria-hidden="true">info</span> Giá trị đang ghi thẳng: chỉ giữ trong phiên trình duyệt (không lưu bền, không export). Nên dùng biến, vd <code>{{TOKEN}}</code>, và nhập giá trị ở Environment.</p>' : ''}
        ${['bearer', 'basic', 'apikey'].includes(a.type) ? '<p class="muted small auth-note">Header Authorization / API key ghi tay ở tab Headers (nếu có) sẽ thắng phần này.</p>' : ''}`;
    };
    box.addEventListener('input', e => {
      const f = e.target.dataset.au;
      if (!f || f === 'type' || f === 'in') return;
      node.auth[f] = e.target.value;
      onChange?.();
    });
    box.addEventListener('change', e => {
      const f = e.target.dataset.au;
      if (f === 'type') {
        const t = e.target.value;
        node.auth = t === 'bearer' ? { type: t, token: node.auth.token || '{{TOKEN}}' } : t === 'basic' ? { type: t, username: '', password: '' }
          : t === 'apikey' ? { type: t, key: 'X-API-Key', value: '{{API_KEY}}', in: 'header' } : { type: t };
        onChange?.();
        draw();
        box.querySelector('[data-au]:not([data-au="type"])')?.focus();
      } else if (f === 'in') { node.auth.in = e.target.value; onChange?.(); }
      else if (f) draw();
    });
    box.addEventListener('click', e => {
      const eye = e.target.closest('[data-au-eye]');
      if (!eye) return;
      const inp = eye.parentElement.querySelector('input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      eye.firstElementChild.textContent = inp.type === 'password' ? 'visibility' : 'visibility_off';
    });
    draw();
    return { draw };
  };

  // ================= COLLECTION / FOLDER =================
  let nodeTab = 'overview';
  function renderNode() {
    const W = App.W, n = W.get(S.sel);
    const box = $('#view-node');
    if (!n || n.type === 'request') return;
    const all = W.descendants(n.id);
    const reqs = all.filter(x => x.type === 'request');
    const folders = all.filter(x => x.type === 'folder');
    const cases = reqs.reduce((s, r) => s + caseCount(r.id), 0);
    const tabs = n.type === 'collection' ? [['overview', 'Tổng quan'], ['vars', 'Variables'], ['auth', 'Authorization'], ['headers', 'Headers'], ['scripts', 'Scripts']] : [['overview', 'Tổng quan'], ['auth', 'Authorization']];
    if (!tabs.some(t => t[0] === nodeTab)) nodeTab = 'overview';
    box.innerHTML = `
      <div class="node-head">
        <nav class="crumbs" aria-label="Vị trí">${W.path(n.id).slice(0, -1).map(x => `<button type="button" class="crumb" data-go="${esc(x.id)}">${esc(x.name)}</button><span class="ms sm" aria-hidden="true">chevron_right</span>`).join('')}</nav>
        <div class="rq-title-row">
          <span class="ms node-ic" aria-hidden="true">${TYPE_ICON[n.type]}</span>
          <input type="text" class="title-in" id="nodeName" value="${esc(n.name)}" aria-label="Tên ${n.type}">
          ${n.enabled === false ? '<span class="badge badge-skip"><span class="ms sm" aria-hidden="true">block</span> Tắt khi chạy</span>' : ''}
          <span class="spacer"></span>
          <button type="button" class="btn btn-primary btn-sm" data-node-act="run"${reqs.length ? '' : ' disabled'}><span class="ms sm fill" aria-hidden="true">play_arrow</span>Run ${n.type}</button>
          <button type="button" class="icon-btn" data-node-act="menu" aria-haspopup="menu" aria-label="Thao tác"><span class="ms" aria-hidden="true">more_horiz</span></button>
        </div>
        <p class="muted small node-stats">${folders.length} folder · ${reqs.length} request · ${cases} test case</p>
        <div class="tabs node-tabs" role="tablist" aria-label="Cấu hình ${n.type}">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-ntab="${k}" aria-selected="${nodeTab === k}">${l}</button>`).join('')}</div>
      </div>
      ${n.type === 'collection' ? App.tip?.('collection', '<b>Mẹo:</b> đặt Authorization (vd Bearer <code>{{TOKEN}}</code>) và Headers chung ở collection: request để “Kế thừa” sẽ dùng luôn, không phải nhập lại từng cái.', 'chain') || '' : ''}
      <div class="node-body" id="nodeBody"></div>`;
    const body = $('#nodeBody');
    if (nodeTab === 'overview') {
      const kids = W.children(n.id);
      body.innerHTML = `
        <label for="nodeDesc">Mô tả</label><textarea id="nodeDesc" rows="2" placeholder="Ghi chú cho team (không bắt buộc)">${esc(n.description || '')}</textarea>
        <div class="node-list-h"><h3>Bên trong</h3><span class="spacer"></span>
          <button type="button" class="btn btn-sm" data-node-act="new-request"><span class="ms sm" aria-hidden="true">add</span>Request</button>
          <button type="button" class="btn btn-sm" data-node-act="paste"><span class="ms sm" aria-hidden="true">content_paste</span>Từ cURL</button>
          <button type="button" class="btn btn-sm" data-node-act="new-folder"><span class="ms sm" aria-hidden="true">create_new_folder</span>Folder</button></div>
        ${kids.length ? `<ul class="node-list">${kids.map(k => `<li><button type="button" class="node-item${k.enabled === false ? ' off' : ''}" data-go="${esc(k.id)}">
            ${k.type === 'request' ? Ui.methodTag(k.method) : `<span class="ms sm" aria-hidden="true">${TYPE_ICON[k.type]}</span>`}
            <span class="ni-name">${esc(k.name)}</span>
            <span class="muted small ni-meta">${k.type === 'request' ? `${caseCount(k.id) ? `${caseCount(k.id)} test case` : 'chưa có test case'}` : `${W.requestsUnder(k.id, { includeDisabled: true }).length} request`}</span>
          </button></li>`).join('')}</ul>`
          : `<div class="empty-state small"><span class="ms lg" aria-hidden="true">${n.type === 'collection' ? 'inventory_2' : 'folder_open'}</span><h3>${n.type === 'collection' ? 'Collection' : 'Folder'} trống</h3><p class="muted">Thêm request (gõ tay hoặc dán cURL) hoặc folder để nhóm theo chức năng.</p>
            <div class="row-actions center"><button type="button" class="btn btn-primary btn-sm" data-node-act="new-request">Thêm request</button><button type="button" class="btn btn-sm" data-node-act="paste">Dán cURL</button></div></div>`}`;
      $('#nodeDesc').addEventListener('input', debounce(e => W.update(n.id, { description: e.target.value }), 400));
    } else if (nodeTab === 'vars') {
      body.innerHTML = `<p class="muted small">Biến dùng chung cho mọi request trong collection. Environment có biến cùng tên sẽ ghi đè (đổi environment là đổi giá trị).</p><div class="kv" id="colVars"></div>`;
      Ui.kvEditor($('#colVars'), () => n.vars, { secret: true, enabled: true, keyLabel: 'Variable', keyPh: 'NAME', valPh: 'value', addText: 'Thêm variable', empty: 'Chưa có variable.', onChange: () => { W.touch(n.id); App.emit('vars'); }, locked: App.isBusy }).render();
    } else if (nodeTab === 'auth') {
      body.innerHTML = `<p class="muted small">Request trong ${n.type} để “Kế thừa” sẽ dùng xác thực này.</p><div id="nodeAuth"></div>`;
      App.authEditor($('#nodeAuth'), n, { onChange: () => { W.touch(n.id); App.emit('vars'); } });
    } else if (nodeTab === 'headers') {
      body.innerHTML = `<p class="muted small">Gửi kèm mọi request trong collection (request có header cùng tên sẽ thắng).</p><div class="kv" id="colHeaders"></div>`;
      Ui.kvEditor($('#colHeaders'), () => n.headers, { enabled: true, keyLabel: 'Header', keyPh: 'Header-Name', valPh: 'value', addText: 'Thêm header', empty: 'Chưa có header chung.', onChange: () => W.touch(n.id), locked: App.isBusy }).render();
    } else if (nodeTab === 'scripts') {
      body.innerHTML = `<p class="muted small">Chạy <b>trước</b> script của từng request trong collection (như Postman). Cú pháp giống tab Scripts của request.</p>
        <label for="colPre">Pre-request (collection)</label><textarea id="colPre" class="code-input mono-in" rows="8" spellcheck="false">${esc(n.scripts.pre)}</textarea>
        <label for="colPost">Post-response (collection)</label><textarea id="colPost" class="code-input mono-in" rows="8" spellcheck="false">${esc(n.scripts.post)}</textarea>
        <p class="small" id="colScriptStatus" role="status"></p>`;
      const check = debounce(async () => {
        const errs = [];
        for (const k of ['pre', 'post']) if (n.scripts[k].trim()) { const out = await ApiScript.check(n.scripts[k]); if (out.error) errs.push(`${k === 'pre' ? 'Pre-request' : 'Post-response'}: ${out.error}`); }
        const st = $('#colScriptStatus');
        if (st) { st.className = 'small ' + (errs.length ? 'err-t' : 'ok-t'); st.textContent = errs.length ? errs.join(' · ') : n.scripts.pre.trim() || n.scripts.post.trim() ? 'Syntax OK' : ''; }
      }, 500);
      for (const [id, k] of [['colPre', 'pre'], ['colPost', 'post']]) $('#' + id).addEventListener('input', e => { n.scripts[k] = e.target.value; W.touch(n.id); check(); });
      check();
    }
    $('#nodeName').addEventListener('change', e => { const v = e.target.value.trim(); if (!v) { e.target.value = n.name; return; } W.rename(n.id, v); renderTree(); });
  }
  App.renderNode = renderNode;
  $('#view-node').addEventListener('click', e => {
    const n = App.W.get(S.sel);
    const go = e.target.closest('[data-go]');
    if (go) { App.select(go.dataset.go); return; }
    const t = e.target.closest('[data-ntab]');
    if (t) { nodeTab = t.dataset.ntab; renderNode(); $(`[data-ntab="${nodeTab}"]`)?.focus(); return; }
    const act = e.target.closest('[data-node-act]');
    if (!act || !n) return;
    const a = act.dataset.nodeAct;
    if (a === 'run') App.runScope?.({ collectionId: App.W.collectionOf(n.id)?.id || n.id, targets: n.type === 'collection' ? [] : [n.id] });
    else if (a === 'menu') nodeMenu(n.id, act);
    else if (a === 'new-request') newRequest(n.id);
    else if (a === 'new-folder') newFolder(n.id);
    else if (a === 'paste') App.pasteCurlFlow?.({ parentId: n.id });
  });
  App.on('vars', () => { if (S.nav === 'envs') { const a = document.activeElement; if (!$('#view-envs').contains(a) || !a.matches('input, textarea')) renderEnvs(); } });

  // ================= WORKSPACE: IMPORT / EXPORT =================
  function exportWorkspace() {
    const m = Ui.modal({
      title: 'Export workspace', sub: 'Sao lưu hoặc chuyển sang máy / trình duyệt khác',
      body: `<p>File .json gồm collection, folder, request, test case, scripts, environment, preset và cài đặt.</p>
        <label class="check"><input type="checkbox" id="exSecrets"> Kèm giá trị bí mật (token, password, biến secret)</label>
        <p class="warn-t small hidden" id="exWarn"><span class="ms sm" aria-hidden="true">warning</span> File sẽ chứa token / mật khẩu ở dạng chữ thường. Chỉ dùng khi thật cần, không gửi file qua kênh công khai.</p>`,
      actions: '<button class="btn" type="button" data-cancel>Huỷ</button><button class="btn btn-primary" type="button" data-ok><span class="ms sm" aria-hidden="true">download</span>Tải file</button>',
    });
    m.el.querySelector('#exSecrets').addEventListener('change', e => m.el.querySelector('#exWarn').classList.toggle('hidden', !e.target.checked));
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const data = App.W.exportData({ includeSecrets: m.el.querySelector('#exSecrets').checked });
      const d = new Date();
      const name = `qa-api-workspace-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      Ui.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
      m.close(true);
      toast(`Đã xuất ${name}${data.includesSecrets ? ' (có giá trị bí mật)' : ''}`, data.includesSecrets ? 'warn' : 'ok', 5000);
    });
    m.el.querySelector('[data-ok]').focus();
  }
  App.exportWorkspace = exportWorkspace;
  async function importWorkspace() {
    if (App.isBusy()) { toast('Đang chạy: import sau khi chạy xong', 'warn'); return; }
    const f = await Ui.pickFile('.json,application/json');
    if (!f) return;
    let text;
    try { text = await f.text(); } catch (e) { toast('Không đọc được file: ' + e.message, 'err'); return; }
    const v = ApiWorkspace.validateImport(text);
    if (!v.data) {
      Ui.modal({ title: 'File không nhập được', body: `<div class="validation"><ul>${v.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`, actions: '<button class="btn" type="button" data-cancel>Đóng</button>' });
      return;
    }
    const s = v.summary;
    const empty = App.W.isEmpty();
    const m = Ui.modal({
      title: 'Import workspace', sub: esc(f.name), wide: true,
      body: `<dl class="imp-sum">
          <div><dt>Collection</dt><dd>${s.collections}</dd></div><div><dt>Folder</dt><dd>${s.folders}</dd></div><div><dt>Request</dt><dd>${s.requests}</dd></div>
          <div><dt>Test case</dt><dd>${s.cases}</dd></div><div><dt>Environment</dt><dd>${s.environments}</dd></div><div><dt>Preset</dt><dd>${s.presets}</dd></div></dl>
        ${v.warnings.length ? `<div class="validation warn-only"><p class="v-title warn-t"><span class="ms sm" aria-hidden="true">warning</span> Lưu ý</p><ul>${v.warnings.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        <fieldset class="imp-mode"><legend>Cách nhập</legend>
          <label class="radio-card"><input type="radio" name="impMode" value="merge" checked><span><b>Gộp vào workspace hiện tại</b><span class="muted small">Thêm mới, không sửa / xoá gì đang có. Environment trùng tên được thêm hậu tố “(nhập)”.</span></span></label>
          <label class="radio-card${empty ? ' hidden' : ''}"><input type="radio" name="impMode" value="replace"><span><b>Thay thế toàn bộ</b><span class="muted small">Xoá workspace hiện tại rồi nạp file này. Nên tải bản sao lưu trước.</span></span></label>
        </fieldset>
        <div class="row-actions${empty ? ' hidden' : ''}"><button type="button" class="btn btn-sm btn-ghost" data-backup><span class="ms sm" aria-hidden="true">download</span>Tải bản sao lưu workspace hiện tại</button></div>`,
      actions: '<button class="btn" type="button" data-cancel>Huỷ</button><button class="btn btn-primary" type="button" data-ok><span class="ms sm" aria-hidden="true">upload</span>Import</button>',
    });
    m.el.querySelector('[data-backup]').addEventListener('click', () => exportWorkspace());
    m.el.querySelector('[data-ok]').addEventListener('click', async () => {
      const mode = m.el.querySelector('input[name=impMode]:checked').value;
      if (mode === 'replace') {
        const ok = await Ui.confirmBox('Thay thế toàn bộ workspace?', '<p>Mọi collection, request, test case, environment và preset hiện tại sẽ bị xoá và thay bằng nội dung file. <b>Không hoàn tác được.</b></p>', 'Thay thế');
        if (!ok) return;
      }
      m.close(true);
      const r = App.W.importData(v.data, mode);
      S.sel = null;
      S.expanded = new Set(App.W.collections().map(c => c.id));
      renderEnvSelect();
      renderTree();
      setNav('requests');
      App.emit('vars');
      App.emit('tree');
      toast(`Đã import ${s.collections} collection, ${s.requests} request, ${s.environments} environment${r.problems.length ? ` · ${r.problems.length} mục được sửa` : ''}`, 'ok', 6000);
    });
  }
  App.importWorkspace = importWorkspace;

  $('#btnWsMenu').addEventListener('click', e => {
    const legacy = readLegacy();
    Ui.menu(e.currentTarget, [
      { label: 'Export workspace…', icon: 'download', action: exportWorkspace },
      { label: 'Import workspace…', icon: 'upload', action: importWorkspace },
      'sep',
      { label: 'Mở trong tab riêng', icon: 'open_in_new', action: () => { const url = location.href.split('#')[0]; if (globalThis.chrome?.tabs) chrome.tabs.create({ url }); else open(url, '_blank', 'noopener'); } },
      { label: 'Dung lượng đã dùng', icon: 'storage', action: async () => {
        const u = await ApiStore.usage();
        toast(u.bytes != null ? `Đang dùng ${Ui.fmtBytes(u.bytes)}${u.quota ? ` / ${Ui.fmtBytes(u.quota)}` : ''} bộ nhớ trình duyệt (${ApiStore.mode === 'extension' ? 'extension' : 'bản web'})` : 'Không đo được dung lượng', 'info', 6000);
      } },
      ...(legacy ? ['sep', { label: 'Xoá dữ liệu phiên bản cũ (đã chuyển)', icon: 'delete_history', action: async () => {
        const ok = await Ui.confirmBox('Xoá dữ liệu phiên bản cũ?', '<p>Dữ liệu của phiên bản trước (một request, một bộ test case, DEV / STAGING / PROD) đã được chuyển sang workspace khi mở lần đầu. Xoá bản cũ khỏi bộ nhớ trình duyệt? Workspace hiện tại không bị ảnh hưởng.</p>', 'Xoá bản cũ');
        if (!ok) return;
        try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(LEGACY_SUITE); } catch {}
        toast('Đã xoá dữ liệu phiên bản cũ', 'ok', 3000);
      } }] : []),
    ]);
  });

  // Ctrl/⌘ + K: tìm request
  document.addEventListener('keydown', e => {
    if (e.key === 'k' && (e.ctrlKey || e.metaKey) && !document.querySelector('.modal-bg')) {
      e.preventDefault();
      if ($('#app').classList.contains('sb-hidden')) toggleSidebar(true);
      if (narrow()) toggleSidebar(true);
      sbSearch.focus();
      sbSearch.select();
    }
  });
})();
