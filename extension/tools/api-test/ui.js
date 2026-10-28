// UI dùng chung của Kiểm thử API: tiện ích DOM, toast, hộp thoại, drawer, menu ngữ cảnh, bảng key/value, xem JSON.
// Không chứa nghiệp vụ. Các file app*.js dùng qua window.Ui.
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
  const fmtDur = ms => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} phút ${Math.round((ms % 60000) / 1000)} s`);
  const fmtBytes = n => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const fmtTime = ms => (ms ? new Date(ms).toLocaleString('vi-VN', { hour12: false }) : '—');
  const methodTag = m => `<span class="method m-${esc(String(m).toLowerCase())}">${esc(m)}</span>`;
  const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const visibleFocusables = root => $$(FOCUSABLE, root).filter(x => !x.disabled && x.offsetParent !== null);

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.addEventListener('change', () => resolve(inp.files[0] || null), { once: true });
      inp.click();
    });
  }

  // ---------- Toast ----------
  const TOAST_ICON = { ok: 'check_circle', warn: 'warning', err: 'error', info: 'info' };
  function toast(text, kind = 'info', ms = 4000, action = null) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.innerHTML = `<span class="ms sm" aria-hidden="true">${TOAST_ICON[kind]}</span><span>${esc(text)}</span>${action ? `<button type="button" class="btn btn-sm toast-act">${esc(action.label)}</button>` : ''}<button type="button" class="x" aria-label="Đóng thông báo"><span class="ms sm" aria-hidden="true">close</span></button>`;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
    el.querySelector('.x').addEventListener('click', close);
    if (action) el.querySelector('.toast-act').addEventListener('click', () => { close(); action.fn(); });
    $('#toasts').appendChild(el);
    setTimeout(close, ms);
  }
  async function copyText(text, btn, done = 'Đã copy') {
    const label = btn?.querySelector('.lbl');
    const old = label?.textContent;
    try { await navigator.clipboard.writeText(text); if (label) label.textContent = done; else toast(done, 'ok', 2000); }
    catch { toast('Không copy được, hãy chọn và copy thủ công', 'warn'); }
    if (label) setTimeout(() => (label.textContent = old), 1600);
  }

  // ---------- Hộp thoại (modal) ----------
  // Trả về { el, close }. Esc / bấm nền = huỷ. Giữ focus bên trong, trả focus về chỗ mở khi đóng.
  function modal({ title, sub = '', body, actions = '', role = 'dialog', wide = false, onClose }) {
    const opener = document.activeElement;
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const tid = 'm' + Math.random().toString(36).slice(2, 8);
    bg.innerHTML = `<div class="modal ${wide ? 'modal-wide' : 'modal-sm'}" role="${role}" aria-modal="true" aria-labelledby="${tid}">
      <div class="modal-h"><div class="min0"><h3 id="${tid}">${esc(title)}</h3>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button class="x" type="button" data-cancel aria-label="Đóng"><span class="ms" aria-hidden="true">close</span></button></div>
      <div class="modal-b">${body}${actions ? `<div class="row-actions modal-actions">${actions}</div>` : ''}</div></div>`;
    let closed = false;
    const close = v => {
      if (closed) return;
      closed = true;
      bg.remove();
      document.removeEventListener('keydown', onKey, true);
      if (opener?.isConnected) opener.focus?.();
      onClose?.(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(undefined); }
      else if (e.key === 'Tab') {
        const f = visibleFocusables(bg);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      }
    };
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(undefined); });
    bg.addEventListener('click', e => { if (e.target.closest('[data-cancel]')) close(undefined); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    return { el: bg, close };
  }
  // Xác nhận: nút Huỷ được focus mặc định
  function confirmBox(title, html, okText, { danger = true } = {}) {
    return new Promise(resolve => {
      const m = modal({ title, body: html, role: 'alertdialog', onClose: v => resolve(!!v),
        actions: `<button class="btn" type="button" data-cancel>Huỷ</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok>${esc(okText)}</button>` });
      m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
      m.el.querySelector('[data-cancel]:not(.x)').focus();
    });
  }
  // Nhập một dòng chữ. validate(v) → thông báo lỗi hoặc ''
  function promptBox({ title, label, value = '', okText = 'Lưu', placeholder = '', validate, hint = '' }) {
    return new Promise(resolve => {
      const m = modal({ title, onClose: v => resolve(v ?? null),
        body: `<form class="prompt-form" novalidate><label for="pbIn">${esc(label)}</label><input id="pbIn" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">${hint ? `<p class="muted small">${hint}</p>` : ''}<p class="form-msg" id="pbMsg" role="alert"></p></form>`,
        actions: `<button class="btn" type="button" data-cancel>Huỷ</button><button class="btn btn-primary" type="button" data-ok>${esc(okText)}</button>` });
      const inp = m.el.querySelector('#pbIn');
      const submit = () => {
        const v = inp.value.trim();
        const msg = validate ? validate(v) : v ? '' : 'Không được để trống';
        if (msg) { m.el.querySelector('#pbMsg').textContent = msg; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
        m.close(v);
      };
      m.el.querySelector('[data-ok]').addEventListener('click', submit);
      m.el.querySelector('form').addEventListener('submit', e => { e.preventDefault(); submit(); });
      inp.focus();
      inp.select();
    });
  }
  // Chọn một mục trong danh sách (vd đích di chuyển). options: [{ value, label, depth, disabled }]
  function chooseBox({ title, label, options, value, okText = 'Chọn', hint = '' }) {
    return new Promise(resolve => {
      const m = modal({ title, onClose: v => resolve(v ?? null),
        body: `<label for="cbSel">${esc(label)}</label><select id="cbSel">${options.map(o => `<option value="${esc(o.value)}"${o.disabled ? ' disabled' : ''}${o.value === value ? ' selected' : ''}>${'  '.repeat(o.depth || 0)}${o.depth ? '└ ' : ''}${esc(o.label)}</option>`).join('')}</select>${hint ? `<p class="muted small">${hint}</p>` : ''}`,
        actions: `<button class="btn" type="button" data-cancel>Huỷ</button><button class="btn btn-primary" type="button" data-ok>${esc(okText)}</button>` });
      m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(m.el.querySelector('#cbSel').value));
      m.el.querySelector('#cbSel').focus();
    });
  }

  // ---------- Drawer (bên phải) ----------
  let openDrawerEl = null, drawerOpener = null;
  function openDrawer(el, opener) {
    if (openDrawerEl && openDrawerEl !== el) closeDrawer({ restoreFocus: false });
    if (!openDrawerEl) drawerOpener = opener || document.activeElement;
    openDrawerEl = el;
    el.classList.remove('hidden');
    $('#drawerBg').classList.remove('hidden');
    document.body.classList.add('drawer-open');
    requestAnimationFrame(() => el.classList.add('open'));
    (el.querySelector('[data-autofocus]') || el.querySelector('.drawer-h .x'))?.focus();
  }
  function closeDrawer({ restoreFocus = true } = {}) {
    const el = openDrawerEl;
    if (!el) return;
    el.classList.remove('open');
    el.classList.add('hidden');
    $('#drawerBg').classList.add('hidden');
    document.body.classList.remove('drawer-open');
    openDrawerEl = null;
    el.dispatchEvent(new CustomEvent('drawerclose'));
    if (restoreFocus && drawerOpener?.isConnected) drawerOpener.focus();
  }
  const currentDrawer = () => openDrawerEl;
  document.addEventListener('DOMContentLoaded', () => {
    $('#drawerBg')?.addEventListener('click', () => closeDrawer());
    $$('.drawer').forEach(d => d.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDrawer(); }));
  });
  document.addEventListener('keydown', e => {
    if (!openDrawerEl || document.querySelector('.modal-bg') || document.querySelector('.menu-pop')) return;
    if (e.key === 'Escape' && !e.target.matches('.code-area')) { e.preventDefault(); closeDrawer(); return; }
    if (e.key === 'Tab') { // giữ focus trong drawer
      const f = visibleFocusables(openDrawerEl);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });

  // ---------- Menu ngữ cảnh ----------
  // items: [{ label, icon, action, danger, disabled, hint } | 'sep']. Mở cạnh anchor; ↑ ↓ Home End để đi, Enter chọn, Esc đóng.
  let menuEl = null;
  function closeMenu(focusBack = true) {
    if (!menuEl) return;
    const { el, anchor } = menuEl;
    el.remove();
    anchor?.setAttribute('aria-expanded', 'false');
    menuEl = null;
    document.removeEventListener('mousedown', outside, true);
    if (focusBack && anchor?.isConnected) anchor.focus();
  }
  const outside = e => { if (menuEl && !menuEl.el.contains(e.target) && e.target !== menuEl.anchor && !menuEl.anchor?.contains(e.target)) closeMenu(false); };
  function menu(anchor, items, { x, y } = {}) {
    closeMenu(false);
    const el = document.createElement('div');
    el.className = 'menu-pop';
    el.setAttribute('role', 'menu');
    el.innerHTML = items.map((it, i) => it === 'sep' ? '<div class="menu-sep" role="separator"></div>'
      : `<button type="button" role="menuitem" class="menu-item${it.danger ? ' danger' : ''}" data-i="${i}"${it.disabled ? ' disabled' : ''}>${it.icon ? `<span class="ms sm" aria-hidden="true">${it.icon}</span>` : '<span class="ms sm" aria-hidden="true"></span>'}<span class="mi-l">${esc(it.label)}</span>${it.hint ? `<span class="mi-h">${esc(it.hint)}</span>` : ''}</button>`).join('');
    document.body.appendChild(el);
    const r = anchor?.getBoundingClientRect();
    const px = x ?? (r ? r.left : 0), py = y ?? (r ? r.bottom + 4 : 0);
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(px, innerWidth - w - 8)) + 'px';
    el.style.top = (py + h > innerHeight - 8 ? Math.max(8, (r ? r.top : py) - h - 4) : py) + 'px';
    anchor?.setAttribute('aria-expanded', 'true');
    menuEl = { el, anchor };
    const btns = () => $$('.menu-item:not(:disabled)', el);
    el.addEventListener('click', e => {
      const b = e.target.closest('.menu-item');
      if (!b) return;
      const it = items[Number(b.dataset.i)];
      closeMenu(false);
      it.action?.();
    });
    el.addEventListener('keydown', e => {
      const list = btns(), i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); list.at(-1)?.focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    });
    setTimeout(() => document.addEventListener('mousedown', outside, true));
    btns()[0]?.focus();
  }

  // ---------- Bảng key/value kiểu Postman ----------
  // opts: { enabled, secret, keyLabel, valLabel, keyPh, valPh, empty, suggest: [{ key, value, label, secret }], addText, onChange(), locked() }
  function kvEditor(el, getRows, opts) {
    const revealed = new Set();
    const changed = () => opts.onChange?.();
    const render = () => {
      const rows = getRows() || [];
      const cls = `kv-row${opts.enabled ? ' has-enabled' : ''}${opts.secret ? ' has-secret' : ''}`;
      const have = new Set(rows.map(r => r.key.toLowerCase()));
      const sugg = (opts.suggest || []).filter(s => !have.has(s.key.toLowerCase()));
      const lock = opts.locked?.() ? ' disabled' : '';
      el.innerHTML = (rows.length ? `<div class="kv-table">
          <div class="${cls} kv-head" aria-hidden="true">${opts.enabled ? '<span></span>' : ''}<span>${esc(opts.keyLabel || 'Key')}</span><span>${esc(opts.valLabel || 'Value')}</span>${opts.secret ? '<span></span>' : ''}<span></span></div>
          ${rows.map((r, i) => {
            const hidden = opts.secret && r.secret && !revealed.has(i);
            return `<div class="${cls}${r.enabled === false ? ' off' : ''}${r.secret ? ' is-secret' : ''}" data-i="${i}">
              ${opts.enabled ? `<label class="kv-on" title="${r.enabled !== false ? 'Đang dùng, bấm để tắt' : 'Đang tắt, bấm để bật'}"><input type="checkbox" data-f="enabled" ${r.enabled !== false ? 'checked' : ''} aria-label="Dùng ${esc(r.key || 'dòng ' + (i + 1))}"${lock}></label>` : ''}
              <input type="text" class="mono-in" data-f="key" value="${esc(r.key)}" placeholder="${esc(opts.keyPh || 'key')}" spellcheck="false" aria-label="Key dòng ${i + 1}"${lock}>
              <div class="kv-val">
                <input type="${hidden ? 'password' : 'text'}" class="mono-in" data-f="value" value="${esc(r.value)}" placeholder="${esc(opts.valPh || 'value')}" spellcheck="false" autocomplete="off" aria-label="Value của ${esc(r.key || 'dòng ' + (i + 1))}"${lock}>
                ${opts.secret && r.secret ? `<button type="button" class="kv-eye" data-reveal title="${hidden ? 'Hiện giá trị' : 'Ẩn giá trị'}" aria-label="${hidden ? 'Hiện' : 'Ẩn'} giá trị ${esc(r.key)}"><span class="ms sm" aria-hidden="true">${hidden ? 'visibility' : 'visibility_off'}</span></button>` : ''}
              </div>
              ${opts.secret ? `<button type="button" class="kv-lock" data-secret aria-pressed="${!!r.secret}" title="${r.secret ? 'Secret: ẩn giá trị, chỉ giữ trong phiên trình duyệt, che trong báo cáo. Bấm để bỏ' : 'Đánh dấu secret (token, password…)'}" aria-label="Secret: ${esc(r.key || 'dòng ' + (i + 1))}"${lock}><span class="ms sm${r.secret ? ' fill' : ''}" aria-hidden="true">${r.secret ? 'lock' : 'lock_open'}</span></button>` : ''}
              <button type="button" class="kv-del" data-del title="Xoá" aria-label="Xoá ${esc(r.key || 'dòng ' + (i + 1))}"${lock}><span class="ms sm" aria-hidden="true">delete</span></button>
            </div>`;
          }).join('')}</div>` : `<p class="kv-empty">${esc(opts.empty || 'Chưa có dòng nào.')}</p>`)
        + `<div class="kv-foot"><button type="button" class="btn btn-ghost btn-sm" data-add${lock}><span class="ms sm" aria-hidden="true">add</span>${esc(opts.addText || 'Thêm')}</button>`
        + sugg.map((s, j) => `<button type="button" class="kv-sugg" data-sugg="${j}" title="${esc(s.key)}: ${esc(s.value)}"${lock}><span class="ms sm" aria-hidden="true">add</span>${esc(s.label || s.key)}</button>`).join('')
        + '</div>';
      el._sugg = sugg;
    };
    el.addEventListener('input', e => {
      const row = e.target.closest('.kv-row');
      if (!row || !e.target.dataset.f) return;
      const r = getRows()[Number(row.dataset.i)];
      if (!r) return;
      const f = e.target.dataset.f;
      r[f] = e.target.type === 'checkbox' ? e.target.checked : f === 'key' ? e.target.value.trim() : e.target.value;
      if (f === 'enabled') row.classList.toggle('off', !r.enabled);
      changed();
    });
    el.addEventListener('click', e => {
      const add = e.target.closest('[data-add]'), sug = e.target.closest('[data-sugg]');
      if (add || sug) {
        const s = sug ? el._sugg[Number(sug.dataset.sugg)] : null;
        getRows().push({ key: s?.key || '', value: s?.value || '', enabled: true, ...(s?.secret ? { secret: true } : {}) });
        render();
        el.querySelector(`.kv-table > .kv-row:last-child [data-f="${s ? 'value' : 'key'}"]`)?.focus();
        changed();
        return;
      }
      const row = e.target.closest('.kv-row');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('[data-del]')) {
        getRows().splice(i, 1);
        revealed.clear();
        render();
        changed();
        el.querySelector('[data-add]')?.focus();
      } else if (e.target.closest('[data-secret]')) {
        const r = getRows()[i];
        r.secret = !r.secret;
        if (!r.secret) delete r.secret;
        revealed.delete(i);
        render();
        changed();
        el.querySelector(`.kv-row[data-i="${i}"] [data-secret]`)?.focus();
      } else if (e.target.closest('[data-reveal]')) {
        if (revealed.has(i)) revealed.delete(i); else revealed.add(i);
        render();
        el.querySelector(`.kv-row[data-i="${i}"] [data-reveal]`)?.focus();
      }
    });
    return { render };
  }

  // ---------- Xem JSON: mỗi khoá có data-path ($.a.b[0]) để bấm chọn lưu thành biến ----------
  const JSON_VIEW_LIMIT = 400_000;
  const pathKey = (base, k) => (typeof k === 'number' ? `${base}[${k}]` : /^[A-Za-z_$][\w$-]*$/.test(k) ? `${base}.${k}` : null);
  function jsonView(text, { query = '' } = {}) {
    let v;
    if (text == null || text === '' || text.length > JSON_VIEW_LIMIT) return null;
    try { v = JSON.parse(text); } catch { return null; }
    const q = query.toLowerCase();
    const hl = s => {
      const e = esc(s);
      if (!q) return e;
      const i = s.toLowerCase().indexOf(q);
      return i < 0 ? e : esc(s.slice(0, i)) + `<mark>${esc(s.slice(i, i + q.length))}</mark>` + esc(s.slice(i + q.length));
    };
    const scalar = x => (x === null ? '<span class="j-null">null</span>' : typeof x === 'string' ? `<span class="j-str">${hl(JSON.stringify(x))}</span>`
      : typeof x === 'number' ? `<span class="j-num">${hl(String(x))}</span>` : `<span class="j-bool">${x}</span>`);
    const out = [];
    const walk = (x, path, ind, key, last) => {
      const pad = '  '.repeat(ind);
      const k = key == null ? '' : typeof key === 'number' ? '' : `<button type="button" class="j-key" data-jpath="${esc(path ?? '')}"${path ? '' : ' disabled'} title="${path ? `Lưu ${esc(path)} thành biến` : 'Tên khoá chưa hỗ trợ trong JSON path'}">${hl(JSON.stringify(key))}</button>: `;
      const comma = last ? '' : ',';
      if (Array.isArray(x)) {
        if (!x.length) { out.push(`${pad}${k}[]${comma}`); return; }
        out.push(`${pad}${k}[`);
        x.forEach((y, i) => walk(y, path != null ? pathKey(path, i) : null, ind + 1, i, i === x.length - 1));
        out.push(`${pad}]${comma}`);
      } else if (x && typeof x === 'object') {
        const ks = Object.keys(x);
        if (!ks.length) { out.push(`${pad}${k}{}${comma}`); return; }
        out.push(`${pad}${k}{`);
        ks.forEach((kk, i) => walk(x[kk], path != null ? pathKey(path, kk) : null, ind + 1, kk, i === ks.length - 1));
        out.push(`${pad}}${comma}`);
      } else {
        const val = path ? `<span class="j-val" data-jpath="${esc(path)}">${scalar(x)}</span>` : scalar(x);
        out.push(`${pad}${k}${val}${comma}`);
      }
    };
    walk(v, '$', 0, null, true);
    return out.join('\n');
  }

  // ---------- Tô màu {{biến}} ngay trong ô nhập ----------
  // Ô input / textarea không tô màu từng phần chữ được → đặt một lớp nền vẽ lại đúng chữ đó (có tô màu) ngay sau ô,
  // chữ của ô để trong suốt (con trỏ, chọn chữ, gõ vẫn như thường). Tự gắn vào ô khớp VAR_TARGETS, kể cả ô vẽ lại sau.
  // Ui.varState(name) → 'ok' | 'missing' | 'dyn' (app đặt theo environment đang dùng).
  const VAR_TARGETS = '#rqUrl, #rqBody, .kv-row input[data-f="value"], .au-field input, #ceUrl, #ceBody';
  const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'textIndent', 'tabSize', 'textAlign'];
  const varApi = { state: () => 'ok' };
  function paintVars(el) {
    const bd = el._vhBd;
    if (!bd) return;
    const text = el.value;
    if (el.type === 'password' || !text.includes('{{')) { bd.textContent = ''; el.classList.remove('vh-on'); return; }
    el.classList.add('vh-on');
    let html = '', last = 0;
    for (const m of text.matchAll(VAR_RE)) {
      const st = m[1].startsWith('$') ? 'dyn' : varApi.state(m[1]);
      html += esc(text.slice(last, m.index)) + `<span class="vh-var ${st}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    html += esc(text.slice(last));
    // Dòng cuối của textarea kết thúc bằng xuống dòng thì phải có ký tự để lớp nền cao bằng ô
    bd.innerHTML = html + (el.tagName === 'TEXTAREA' && text.endsWith('\n') ? ' ' : '');
    syncVars(el);
  }
  function syncVars(el) {
    const bd = el._vhBd;
    if (!bd) return;
    const cs = getComputedStyle(el);
    for (const k of COPY) bd.style[k] = cs[k];
    bd.style.borderColor = 'transparent';
    bd.style.borderStyle = 'solid';
    // Ô một dòng tự căn chữ giữa theo chiều cao → lớp vẽ lại phải có line-height bằng phần trong của ô
    if (el.tagName === 'INPUT') bd.style.lineHeight = Math.max(0, el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) + 'px';
    if (el.tagName === 'TEXTAREA') bd.style.width = el.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) + 'px'; // trừ thanh cuộn dọc
    bd.scrollTop = el.scrollTop;
    bd.scrollLeft = el.scrollLeft;
  }
  function attachVars(el) {
    if (el._vhBd || el.closest('.vh') || !el.isConnected) return;
    const wrap = document.createElement('span');
    wrap.className = 'vh' + (el.tagName === 'TEXTAREA' ? ' vh-area' : '');
    const bd = document.createElement('span');
    bd.className = 'vh-bd';
    bd.setAttribute('aria-hidden', 'true');
    el.replaceWith(wrap);
    wrap.append(bd, el);
    el._vhBd = bd;
    // Gán value bằng code (vd vẽ lại request) cũng phải vẽ lại lớp nền
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    Object.defineProperty(el, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); paintVars(this); } });
    for (const ev of ['input', 'change', 'focus']) el.addEventListener(ev, () => paintVars(el));
    el.addEventListener('scroll', () => syncVars(el));
    for (const ev of ['keyup', 'click', 'select']) el.addEventListener(ev, () => syncVars(el));
    if (window.ResizeObserver) new ResizeObserver(() => syncVars(el)).observe(el);
    new MutationObserver(() => paintVars(el)).observe(el, { attributes: true, attributeFilter: ['type'] });
    paintVars(el);
  }
  const scanVars = root => { if (root.matches?.(VAR_TARGETS)) attachVars(root); root.querySelectorAll?.(VAR_TARGETS).forEach(attachVars); };
  document.addEventListener('DOMContentLoaded', () => {
    scanVars(document.body);
    new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) scanVars(n); }).observe(document.body, { childList: true, subtree: true });
  });
  // App gọi khi environment / biến đổi để tô lại màu
  const repaintVars = () => document.querySelectorAll('.vh-bd').forEach(bd => paintVars(bd.nextElementSibling));
  const setVarState = fn => { varApi.state = fn; repaintVars(); };

  window.Ui = {
    $, $$, esc, debounce, norm, slug, fmtDur, fmtBytes, fmtTime, methodTag, download, pickFile, toast, copyText,
    modal, confirmBox, promptBox, chooseBox, openDrawer, closeDrawer, currentDrawer, menu, closeMenu, kvEditor, jsonView, visibleFocusables,
    setVarState, repaintVars,
  };
})();
