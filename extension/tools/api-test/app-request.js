// UI · Kiểm thử API — Request: trình soạn (Params / Authorization / Headers / Body / Scripts / Tests), nút Send,
// xem response, dán cURL / fetch (có bước xem lại trước khi đổi request). Gửi qua ApiEngine.send — cùng pipeline với Runner.
(() => {
  const { $, $$, esc, toast, debounce } = Ui;
  const App = window.App;
  const S = App.state;
  const RT = ['params', 'auth', 'headers', 'body', 'scripts', 'tests'];
  const sends = App.sends = new Map(); // requestId → { running, ctrl, result, changed, at, envName }
  const rs = { tab: 'body', pretty: true, q: '' }; // trạng thái khung response
  let scriptTab = 'pre';
  const node = () => { const n = App.W?.get(S.sel); return n?.type === 'request' ? n : null; };
  const touch = () => { const n = node(); if (n) App.W.touch(n.id); };
  const literalSecret = (k, v) => ApiWorkspace.isLiteralSecret(k, v);

  // ================= KHỞI TẠO =================
  App.initRequest = () => {
    $('#apiRef').innerHTML = API_REF.map(([a, b]) => `<li><code>${esc(a)}</code> ${esc(b)}</li>`).join('');
    const h = App.W.meta.ui.splitH;
    if (h) document.documentElement.style.setProperty('--resp-h', h + 'px');
    App.on('vars', () => { if (node() && S.nav === 'requests') { renderUrlNote(); renderCounts(); if (!$('#rqAuth').contains(document.activeElement)) authEd?.draw(); } });
    App.on('env', () => { if (node() && S.nav === 'requests') renderResponse(); });
  };

  // ================= VẼ REQUEST =================
  let kvQuery, kvHeaders, authEd = null, authFor = null;
  App.renderRequest = () => {
    const n = node();
    if (!n) return;
    const W = App.W;
    const chain = W.path(n.id);
    $('#rqCrumbs').innerHTML = n.parentId
      ? chain.slice(0, -1).map(x => `<button type="button" class="crumb" data-go="${esc(x.id)}">${esc(x.name)}</button><span class="ms sm" aria-hidden="true">chevron_right</span>`).join('')
      : '<span class="crumb muted">Chưa lưu</span><span class="ms sm" aria-hidden="true">chevron_right</span>';
    $('#rqName').value = n.name;
    $('#rqDraft').classList.toggle('hidden', !!n.parentId);
    $('#btnSaveTo').classList.toggle('hidden', !!n.parentId);
    $('#rqMethod').value = n.method;
    $('#rqMethod').dataset.m = n.method.toLowerCase();
    $('#rqUrl').value = n.url;
    kvQuery ||= Ui.kvEditor($('#rqQuery'), () => node()?.query || [], { enabled: true, keyPh: 'key', valPh: 'value', empty: 'Không có query param.', addText: 'Thêm param', onChange: () => { touch(); renderCounts(); renderUrlNote(); } });
    kvHeaders ||= Ui.kvEditor($('#rqHeaders'), () => node()?.headers || [], {
      enabled: true, keyLabel: 'Header', keyPh: 'Header-Name', valPh: 'value', empty: 'Không có header.', addText: 'Thêm header',
      suggest: [{ key: 'Content-Type', value: 'application/json', label: 'Content-Type: application/json' }, { key: 'Accept', value: 'application/json', label: 'Accept: application/json' }],
      onChange: () => { touch(); renderCounts(); renderHeadersNote(); },
    });
    kvQuery.render();
    kvHeaders.render();
    renderHeadersNote();
    if (authFor !== n) { // gắn lại khi đổi request (so theo object: import thay thế giữ id nhưng tạo object mới)
      $('#rqAuth').replaceWith(Object.assign(document.createElement('div'), { id: 'rqAuth' }));
      authEd = App.authEditor($('#rqAuth'), n, { onChange: () => { touch(); renderCounts(); renderUrlNote(); } });
      authFor = n;
    } else authEd.draw();
    $('#rqBody').value = n.body.text;
    renderBodyMode();
    renderScriptTab();
    App.renderTests?.();
    setTab(App.W.meta.ui.rt || 'params', { silent: true });
    renderCounts();
    renderUrlNote();
    renderResponse();
  };

  function setTab(t, { silent = false } = {}) {
    if (!RT.includes(t)) t = 'params';
    for (const x of RT) {
      $('#rt-' + x).classList.toggle('hidden', x !== t);
      const tab = $('#rt-tab-' + x);
      tab.setAttribute('aria-selected', x === t);
      tab.tabIndex = x === t ? 0 : -1;
    }
    if (App.W.meta.ui.rt !== t) { App.W.meta.ui.rt = t; App.saveUi(); }
    if (t === 'scripts') renderGutter();
    if (!silent) $('#rt-tab-' + t).focus();
  }
  App.setRequestTab = setTab;
  $('.rq-tabs').addEventListener('click', e => { const t = e.target.closest('[data-rt]'); if (t) setTab(t.dataset.rt, { silent: true }); });
  $('.rq-tabs').addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    setTab(RT[(RT.indexOf(App.W.meta.ui.rt || 'params') + d + RT.length) % RT.length]);
  });
  $('#rqCrumbs').addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) App.select(g.dataset.go); });

  function renderCounts() {
    const n = node();
    if (!n) return;
    const q = n.query.filter(x => x.enabled !== false && x.key).length;
    const h = n.headers.filter(x => x.enabled !== false && x.key).length;
    $('#cntParams').textContent = q || '';
    $('#cntHeaders').textContent = h || '';
    $('#cntBody').textContent = n.body.mode === 'none' ? '' : { json: 'JSON', text: 'Text', raw: 'Text', xml: 'XML', 'form-urlencoded': 'form' }[n.body.mode];
    const { auth } = App.W.effectiveAuth(n.id);
    $('#cntAuth').innerHTML = auth.type === 'none' ? '' : `<span class="ms sm ok-t" aria-label="${n.auth.type === 'inherit' ? 'kế thừa' : 'đã cấu hình'}">${n.auth.type === 'inherit' ? 'subdirectory_arrow_right' : 'check_circle'}</span>`;
    const sc = ['pre', 'post'].filter(k => n.scripts[k].trim());
    $('#cntScripts').textContent = sc.length ? sc.map(k => (k === 'pre' ? 'Pre' : 'Post')).join('+') : '';
    const s = App.W.suite(n.id);
    $('#cntTests').textContent = s ? s.cases.length : '';
  }
  App.renderRequestCounts = renderCounts;
  function renderHeadersNote() {
    const n = node();
    const muted = n?.meta?.muted || [];
    const lit = (n?.headers || []).filter(h => h.enabled !== false && literalSecret(h.key, h.value)).map(h => h.key);
    $('#rqHeadersNote').innerHTML = [
      muted.length ? `Đã tắt ${muted.length} header do trình duyệt tự thêm (${esc(muted.slice(0, 3).join(', '))}${muted.length > 3 ? '…' : ''}). Tích lại nếu cần gửi.` : '',
      lit.length ? `<span class="warn-t"><span class="ms sm" aria-hidden="true">info</span> ${esc(lit.join(', '))} đang ghi thẳng giá trị bí mật: chỉ giữ trong phiên trình duyệt. Nên dùng <code>{{TOKEN}}</code>.</span>` : '',
      'Header của collection / environment và Authorization được gộp khi gửi; header ở đây thắng header cùng tên của collection.',
    ].filter(Boolean).join(' ');
  }

  // ---------- Tên / method / URL ----------
  const treeSoon = debounce(() => App.renderTree(), 250);
  $('#rqName').addEventListener('input', e => { const n = node(); if (!n) return; const v = e.target.value.trim(); if (v) { n.name = v; touch(); treeSoon(); } });
  $('#rqName').addEventListener('change', e => { const n = node(); if (n && !e.target.value.trim()) e.target.value = n.name; });
  $('#rqName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#rqUrl').focus(); } });
  $('#rqMethod').addEventListener('change', e => { const n = node(); if (!n) return; n.method = e.target.value; e.target.dataset.m = n.method.toLowerCase(); touch(); App.renderTree(); });
  const urlNoteSoon = debounce(() => renderUrlNote(), 250);
  $('#rqUrl').addEventListener('input', e => { const n = node(); if (!n) return; n.url = e.target.value.trim(); touch(); urlNoteSoon(); treeSoon(); });
  // URL có ?query → tách sang tab Params (giữ {{biến}}, không dùng new URL)
  $('#rqUrl').addEventListener('change', e => {
    const n = node();
    if (!n) return;
    const v = e.target.value.trim();
    const q = v.indexOf('?');
    if (q < 0) return;
    const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
    const rows = v.slice(q + 1).split('#')[0].split('&').filter(Boolean).map(p => { const i = p.indexOf('='); return { key: dec(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : dec(p.slice(i + 1)), enabled: true }; });
    n.url = v.slice(0, q);
    for (const r of rows) { const old = n.query.find(x => x.key === r.key); if (old) Object.assign(old, r); else n.query.push(r); }
    e.target.value = n.url;
    touch();
    kvQuery.render();
    renderCounts();
    renderUrlNote();
    toast(`Đã chuyển ${rows.length} query param sang tab Params`, 'info', 2500);
  });
  $('#rqUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  // Xem trước URL thật sẽ gửi + thiếu biến + host chưa được phép
  function renderUrlNote() {
    const n = node();
    const el = $('#rqUrlNote');
    if (!n) return;
    if (!n.url) { el.innerHTML = '<span class="muted">Nhập URL đầy đủ (https://…) hoặc bắt đầu bằng biến, vd <code>{{baseUrl}}/users</code>.</span>'; return; }
    const c = ApiEngine.compose(App.W, n.id, { envId: App.W.meta.activeEnvId });
    const miss = new Set();
    const url = ApiCheck.substitute(n.url, c.vars, miss);
    const later = new Set(ApiWorkspace.scriptSets(c.scripts.pre));
    const missing = [...miss].filter(v => !later.has(v));
    if (missing.length) {
      el.innerHTML = `<span class="warn-t"><span class="ms sm" aria-hidden="true">error</span> Chưa có giá trị cho ${missing.map(v => `<code>{{${esc(v)}}}</code>`).join(', ')}</span>
        <button type="button" class="link-btn" data-note-fill="${esc(missing[0])}">Nhập giá trị</button>`;
      return;
    }
    let host;
    try { host = new URL(url).host; } catch { el.innerHTML = `<span class="warn-t"><span class="ms sm" aria-hidden="true">error</span> URL chưa hợp lệ: <code>${esc(url)}</code></span>`; return; }
    const red = ApiRedact.create(c.secretValues);
    const blocked = ApiPolicy.check(url, c.allowHosts);
    el.innerHTML = `<span class="muted url-preview" title="URL sau khi thay biến">→ <code>${esc(red.url(url))}</code></span>
      ${blocked ? `<span class="warn-t"><span class="ms sm" aria-hidden="true">shield</span> ${esc(host)} chưa được phép</span> <button type="button" class="link-btn" data-note-allow="${esc(host)}">Cho phép</button>` : ''}`;
  }
  App.renderUrlNote = renderUrlNote;
  $('#rqUrlNote').addEventListener('click', e => {
    const f = e.target.closest('[data-note-fill]');
    if (f) { showFillBox([f.dataset.noteFill, ...missingVarsOf(node())].filter((v, i, a) => a.indexOf(v) === i)); return; }
    const a = e.target.closest('[data-note-allow]');
    if (a) { App.allowHost(a.dataset.noteAllow); renderUrlNote(); }
  });
  function missingVarsOf(n) {
    const W = App.W;
    const c = ApiEngine.compose(W, n.id, { envId: W.meta.activeEnvId });
    const flow = W.varFlow(n.id);
    const later = new Set([...ApiWorkspace.scriptSets(c.scripts.pre), ...c.authSkipped]);
    return [...flow.uses].filter(v => !(v in c.vars) && !later.has(v));
  }
  // Hộp nhập nhanh biến còn thiếu (lưu vào environment đang dùng)
  function showFillBox(names) {
    const W = App.W;
    const env = W.activeEnv();
    const m = Ui.modal({
      title: 'Nhập giá trị biến', sub: `Lưu vào ${esc(env ? env.name : 'Globals')}. Biến bí mật chỉ giữ trong phiên trình duyệt.`,
      body: `<div class="fill-list">${names.map(v => {
        const prod = W.producers(v);
        return App.fillInput(v, { scope: 'm' }) + (prod.length ? `<p class="muted small fill-hint"><span class="ms sm" aria-hidden="true">lightbulb</span> Request <button type="button" class="link-btn" data-open-req="${esc(prod[0].id)}">${esc(prod[0].name)}</button> sinh ra biến này: Send request đó trước (giá trị vào Runtime), hoặc chạy cả hai bằng Runner.</p>` : '');
      }).join('')}</div>`,
      actions: '<button class="btn btn-ghost" type="button" data-envs>Mở Environments</button><button class="btn btn-primary" type="button" data-cancel>Xong</button>',
      onClose: () => { App.emit('vars'); },
    });
    m.el.querySelector('[data-envs]').addEventListener('click', () => { m.close(); App.openEnvManager(env?.id, { focusVar: names[0] }); });
    m.el.addEventListener('click', e => { const o = e.target.closest('[data-open-req]'); if (o) { m.close(); App.select(o.dataset.openReq); } });
    m.el.querySelector('[data-fill]')?.focus();
  }
  App.showFillBox = showFillBox;

  // ---------- Body ----------
  const BODY_TABS = ['none', 'json', 'text', 'xml', 'form-urlencoded'];
  const bodyTab = mode => (mode === 'raw' ? 'text' : mode);
  function renderBodyMode() {
    const n = node();
    if (!n) return;
    const mode = bodyTab(n.body.mode);
    $$('#bodySeg [data-mode]').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
    $('#rqBody').classList.toggle('hidden', mode === 'none');
    $('#bodyNone').classList.toggle('hidden', mode !== 'none');
    $('#btnPrettyBody').classList.toggle('hidden', mode !== 'json');
    $('#rqBody').placeholder = { json: '{\n  "name": "Nguyen Van A",\n  "email": "{{$randomEmail}}"\n}', text: 'Nội dung gửi nguyên văn', xml: '<user><name>Nguyen Van A</name></user>', 'form-urlencoded': 'name=Nguyen+Van+A&age=20' }[mode] || '';
    renderBodyHint();
  }
  function renderBodyHint() {
    const n = node(), el = $('#bodyHint');
    el.className = 'small';
    el.textContent = '';
    if (!n) return;
    if (n.body.mode === 'json' && n.body.text.trim()) {
      try { JSON.parse(n.body.text); el.textContent = 'JSON hợp lệ'; el.classList.add('ok-t'); }
      catch (e) {
        if (/\{\{/.test(n.body.text)) { el.textContent = 'Có {{biến}} ngoài dấu nháy: gửi nguyên văn sau khi thay biến'; el.classList.add('muted'); }
        else { el.textContent = 'JSON không hợp lệ: ' + e.message; el.classList.add('err-t'); }
      }
    } else if (n.body.mode === 'form-urlencoded') el.textContent = 'dạng a=1&b=2';
    if (n.body.mode !== 'none' && (n.method === 'GET' || n.method === 'HEAD')) { el.textContent = `${n.method} không gửi body: body sẽ bị bỏ khi gửi`; el.className = 'small warn-t'; }
  }
  const setBodyMode = mode => { const n = node(); if (!n) return; n.body.mode = mode; touch(); renderBodyMode(); renderCounts(); };
  $('#bodySeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setBodyMode(b.dataset.mode); });
  $('#bodySeg').addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const n = node();
    if (!d || !n) return;
    e.preventDefault();
    setBodyMode(BODY_TABS[(BODY_TABS.indexOf(bodyTab(n.body.mode)) + d + BODY_TABS.length) % BODY_TABS.length]);
    $(`#bodySeg [data-mode="${bodyTab(n.body.mode)}"]`).focus();
  });
  $('#rqBody').addEventListener('input', e => { const n = node(); if (!n) return; n.body.text = e.target.value; touch(); renderBodyHint(); });
  $('#btnPrettyBody').addEventListener('click', () => {
    const n = node();
    try { n.body.text = JSON.stringify(JSON.parse(n.body.text), null, 2); $('#rqBody').value = n.body.text; touch(); renderBodyHint(); }
    catch { toast('JSON body chưa hợp lệ nên chưa format được', 'warn'); }
  });

  // ================= SCRIPTS =================
  const SNIPPETS = {
    pre: [
      { title: 'Login lấy token', desc: 'pm.sendRequest tới API login, set TOKEN', code: `// Gọi API đăng nhập, lưu token để request dùng {{TOKEN}}
const res = await pm.sendRequest({
  url: pm.variables.replaceIn('{{baseUrl}}/auth/login'),
  method: 'POST',
  header: { 'Content-Type': 'application/json' },
  body: { mode: 'raw', raw: JSON.stringify({ username: pm.environment.get('USERNAME'), password: pm.environment.get('PASSWORD') }) },
});
pm.environment.set('TOKEN', res.json().data.access_token);` },
      { title: 'X-Request-Id + timestamp', desc: 'Header mới cho mỗi request', code: `pm.request.headers.upsert({ key: 'X-Request-Id', value: Date.now() + '-' + Math.random().toString(36).slice(2, 10) });
pm.request.headers.upsert({ key: 'X-Timestamp', value: String(Math.floor(Date.now() / 1000)) });` },
      { title: 'HMAC-SHA256 signature', desc: 'Header X-Signature từ SECRET_KEY', code: `const enc = new TextEncoder();
const key = await crypto.subtle.importKey('raw', enc.encode(pm.environment.get('SECRET_KEY')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = await crypto.subtle.sign('HMAC', key, enc.encode(pm.request.body.raw));
pm.request.headers.upsert({ key: 'X-Signature', value: [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('') });` },
      { title: 'Random phone / email', desc: 'Tránh trùng dữ liệu khi chạy lại', code: `pm.variables.set('PHONE', '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'));
pm.variables.set('EMAIL', 'qa-' + Date.now() + '@yopmail.com');
// Dùng {{PHONE}}, {{EMAIL}} trong body của request hoặc của case` },
      { title: 'Chỉ áp dụng cho một group', desc: 'Rẽ nhánh theo pm.case.group', code: `if (pm.case.group === 'Negative') {
  pm.request.headers.remove('Authorization');
}` },
    ],
    post: [
      { title: 'Status code 2xx', desc: 'pm.response.to.be.ok', code: `pm.test('Status 2xx', () => pm.response.to.be.ok);` },
      { title: 'Check field trong response', desc: 'pm.expect(...).to.have.property', code: `const body = pm.response.json();
pm.test('Có data.id', () => pm.expect(body.data).to.have.property('id'));` },
      { title: 'Response time < 1s', desc: 'pm.response.responseTime', code: `pm.test('Phản hồi dưới 1 giây', () => pm.expect(pm.response.responseTime).to.be.below(1000));` },
      { title: 'Set variable cho request sau', desc: 'pm.environment.set (Runtime)', code: `if (pm.response.code === 201) {
  pm.environment.set('ORDER_ID', pm.response.json().data.id);
}` },
      { title: 'console.log', desc: 'Ghi vào Console', code: `console.log(pm.case.id, pm.response.code, pm.response.text().slice(0, 200));` },
    ],
  };
  const API_REF = [
    ['pm.request', '.url, .method, .headers.get/upsert/remove, .body.raw (sửa được ở Pre-request)'],
    ['pm.response', '.code, .status, .responseTime, .headers.get(), .json(), .text(), .to.have.status(201), .to.be.ok'],
    ['pm.environment / pm.variables', '.get(), .set(), .unset(), .has(), .replaceIn("{{X}}"): biến Runtime của lần gửi / lần chạy (không ghi đè environment đã lưu)'],
    ['pm.test(tên, fn)', 'mỗi test là một dòng kiểm tra, sai thì FAIL'],
    ['pm.expect(x)', '.to.equal, .eql, .include, .be.a("string"), .have.property, .be.above/below, .exist, .be.true, .match, .oneOf, .not…'],
    ['pm.sendRequest(req)', 'gọi API phụ (await), chỉ tới Allowed hosts; req theo cú pháp Postman'],
    ['pm.case', '.id, .name, .group, .priority, .note của case đang chạy (Send: case "SEND")'],
    ['console.log()', 'ghi vào Console'],
    ["require('crypto-js') / CryptoJS", 'HmacSHA256, HmacSHA1, HmacSHA512, HmacMD5, SHA256, SHA1, SHA512, MD5, enc.Hex / Base64 / Utf8 / Latin1 (như Postman)'],
  ];
  const codeEl = $('#scriptCode');
  const lineCount = s => (s.trim() ? s.split('\n').length : 0);
  let escForTab = false;
  function renderScriptTab() {
    const n = node();
    if (!n) return;
    $$('.script-seg [data-script]').forEach(t => { const on = t.dataset.script === scriptTab; t.setAttribute('aria-selected', on); t.classList.toggle('on', on); });
    codeEl.value = n.scripts[scriptTab];
    codeEl.placeholder = scriptTab === 'pre'
      ? '// Chạy trước khi gửi. Ví dụ:\n// pm.request.headers.upsert({ key: \'X-Request-Id\', value: String(Date.now()) });'
      : '// Chạy sau khi nhận response. Ví dụ:\n// pm.test(\'Có data.id\', () => pm.expect(pm.response.json().data).to.have.property(\'id\'));';
    $('#btnTryPre').classList.toggle('hidden', scriptTab !== 'pre');
    const col = App.W.collectionOf(n.id);
    $('#scriptWhen').innerHTML = (scriptTab === 'pre'
      ? 'Chạy <b>trước khi gửi</b> (Send và mỗi case khi Run): set biến, sửa <code>pm.request</code>, gọi <code>pm.sendRequest</code>. Lỗi → ERROR, request không được gửi.'
      : 'Chạy <b>sau khi nhận response</b>: mỗi <code>pm.test</code> là một dòng kiểm tra, sai → FAIL. Lỗi script → ERROR.')
      + (col?.scripts[scriptTab]?.trim() ? ` <span class="badge badge-info">Collection ${esc(col.name)} cũng có ${scriptTab === 'pre' ? 'Pre-request' : 'Post-response'} script, chạy trước script này</span>` : '');
    $('#snippets').innerHTML = SNIPPETS[scriptTab].map((s, i) => `<button type="button" class="snippet" data-snip="${i}"><b>${esc(s.title)}</b><span>${esc(s.desc)}</span></button>`).join('');
    $('#tryOut').classList.add('hidden');
    $('#preCount').textContent = lineCount(n.scripts.pre) || '';
    $('#postCount').textContent = lineCount(n.scripts.post) || '';
    renderGutter();
    checkScriptSoon(0);
  }
  function renderGutter() {
    const lines = Math.max(1, codeEl.value.split('\n').length);
    $('#codeGutter').textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    $('#codeGutter').scrollTop = codeEl.scrollTop;
  }
  const checkScriptSoon = (() => {
    let timer;
    return (delay = 500) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const n = node();
        if (!n) return;
        const src = n.scripts[scriptTab], st = $('#scriptStatus');
        if (!src.trim()) { st.className = 'script-status muted'; st.textContent = scriptTab === 'pre' ? 'Chưa có Pre-request script (không bắt buộc).' : 'Chưa có Post-response script (không bắt buộc).'; return; }
        const out = await ApiScript.check(src);
        if (src !== node()?.scripts[scriptTab]) return;
        st.className = 'script-status ' + (out.error ? 'err-t' : 'ok-t');
        st.innerHTML = out.error ? `<span class="ms sm" aria-hidden="true">error</span> ${esc(out.error)}` : '<span class="ms sm" aria-hidden="true">check_circle</span> Syntax OK';
      }, delay);
    };
  })();
  $('.script-seg').addEventListener('click', e => { const t = e.target.closest('[data-script]'); if (t) { scriptTab = t.dataset.script; renderScriptTab(); } });
  codeEl.addEventListener('input', () => {
    const n = node();
    if (!n) return;
    n.scripts[scriptTab] = codeEl.value;
    touch();
    renderGutter();
    $('#preCount').textContent = lineCount(n.scripts.pre) || '';
    $('#postCount').textContent = lineCount(n.scripts.post) || '';
    renderCounts();
    checkScriptSoon();
  });
  codeEl.addEventListener('scroll', () => { $('#codeGutter').scrollTop = codeEl.scrollTop; });
  // Tab = thụt lề 2 dấu cách; Esc rồi Tab để rời ô (không bẫy bàn phím)
  codeEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { escForTab = true; return; }
    if (e.key === 'Tab' && !escForTab && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const { selectionStart: a, selectionEnd: b, value } = codeEl;
      if (e.shiftKey) {
        const ls = value.lastIndexOf('\n', a - 1) + 1;
        if (value.startsWith('  ', ls)) { codeEl.setRangeText('', ls, ls + 2, 'end'); codeEl.setSelectionRange(Math.max(ls, a - 2), Math.max(ls, b - 2)); }
      } else codeEl.setRangeText('  ', a, b, 'end');
      codeEl.dispatchEvent(new Event('input'));
      return;
    }
    escForTab = false;
  });
  function insertCode(text) {
    const { selectionStart: a, selectionEnd: b, value } = codeEl;
    const before = value.slice(0, a), after = value.slice(b);
    const pre = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const post = after && !after.startsWith('\n') ? '\n' : '';
    codeEl.setRangeText(pre + text + post, a, b, 'end');
    codeEl.focus();
    codeEl.dispatchEvent(new Event('input'));
  }
  $('#snippets').addEventListener('click', e => { const b = e.target.closest('[data-snip]'); if (b) insertCode(SNIPPETS[scriptTab][Number(b.dataset.snip)].code); });
  $('#btnClearScript').addEventListener('click', async () => {
    const n = node();
    if (!n || !codeEl.value.trim()) return;
    const ok = await Ui.confirmBox(`Xoá ${scriptTab === 'pre' ? 'Pre-request' : 'Post-response'} script?`, '<p>Toàn bộ nội dung script ở tab này sẽ bị xoá.</p>', 'Xoá');
    if (!ok) return;
    n.scripts[scriptTab] = '';
    touch();
    renderScriptTab();
    renderCounts();
    codeEl.focus();
  });
  // Dry run: chạy riêng Pre-request script (collection + request), không gửi request chính
  $('#btnTryPre').addEventListener('click', async () => {
    const n = node(), out = $('#tryOut');
    out.classList.remove('hidden');
    const W = App.W;
    const c = ApiEngine.compose(W, n.id, { envId: W.meta.activeEnvId, runtime: { ...W.runtime() } });
    if (c.baseError) { out.innerHTML = `<div class="d-msg err">${esc(c.baseError)}</div>`; return; }
    const kase = W.suite(n.id)?.cases.find(k => k.enabled) || { id: 'DRY-RUN', name: 'Dry run', priority: 'P2', expect: null };
    let built;
    try { built = ApiRunner.build(c.base, c.envLayer, kase, c.vars); } catch (x) { out.innerHTML = `<div class="d-msg err">${esc(x.message)}</div>`; return; }
    out.innerHTML = '<p class="muted small"><span class="ms sm spin" aria-hidden="true">progress_activity</span> Đang dry run…</p>';
    const logs = [], secrets = [...c.secretValues];
    const onSend = async raw => {
      const q = ApiRunner.normSend(raw);
      const blocked = ApiPolicy.check(q.url, c.allowHosts);
      if (blocked) { logs.push(`pm.sendRequest ${q.method} ${q.url} bị chặn: ${blocked}`); throw new Error(blocked); }
      const res = await ApiTransport.send(q, { timeout: 30000, allowHosts: c.allowHosts });
      logs.push(`pm.sendRequest ${q.method} ${q.url} → ${res.status} (${res.timeMs} ms)`);
      return { status: res.status, statusText: res.statusText, headers: res.headers, body: res.body, timeMs: res.timeMs, size: res.size };
    };
    const r = await ApiScript.run('pre', { code: c.scripts.pre, request: built.request, vars: c.vars, case: ApiRunner.caseInfo(kase) }, { onSend });
    await ApiTransport.cleanup();
    const changed = Object.entries(r.vars || {}).filter(([k, v]) => c.vars[k] !== v);
    for (const [k, v] of changed) if (ApiRedact.isSecretName(k) || c.secretNames.has(k)) secrets.push(String(v));
    let finalReq = built.request, note = '';
    if (!r.error) {
      try {
        const fin = ApiRunner.resubstitute(r.request || built.request, r.vars);
        finalReq = fin.request;
        if (fin.missing.length) note = `Vẫn thiếu biến: ${fin.missing.map(v => `{{${v}}}`).join(', ')}`;
        if (r.missingVars?.length) note = [note, `Script đọc biến chưa có (ra undefined): ${r.missingVars.join(', ')}`].filter(Boolean).join(' · ');
      } catch (x) { note = x.message; }
    }
    const red = ApiRedact.create(secrets);
    const reqTxt = `${finalReq.method} ${red.url(finalReq.url)}\n${ApiReport.headerText(red.headers(finalReq.headers))}${finalReq.body != null ? '\n\n' + ApiReport.pretty(red.body(finalReq.body)) : ''}`;
    out.innerHTML = `
      <div class="try-head"><b>Dry run${kase.id !== 'DRY-RUN' ? ` · case ${esc(kase.id)}` : ''}</b><span class="muted small">Request chính không được gửi.</span></div>
      ${r.error ? `<div class="d-msg err">Lỗi: ${esc(red.text(r.error))}</div>` : '<div class="d-msg ok">Pre-request script chạy xong, không lỗi.</div>'}
      ${note ? `<div class="d-msg warn">${esc(note)}</div>` : ''}
      <h4>Request sẽ gửi${r.requestChanged ? ' <span class="badge badge-info">đã sửa bởi script</span>' : ''}</h4><pre class="code-view">${esc(reqTxt)}</pre>
      <h4>Biến được set</h4><pre class="code-view">${esc(changed.length ? changed.map(([k, v]) => `${k} = ${ApiRedact.isSecretName(k) ? ApiRedact.MASK : red.text(v)}`).join('\n') : '(không có)')}</pre>
      <h4>Console</h4><pre class="code-view">${esc([...logs, ...(r.logs || [])].map(l => red.text(l)).join('\n') || '(không có)')}</pre>`;
  });

  // ================= SEND =================
  const PRE_SEND = new Set(['build', 'variable', 'policy', 'permission', 'script', 'dependency']);
  async function send() {
    const n = node();
    if (!n) return;
    const W = App.W;
    const cur = sends.get(n.id);
    if (cur?.running) return;
    const env = W.activeEnv();
    const c = ApiEngine.compose(W, n.id, { envId: W.meta.activeEnvId });
    if (c.baseError) { setSend(n.id, { result: preResult(n, 'build', c.baseError) }); return; }
    // Thiếu biến (không tính biến do Pre-request script tự đặt) → chưa gửi, hỏi giá trị
    const missing = missingVarsOf(n);
    if (missing.length) { setSend(n.id, { result: preResult(n, 'variable', `Chưa có giá trị cho biến ${missing.map(v => `{{${v}}}`).join(', ')}`, { missingVars: missing }) }); return; }
    const url = ApiEngine.targetUrl(c);
    const blocked = url ? ApiPolicy.check(url, c.allowHosts) : null;
    if (blocked) {
      let host = '';
      try { host = new URL(url).host; } catch {}
      setSend(n.id, { result: preResult(n, 'policy', blocked, { host }) });
      return;
    }
    if (url && !(await ApiTransport.hasPermission(url))) { setSend(n.id, { result: preResult(n, 'permission', `Chrome chưa cấp quyền cho extension truy cập ${new URL(url).host}`, { url }) }); return; }
    const mut = ApiEngine.MUTATING.includes(n.method);
    if (W.isProdEnv(env) && mut) {
      const ok = await Ui.confirmBox('Gửi request ghi dữ liệu lên PRODUCTION?', `<div class="prod-note"><span class="ms sm fill" aria-hidden="true">warning</span><span>Environment <b>${esc(env.name)}</b> là production.</span></div>
        <p><b>${esc(n.method)}</b> <code>${esc(ApiRedact.create(c.secretValues).url(url || n.url))}</code> có thể tạo / sửa / xoá dữ liệu thật.</p>`, `Gửi ${n.method} lên PROD`);
      if (!ok) return;
    }
    const ctrl = new AbortController();
    setSend(n.id, { running: true, ctrl, result: cur?.result || null });
    try {
      const { result, changed } = await ApiEngine.send(W, n.id, { envId: W.meta.activeEnvId, timeout: W.meta.settings.timeout || 30000, signal: ctrl.signal });
      setSend(n.id, { result, changed, at: Date.now(), envName: env?.name || '' });
      if (result.response) App.markDone?.('sent');
      if (changed.length) {
        toast(`Đã lưu ${changed.map(v => `{{${v}}}`).join(', ')} vào Runtime: request khác dùng được ngay`, 'ok', 5000, { label: 'Xem', fn: () => { S.envSel = 'runtime'; App.setNav('envs'); } });
        App.emit('vars');
      }
    } catch (e) {
      setSend(n.id, { result: preResult(n, 'network', e.message) });
    } finally {
      await ApiTransport.cleanup();
    }
  }
  App.sendRequest = send;
  const preResult = (n, kind, reason, extra = {}) => ({
    status: kind === 'cancelled' ? 'SKIPPED' : 'ERROR', errorKind: kind, reason, request: null, response: null, assertions: [], warnings: [], scriptLogs: [], extracted: {}, ...extra,
  });
  function setSend(id, s) {
    sends.set(id, { running: false, ...s });
    if (node()?.id === id) renderResponse();
  }
  $('#btnSend').addEventListener('click', () => {
    const s = sends.get(node()?.id);
    if (s?.running) { s.ctrl.abort(); return; }
    send();
  });
  document.addEventListener('keydown', e => {
    if (S.nav !== 'requests' || !node() || document.querySelector('.modal-bg') || Ui.currentDrawer()) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ApiStore.flush(); toast('Tool tự lưu mọi thay đổi', 'info', 1500); }
  });

  // ================= RESPONSE =================
  const KIND_TITLE = {
    build: 'Request chưa hợp lệ', variable: 'Thiếu biến', policy: 'Host chưa được phép', permission: 'Chưa có quyền truy cập host',
    script: 'Script lỗi', network: 'Không nhận được response', evaluate: 'Lỗi khi chấm', cancelled: 'Đã huỷ', dependency: 'Thiếu biến từ request khác',
  };
  function renderResponse() {
    const n = node();
    const box = $('#rqResponse');
    if (!n) return;
    const s = sends.get(n.id);
    const btn = $('#btnSend');
    btn.classList.toggle('stop', !!s?.running);
    btn.querySelector('.ms').textContent = s?.running ? 'stop' : 'send';
    btn.querySelector('.lbl').textContent = s?.running ? 'Huỷ' : 'Send';
    btn.title = s?.running ? 'Huỷ request đang gửi' : 'Gửi request (Ctrl + Enter)';
    if (s?.running) {
      box.innerHTML = `<div class="resp-empty"><span class="ms lg spin" aria-hidden="true">progress_activity</span><p>Đang gửi…</p></div>`;
      return;
    }
    const r = s?.result;
    if (!r) {
      box.innerHTML = `<div class="resp-empty"><span class="ms lg" aria-hidden="true">send</span><p><b>Chưa gửi</b></p>
        <ol class="mini-steps">
          <li>Kiểm tra method + URL (dùng được <code>{{baseUrl}}</code>), thêm Headers / Body nếu API cần.</li>
          <li>Bấm <b>Send</b> (hoặc <kbd>Ctrl</kbd> + <kbd>Enter</kbd>): response hiện ở đây, không cần test case.</li>
          <li>Sau đó: bấm tên field để lưu thành biến, hoặc sang tab <b>Tests</b> để thêm test case.</li>
        </ol>
        <button type="button" class="link-btn" data-help="request">Hướng dẫn chi tiết</button></div>`;
      return;
    }
    const res = r.response;
    if (!res) {
      const notSent = PRE_SEND.has(r.errorKind) || r.errorKind === 'script';
      let acts = '';
      if (r.errorKind === 'variable') acts = `<button type="button" class="btn btn-primary btn-sm" data-resp="fill">Nhập giá trị</button>`;
      else if (r.errorKind === 'policy' && r.host) acts = `<button type="button" class="btn btn-primary btn-sm" data-resp="allow" data-host="${esc(r.host)}">Cho phép ${esc(r.host)}</button><button type="button" class="btn btn-sm" data-resp="hosts">Mở Allowed hosts</button>`;
      else if (r.errorKind === 'permission') acts = `<button type="button" class="btn btn-primary btn-sm" data-resp="grant" data-url="${esc(r.url || '')}">Cấp quyền</button>`;
      else if (r.errorKind === 'build') acts = `<button type="button" class="btn btn-sm" data-resp="body">Mở Body</button>`;
      else if (r.errorKind === 'script') acts = `<button type="button" class="btn btn-sm" data-resp="scripts">Mở Scripts</button>`;
      const hintVar = r.errorKind === 'variable' && r.missingVars?.length ? r.missingVars.map(v => {
        const p = App.W.producers(v).filter(x => x.id !== n.id);
        return p.length ? `<p class="muted small"><code>{{${esc(v)}}}</code> do request <button type="button" class="link-btn" data-open-req="${esc(p[0].id)}">${esc(p[0].name)}</button> sinh ra: Send request đó trước, hoặc nhập giá trị trong Environment.</p>` : '';
      }).join('') : '';
      box.innerHTML = `<div class="resp-head"><span class="badge ${notSent ? 'badge-warning' : 'badge-error'}"><span class="ms sm" aria-hidden="true">${notSent ? 'block' : 'cloud_off'}</span> ${notSent ? 'Chưa gửi' : 'Lỗi'}</span>${s.at ? `<span class="muted small">${esc(Ui.fmtTime(s.at))}</span>` : ''}</div>
        <div class="resp-err"><h3>${esc(KIND_TITLE[r.errorKind] || 'Lỗi')}</h3><p>${esc(r.reason)}</p>${notSent ? '<p class="muted small">Request <b>chưa được gửi</b> tới máy chủ.</p>' : ''}${hintVar}
          ${acts ? `<div class="row-actions">${acts}</div>` : ''}
          ${r.scriptLogs?.length || r.warnings?.length ? `<details class="adv"><summary><span class="ms sm chev" aria-hidden="true">chevron_right</span>Chi tiết kỹ thuật</summary><pre class="code-view">${esc([...r.warnings, ...r.scriptLogs].join('\n'))}</pre></details>` : ''}</div>`;
      return;
    }
    const tests = r.assertions.filter(a => a.source === 'script');
    const failed = tests.filter(a => !a.pass).length;
    const body = res.body ?? '';
    const isJson = !res.isBinary && (() => { try { JSON.parse(body); return true; } catch { return false; } })();
    const consoleN = (r.scriptLogs?.length || 0) + (r.warnings?.length || 0);
    box.innerHTML = `
      <div class="resp-head">
        <span class="badge http-badge http-${String(res.status)[0]}">${res.status} ${esc(res.statusText || '')}</span>
        <span class="muted small" title="Thời gian phản hồi">${Ui.fmtDur(r.durationMs)}</span><span class="muted small" title="Kích thước">${Ui.fmtBytes(res.size)}</span>
        ${res.redirected ? `<span class="badge badge-info" title="${esc(res.url)}"><span class="ms sm" aria-hidden="true">alt_route</span> redirect</span>` : ''}
        ${res.truncated ? '<span class="badge badge-warning">bị cắt ở 10 MB</span>' : ''}
        ${tests.length ? `<span class="badge ${failed ? 'badge-error' : 'badge-success'}">${failed ? `${failed}/${tests.length} test sai` : `${tests.length} test đạt`}</span>` : ''}
        ${Object.keys(r.extracted || {}).length ? `<span class="badge badge-secondary" title="Đã lưu vào Runtime"><span class="ms sm" aria-hidden="true">bolt</span> ${Object.keys(r.extracted).map(esc).join(', ')}</span>` : ''}
        <span class="spacer"></span>
        <span class="muted small">${esc(s.envName || '')} · ${esc(Ui.fmtTime(s.at))}</span>
      </div>
      ${App.nextStepHtml?.(n, r) || ''}
      <div class="tabs resp-tabs" role="tablist" aria-label="Response">
        ${[['body', 'Body'], ['headers', `Headers <span class="n">${Object.keys(res.headers || {}).length}</span>`], ['tests', `Tests <span class="n">${tests.length || ''}</span>`], ['console', `Console <span class="n">${consoleN || ''}</span>`]]
          .map(([k, l]) => `<button class="tab" role="tab" data-rs="${k}" aria-selected="${rs.tab === k}">${l}</button>`).join('')}
      </div>
      <div class="resp-body" id="respBody"></div>`;
    const rb = $('#respBody');
    if (rs.tab === 'body') {
      const jv = isJson && rs.pretty ? Ui.jsonView(body, { query: rs.q }) : null;
      const text = isJson && rs.pretty && !jv ? ApiReport.pretty(body) : body;
      const hl = s2 => {
        if (!rs.q) return esc(s2);
        const parts = String(s2).split(new RegExp(`(${rs.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
        return parts.map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
      };
      const hits = rs.q ? (body.toLowerCase().split(rs.q.toLowerCase()).length - 1) : 0;
      rb.innerHTML = `<div class="resp-tools">
          ${isJson ? `<div class="seg mini-seg" role="radiogroup" aria-label="Kiểu xem"><button type="button" role="radio" data-rs-view="pretty" class="${rs.pretty ? 'on' : ''}" aria-checked="${rs.pretty}">Pretty</button><button type="button" role="radio" data-rs-view="raw" class="${rs.pretty ? '' : 'on'}" aria-checked="${!rs.pretty}">Raw</button></div>` : ''}
          <div class="search-box mini"><span class="ms sm" aria-hidden="true">search</span><input type="search" id="respQ" value="${esc(rs.q)}" placeholder="Tìm trong body" aria-label="Tìm trong body"></div>
          ${rs.q ? `<span class="muted small">${hits} kết quả</span>` : ''}
          <span class="spacer"></span>
          ${jv ? '<span class="muted small hint-click"><span class="ms sm" aria-hidden="true">touch_app</span>Bấm tên field để lưu thành biến</span>' : ''}
          <button type="button" class="btn btn-sm btn-ghost" data-resp="copy"><span class="ms sm" aria-hidden="true">content_copy</span><span class="lbl">Copy</span></button>
        </div>
        ${r.redacted ? '<p class="muted small redact-note"><span class="ms sm" aria-hidden="true">visibility_off</span> Token / mật khẩu / cookie trong response đã được che bằng ****.</p>' : ''}
        <pre class="code-view resp-pre${jv ? ' json-tree' : ''}">${jv || hl(text || '(body trống)')}</pre>`;
    } else if (rs.tab === 'headers') {
      rb.innerHTML = kvTable(res.headers, 'Không có header');
    } else if (rs.tab === 'tests') {
      rb.innerHTML = tests.length ? `<ul class="test-list">${tests.map(a => `<li class="${a.pass ? 'ok' : 'no'}"><span class="badge ${a.pass ? 'badge-success' : 'badge-error'}"><span class="ms sm" aria-hidden="true">${a.pass ? 'check' : 'close'}</span> ${a.pass ? 'PASS' : 'FAIL'}</span><span>${esc(a.path)}</span>${a.pass ? '' : `<span class="err-t small">${esc(a.reason)}</span>`}</li>`).join('')}</ul>`
        : `<div class="resp-empty small"><p class="muted">Chưa có <code>pm.test</code> trong Post-response script. Để chạy test case (status, field, kiểu dữ liệu…) không cần viết code, dùng tab <button type="button" class="link-btn" data-resp="tests-tab">Tests</button> của request.</p></div>`;
    } else {
      const req = r.request;
      rb.innerHTML = (r.warnings?.length ? `<h4>Cảnh báo</h4><ul class="warn-list">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '')
        + `<h4>Request đã gửi <span class="muted small">đã che token / secret</span></h4>${req ? `<div class="code-head">${Ui.methodTag(req.method)}<code class="wrap-any">${esc(req.url)}</code></div>${kvTable(req.headers, 'Không có header')}${req.body != null ? `<pre class="code-view">${esc(ApiReport.pretty(req.body))}</pre>` : ''}` : '<p class="muted small">—</p>'}`
        + `<h4>Console</h4>${r.scriptLogs?.length ? `<pre class="code-view">${esc(r.scriptLogs.join('\n'))}</pre>` : '<p class="muted small">Không có log.</p>'}`;
    }
  }
  App.renderResponse = renderResponse;
  const kvTable = (obj, empty) => {
    const rows = Object.entries(obj || {});
    return rows.length ? `<div class="table-wrap kv-view"><table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${empty}</p>`;
  };
  App.kvTable = kvTable;
  const respQSoon = debounce(v => { rs.q = v; renderResponse(); const i = $('#respQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  $('#rqResponse').addEventListener('input', e => { if (e.target.id === 'respQ') respQSoon(e.target.value.trim()); });
  $('#rqResponse').addEventListener('click', async e => {
    const n = node();
    if (!n) return;
    const t = e.target.closest('[data-rs]');
    if (t) { rs.tab = t.dataset.rs; renderResponse(); $(`[data-rs="${rs.tab}"]`)?.focus(); return; }
    const v = e.target.closest('[data-rs-view]');
    if (v) { rs.pretty = v.dataset.rsView === 'pretty'; renderResponse(); return; }
    const o = e.target.closest('[data-open-req]');
    if (o) { App.select(o.dataset.openReq); return; }
    const jp = e.target.closest('[data-jpath]');
    if (jp && jp.dataset.jpath) { extractMenu(jp, jp.dataset.jpath); return; }
    const a = e.target.closest('[data-resp]');
    if (!a) return;
    const s = sends.get(n.id);
    switch (a.dataset.resp) {
      case 'fill': showFillBox(s.result.missingVars || []); break;
      case 'allow': App.allowHost(a.dataset.host); renderUrlNote(); send(); break;
      case 'hosts': App.openEnvManager(App.W.meta.activeEnvId, { focusHosts: true }); break;
      case 'grant': if (await App.grantPermission([a.dataset.url])) send(); break;
      case 'body': setTab('body'); $('#rqBody').focus(); break;
      case 'scripts': setTab('scripts'); break;
      case 'tests-tab': setTab('tests'); break;
      case 'copy': Ui.copyText(s.result.response.body ?? '', a); break;
    }
  });
  // Bấm field trong JSON → lưu thành biến (rule extract của request: chạy mỗi lần Send / Run)
  const suggestName = path => {
    const last = String(path).split(/[.[\]]/).filter(Boolean).filter(x => !/^\d+$/.test(x)).pop() || 'VALUE';
    if (/^(access_?token|accessToken|token|jwt|id_?token)$/i.test(last)) return 'TOKEN';
    return last.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  };
  function extractMenu(anchor, path) {
    const n = node();
    const exists = n.extract.find(x => x.source === 'body' && x.path === path);
    Ui.menu(anchor, [
      { label: exists ? `Đang lưu vào {{${exists.name}}}` : `Lưu ${path} thành biến…`, icon: 'bolt', disabled: !!exists, action: async () => {
        const name = await Ui.promptBox({ title: 'Lưu giá trị thành biến', label: `Tên biến cho ${path}`, value: suggestName(path), okText: 'Lưu',
          hint: 'Mỗi lần Send / Run request này, giá trị ở đường dẫn trên được lưu vào biến Runtime. Request khác dùng bằng <code>{{TÊN}}</code>; Runner tự chạy request này trước request dùng biến.',
          validate: v => (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v) ? 'Tên chỉ gồm chữ, số, _ . - và không bắt đầu bằng số' : '') });
        if (!name) return;
        n.extract.push({ name, source: 'body', path });
        touch();
        App.renderTests?.();
        toast(`Sẽ lưu {{${name}}} từ ${path} ở lần Send tiếp theo`, 'ok', 6000, { label: 'Send lại', fn: send });
      } },
      { label: 'Copy đường dẫn', icon: 'content_copy', action: () => Ui.copyText(path, null, 'Đã copy ' + path) },
    ]);
  }

  // ---------- Kéo đổi chiều cao vùng response ----------
  (() => {
    const h = $('#splitHandle');
    const set = px => {
      const split = $('#rqSplit').getBoundingClientRect();
      px = Math.max(120, Math.min(split.height - 140, Math.round(px)));
      document.documentElement.style.setProperty('--resp-h', px + 'px');
      App.W.meta.ui.splitH = px;
      App.saveUi();
    };
    h.addEventListener('pointerdown', e => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const bottom = $('#rqSplit').getBoundingClientRect().bottom;
      const move = ev => set(bottom - ev.clientY);
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    });
    h.addEventListener('keydown', e => {
      const d = { ArrowUp: 24, ArrowDown: -24 }[e.key];
      if (!d) return;
      e.preventDefault();
      set($('#rqResponse').getBoundingClientRect().height + d);
    });
  })();

  // ================= MENU REQUEST =================
  $('#btnSaveTo').addEventListener('click', () => App.saveDraftTo(node().id));
  $('#btnRunReq').addEventListener('click', () => App.runRequest?.(node().id));
  $('#btnReqMenu').addEventListener('click', e => App.nodeMenu(node().id, e.currentTarget));
  // Copy as cURL: giữ {{biến}} (không đưa token thật vào clipboard)
  App.copyAsCurl = id => {
    const n = App.W.get(id);
    const c = ApiEngine.compose(App.W, id, { envId: App.W.meta.activeEnvId });
    const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const qs = c.base.query.map(x => `${encodeURIComponent(x.key)}=${x.value}`).join('&');
    const lines = [`curl -X ${n.method} ${q(n.url + (qs ? '?' + qs : ''))}`, ...c.base.headers.map(h => `-H ${q(`${h.key}: ${literalSecret(h.key, h.value) ? '{{SECRET}}' : h.value}`)}`)];
    if (c.base.body && n.method !== 'GET' && n.method !== 'HEAD') lines.push(`--data-raw ${q(n.body.text)}`);
    Ui.copyText(lines.join(' \\\n  '), null, 'Đã copy cURL (biến giữ dạng {{…}})');
  };

  // ================= DÁN cURL / FETCH =================
  const SAMPLE_CURL = "curl 'https://api.example.com/v1/leads' \\\n  -H 'Authorization: Bearer YOUR_TOKEN' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"lead_type\":\"individual\",\"phone_number\":\"{{$randomPhone}}\",\"full_name\":\"Nguyen Van A\"}'";
  const FORMAT_LABEL = { bash: 'cURL', cmd: 'cURL (cmd)', fetch: 'fetch' };
  function secretVarName(key) {
    const k = key.toLowerCase();
    if (k === 'authorization' || k === 'proxy-authorization') return 'TOKEN';
    if (k === 'cookie') return 'COOKIE';
    if (/api[-_]?key/.test(k)) return 'API_KEY';
    return key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SECRET';
  }
  // opts: { parentId } tạo request mới · { replaceId } thay request đang có
  App.pasteCurlFlow = ({ parentId = null, replaceId = null } = {}) => {
    const m = Ui.modal({
      title: replaceId ? 'Dán cURL thay cho request này' : 'Tạo request từ cURL / fetch', wide: true,
      sub: 'Copy từ Postman (Code &lt;/&gt; → cURL) hoặc Chrome DevTools (Network → chuột phải → Copy as cURL / Copy as fetch). Tool chỉ đọc chữ, <b>không chạy lệnh và không gửi request</b>.',
      body: `<div class="paste-box"><textarea id="pcText" class="mono-in" rows="8" spellcheck="false" aria-label="Dán cURL hoặc fetch" placeholder="curl 'https://api.example.com/v1/users' -H 'Authorization: Bearer …'"></textarea></div>
        <div class="inline-msg" id="pcMsg" role="status"></div>
        <div id="pcReview"></div>`,
      actions: `<button class="btn btn-ghost" type="button" data-sample><span class="ms sm" aria-hidden="true">lightbulb</span>Dùng ví dụ</button><span class="spacer"></span>
        <button class="btn" type="button" data-cancel>Huỷ</button>
        <button class="btn" type="button" data-pc="create" disabled>${replaceId ? 'Áp dụng' : 'Tạo request'}</button>
        <button class="btn btn-primary" type="button" data-pc="send" disabled><span class="ms sm fill" aria-hidden="true">send</span>${replaceId ? 'Áp dụng & Send' : 'Tạo & Send'}</button>`,
    });
    const el = m.el;
    let parsed = null;
    const W = App.W;
    const parse = () => {
      const text = el.querySelector('#pcText').value;
      const msg = el.querySelector('#pcMsg');
      parsed = null;
      el.querySelectorAll('[data-pc]').forEach(b => (b.disabled = true));
      if (!text.trim()) { msg.className = 'inline-msg'; msg.textContent = ''; el.querySelector('#pcReview').innerHTML = ''; return; }
      const out = ApiCurl.parse(text);
      if (!out.request) {
        msg.className = 'inline-msg err';
        msg.innerHTML = `<span class="ms sm" aria-hidden="true">error</span><span><b>Chưa đọc được.</b> ${esc(out.errors.join(' · '))}</span>`;
        el.querySelector('#pcReview').innerHTML = '';
        return;
      }
      msg.className = 'inline-msg';
      msg.textContent = '';
      parsed = out;
      renderReview();
      el.querySelectorAll('[data-pc]').forEach(b => (b.disabled = false));
    };
    // Bước xem lại: mọi thay đổi tool muốn làm với request đều hiện ra và cần tester đồng ý
    const renderReview = () => {
      const { request: r, warnings, format, fromBrowser } = parsed;
      const env = W.activeEnv();
      const browserHdr = fromBrowser ? r.headers.filter(h => h.enabled !== false && /^(sec-ch-ua(-.*)?|sec-fetch-.*|sec-gpc|user-agent|accept-language|accept-encoding|priority|referer|origin|dnt|upgrade-insecure-requests|cache-control|pragma|connection|host|content-length|if-none-match|if-modified-since|x-client-data|purpose|sec-purpose)$/i.test(h.key)).map(h => h.key) : [];
      const secrets = [...r.headers.filter(h => h.enabled !== false && literalSecret(h.key, h.value)).map(h => ({ where: 'header', key: h.key })), ...r.query.filter(q => literalSecret(q.key, q.value)).map(q => ({ where: 'query', key: q.key }))];
      let origin = '';
      try { if (/^https?:\/\//i.test(r.url)) origin = new URL(r.url).origin; } catch {}
      const baseVar = env?.vars.find(v => /^base_?url$/i.test(v.key));
      const baseName = baseVar?.key || 'baseUrl';
      const baseDefault = !!origin && (!baseVar || !baseVar.value || baseVar.value === origin);
      let host = '';
      try { if (origin) host = new URL(origin).host; } catch {}
      const allowNeeded = host && ApiPolicy.check(r.url, W.allowHosts(W.meta.activeEnvId));
      const used = [...new Set([r.url, ...r.query.map(q => q.value), ...r.headers.map(h => h.value), r.body.text].flatMap(t => ApiCheck.varsIn(t)))];
      let path = r.url;
      try { path = new URL(r.url.replace(/^\{\{[^}]+\}\}/, 'https://x')).pathname; } catch {}
      const defName = `${r.method} ${path.length > 40 ? '…' + path.slice(-39) : path}`;
      const targets = [{ v: '', l: 'Chưa lưu (lưu vào collection sau)' }];
      const walk = (x, d) => { targets.push({ v: x.id, l: `${'  '.repeat(d)}${d ? '└ ' : ''}${x.name}` }); for (const c of W.children(x.id)) if (c.type === 'folder') walk(c, d + 1); };
      for (const c of W.collections()) walk(c, 0);
      el.querySelector('#pcReview').innerHTML = `
        <div class="pc-sum">${Ui.methodTag(r.method)}<code class="wrap-any">${esc(r.url)}</code></div>
        <p class="muted small">${esc(fromBrowser ? 'Browser' : 'Postman')} · ${esc(FORMAT_LABEL[format] || 'cURL')} · ${r.query.length} param · ${r.headers.length} header · body ${r.body.mode === 'none' ? 'không có' : esc(r.body.mode)}</p>
        ${warnings.length ? `<ul class="warn-list">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${!replaceId ? `<div class="form-grid two">
          <div><label for="pcName">Tên request</label><input type="text" id="pcName" value="${esc(defName)}"></div>
          <div><label for="pcParent">Lưu vào</label><select id="pcParent">${targets.map(t => `<option value="${esc(t.v)}"${t.v === (parentId || '') ? ' selected' : ''}>${esc(t.l)}</option>`).join('')}</select></div>
        </div>` : ''}
        <fieldset class="pc-steps"><legend>Tool đề xuất <span class="muted small">(bỏ tích mục nào không muốn)</span></legend>
          ${browserHdr.length ? `<label class="check"><input type="checkbox" data-opt="mute" checked> Tắt ${browserHdr.length} header trình duyệt tự thêm <span class="muted small">(${esc(browserHdr.slice(0, 4).join(', '))}${browserHdr.length > 4 ? '…' : ''}) — vẫn giữ để bật lại</span></label>` : ''}
          ${secrets.length ? `<label class="check"><input type="checkbox" data-opt="secrets" checked> Chuyển ${secrets.map(s => `<code>${esc(s.key)}</code>`).join(', ')} thành biến bí mật ${[...new Set(secrets.map(s => `{{${secretVarName(s.key)}}}`))].map(esc).join(', ')} của ${esc(env ? env.name : 'Globals')} <span class="muted small">(giá trị chỉ giữ trong phiên, che trong báo cáo)</span></label>` : ''}
          ${origin ? `<label class="check"><input type="checkbox" data-opt="base"${baseDefault ? ' checked' : ''}> Tách base URL: <code>${esc(origin)}</code> → <code>{{${esc(baseName)}}}</code>${env ? ` (lưu giá trị vào ${esc(env.name)})` : ''} <span class="muted small">để đổi environment là đổi máy chủ</span></label>` : ''}
          ${allowNeeded ? `<label class="check"><input type="checkbox" data-opt="allow" checked> Cho phép gửi tới <code>${esc(host)}</code> (thêm vào Allowed hosts của ${esc(env ? env.name : 'Globals')})</label>` : host ? `<p class="muted small"><span class="ms sm ok-t" aria-hidden="true">check_circle</span> ${esc(host)} đã được phép.</p>` : ''}
          ${!browserHdr.length && !secrets.length && !origin ? '<p class="muted small">Không có gì cần đổi.</p>' : ''}
        </fieldset>
        ${used.length ? `<p class="muted small"><span class="ms sm" aria-hidden="true">data_object</span> Request dùng biến ${used.map(v => `<code>{{${esc(v)}}}</code>`).join(', ')}: tool sẽ hỏi giá trị nếu chưa có.</p>` : ''}`;
    };
    const apply = andSend => {
      if (!parsed) return;
      const opt = k => el.querySelector(`[data-opt="${k}"]`)?.checked;
      const r = JSON.parse(JSON.stringify(parsed.request));
      const env = W.activeEnv();
      const notes = [...parsed.warnings];
      const muted = opt('mute') ? ApiCurl.muteBrowserHeaders(r.headers) : [];
      if (muted.length) notes.push(`Đã tắt ${muted.length} header do trình duyệt tự thêm.`);
      const secretVars = [];
      if (opt('secrets')) {
        for (const h of r.headers) {
          if (h.enabled === false || !literalSecret(h.key, h.value)) continue;
          const name = secretVarName(h.key);
          const mm = h.value.match(/^(Bearer|Basic|Token)\s+(.+)$/i);
          App.setVarValue(name, mm ? mm[2] : h.value, W.meta.activeEnvId);
          const list = env ? env.vars : W.meta.globals.vars;
          const v = list.find(x => x.key === name);
          if (v) v.secret = true;
          h.value = mm ? `${mm[1]} {{${name}}}` : `{{${name}}}`;
          secretVars.push(name);
        }
        for (const q of r.query) {
          if (!literalSecret(q.key, q.value)) continue;
          const name = secretVarName(q.key);
          App.setVarValue(name, q.value, W.meta.activeEnvId);
          q.value = `{{${name}}}`;
          secretVars.push(name);
        }
        if (secretVars.length) notes.push(`Đã chuyển ${[...new Set(secretVars)].map(s => `{{${s}}}`).join(', ')} thành biến bí mật.`);
      }
      let url = r.url;
      let origin = '';
      try { if (/^https?:\/\//i.test(url)) origin = new URL(url).origin; } catch {}
      if (opt('allow') && origin) App.allowHost(new URL(origin).host);
      if (opt('base') && origin) {
        const baseName = env?.vars.find(v => /^base_?url$/i.test(v.key))?.key || 'baseUrl';
        App.setVarValue(baseName, origin, W.meta.activeEnvId);
        url = `{{${baseName}}}` + url.slice(origin.length);
        notes.push(`Đã tách base URL thành {{${baseName}}}.`);
      }
      if (env) W.touchEnv(env.id); else W.saveMeta();
      const data = {
        method: r.method, url, query: r.query, headers: r.headers, body: { mode: r.body.mode, text: r.body.text },
        meta: { source: parsed.fromBrowser ? 'browser' : 'postman', format: parsed.format, muted, notes },
      };
      let id;
      if (replaceId) {
        App.W.update(replaceId, data);
        id = replaceId;
      } else {
        const pid = el.querySelector('#pcParent')?.value || null;
        const name = el.querySelector('#pcName')?.value.trim() || `${r.method} ${url}`;
        id = App.W.createRequest(pid, { ...data, name, auth: { type: pid ? 'inherit' : 'none' } }).id;
        if (pid) App.state.expanded.add(pid);
      }
      el.querySelector('#pcText').value = ''; // không giữ lệnh có thể chứa token
      m.close(true);
      App.select(id, { tab: r.body.mode !== 'none' ? 'body' : 'params' });
      App.emit('vars');
      toast(replaceId ? 'Đã cập nhật request từ cURL' : 'Đã tạo request', 'ok', 2500);
      if (andSend) setTimeout(send, 50);
    };
    el.querySelector('#pcText').addEventListener('input', debounce(parse, 200));
    el.querySelector('#pcText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && parsed) { e.preventDefault(); apply(true); } });
    el.querySelector('[data-sample]').addEventListener('click', () => { el.querySelector('#pcText').value = SAMPLE_CURL; parse(); });
    el.querySelectorAll('[data-pc]').forEach(b => b.addEventListener('click', () => apply(b.dataset.pc === 'send')));
    el.querySelector('#pcText').focus();
  };
})();
