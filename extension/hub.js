// Khung bộ công cụ: điều hướng giữa các tool (#/<id>), mỗi tool chạy trong iframe riêng
// và được giữ lại khi chuyển sang tool khác (đang chạy dở không bị mất).
// Dùng chung cho Chrome extension và bản web (npm run ui).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toolFrames = new Map(); // id -> iframe
const busy = new Set();
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// Đang chạy trong extension hay bản web? Chỉ hiện tool chạy được ở nền tảng hiện tại.
const PLATFORM = globalThis.chrome?.runtime?.id ? 'extension' : 'web';
const tools = TOOLS.filter(t => !t.platforms || t.platforms.includes(PLATFORM));

const versionP = PLATFORM === 'extension'
  ? Promise.resolve(chrome.runtime.getManifest().version)
  : fetch('manifest.json').then(r => r.json()).then(m => m.version);
versionP.then(v => {
  $('#ver').textContent = PLATFORM === 'extension' ? 'v' + v : `v${v} · bản web`;
  $('#homeEyebrow').textContent = `Bộ công cụ QA · v${v}`;
}).catch(() => {});

// ---------- Tìm kiếm & lọc theo nhóm ----------
const filter = { q: '', cat: '' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const matches = t => {
  if (filter.cat && t.category !== filter.cat) return false;
  if (!filter.q) return true;
  const hay = norm([t.name, t.desc, t.category, ...(t.tags || [])].join(' '));
  return norm(filter.q).split(/\s+/).every(w => hay.includes(w));
};

// ---------- Vẽ ----------
function renderNav() {
  $('#navCount').textContent = tools.length;
  // Mỗi tool là một "kênh" CH01, CH02… theo thứ tự trong registry
  $('#navTools').innerHTML = tools.map((t, i) => `
    <a class="nav-item" href="#/${esc(t.id)}" data-id="${esc(t.id)}" title="${esc(t.name)}">
      <span class="ms" aria-hidden="true">${esc(t.icon)}</span>
      <span class="nav-label">${esc(t.name)}</span>
      ${busy.has(t.id) ? '<span class="busy-dot" role="img" aria-label="Đang chạy"></span>' : `<span class="ch" aria-hidden="true">CH${String(i + 1).padStart(2, '0')}</span>`}
    </a>`).join('');
  markCurrent();
}

// enter: thẻ hiện dần lần lượt — chỉ khi mở trang / đổi nhóm, không lặp lại mỗi lần gõ tìm kiếm
function renderHome(enter = false) {
  const cats = [...new Set(tools.map(t => t.category).filter(Boolean))];
  const n = c => tools.filter(t => !c || t.category === c).length;
  $('#lead').textContent = `Có ${tools.length} công cụ hỗ trợ test, dùng ngay không cần đăng nhập. Mỗi công cụ chạy riêng: đang chạy dở một cái vẫn mở được cái khác, quay lại kết quả vẫn còn.`;
  $('#cats').innerHTML = ['', ...cats].map(c => `
    <button type="button" class="cat" data-cat="${esc(c)}" aria-pressed="${filter.cat === c}">${c ? esc(c) : 'Tất cả'} <span class="n">${n(c)}</span></button>`).join('');
  const list = tools.filter(matches);
  $('#toolGrid').classList.toggle('enter', enter);
  $('#toolGrid').innerHTML = list.map((t, i) => `
    <a class="tool-card" href="#/${esc(t.id)}" style="--i:${i}">
      <div class="tc-top">
        <span class="tc-icon"><span class="ms" aria-hidden="true">${esc(t.icon)}</span></span>
        <div>
          ${t.category ? `<div class="tc-cat">${esc(t.category)}</div>` : ''}
          <h2>${esc(t.name)}</h2>
        </div>
        <span class="ms tc-go" aria-hidden="true">arrow_forward</span>
      </div>
      <p>${esc(t.desc)}</p>
      <div class="tc-foot">
        ${(t.tags || []).map(x => `<span class="tc-tag">${esc(x)}</span>`).join('')}
        ${busy.has(t.id) ? '<span class="tc-busy"><span class="busy-dot" aria-hidden="true"></span>Đang chạy</span>' : ''}
      </div>
    </a>`).join('');
  $('#noTools').classList.toggle('hidden', list.length > 0);
  $('#noToolsQ').textContent = filter.q || filter.cat;
}

function markCurrent() {
  const id = currentId();
  document.querySelectorAll('.rail .nav-item[data-id]').forEach(a => {
    if (a.dataset.id === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// ---------- Điều hướng ----------
const currentId = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));

function show() {
  const id = currentId();
  const tool = tools.find(t => t.id === id);
  $('#home').classList.toggle('hidden', !!tool);
  toolFrames.forEach((f, fid) => f.classList.toggle('hidden', fid !== id));
  if (tool && !toolFrames.has(id)) {
    const f = document.createElement('iframe');
    f.src = tool.path;
    f.title = tool.name;
    toolFrames.set(id, f);
    $('#frames').appendChild(f);
  }
  document.title = tool ? `${tool.name} · Bộ công cụ` : 'Bộ công cụ';
  store.set('hub-last', id);
  markCurrent();
  if (tool) toolFrames.get(id).focus();
}
addEventListener('hashchange', show);

$('#q').addEventListener('input', e => {
  filter.q = e.target.value.trim();
  if (currentId()) location.hash = '#/'; // đang mở tool → về danh mục để xem kết quả tìm
  renderHome();
});
$('#q').addEventListener('keydown', e => {
  if (e.key === 'Enter') { const first = tools.find(matches); if (first) { location.hash = '#/' + first.id; e.target.blur(); } }
  if (e.key === 'Escape') { e.target.value = ''; filter.q = ''; renderHome(); e.target.blur(); }
});
$('#cats').addEventListener('click', e => {
  const b = e.target.closest('.cat');
  if (b) { filter.cat = b.dataset.cat; renderHome(true); }
});
$('#btnClearSearch').addEventListener('click', () => { $('#q').value = ''; filter.q = ''; filter.cat = ''; renderHome(); $('#q').focus(); });
// Ctrl/⌘ K, "/" hoặc nút tìm trên rail để tìm công cụ
const focusSearch = () => {
  if (currentId()) { history.pushState(null, '', '#/'); show(); }
  $('#q').focus(); $('#q').select();
};
addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); focusSearch(); }
});
$('#btnFind').addEventListener('click', focusSearch);
if (/Mac|iPhone|iPad/.test(navigator.platform)) {
  document.querySelectorAll('.kbd, .rail-kbd').forEach(k => { k.textContent = '⌘ K'; });
  $('#btnFind').title = 'Tìm công cụ (⌘ K)';
}

// ---------- Tool báo đang chạy ----------
addEventListener('message', e => {
  if (e.data?.type !== 'tool-busy') return;
  for (const [id, f] of toolFrames) {
    if (f.contentWindow !== e.source) continue;
    if (e.data.busy) busy.add(id); else busy.delete(id);
    renderNav();
    renderHome();
  }
});
// Đóng tab khi còn tool đang chạy → hỏi lại
addEventListener('beforeunload', e => { if (busy.size) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Thanh bên: thu gọn ----------
// Tool cần nhiều chỗ (registry: wide: true) → thanh bên tự thu thành dải icon khi mở tool đó, không ghi đè lựa chọn đã lưu.
// Bấm mở rộng khi đang ở tool đó thì giữ mở cho tới khi tải lại trang.
let wideOpened = false;
const isWide = () => !!tools.find(t => t.id === currentId())?.wide;
const paintCollapsed = () => {
  const on = isWide() ? !wideOpened : !!store.get('hub-collapsed');
  $('#hub').classList.toggle('collapsed', on);
  $('#btnCollapse').setAttribute('aria-expanded', !on);
  $('#btnCollapse').setAttribute('aria-label', on ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên');
};
const setCollapsed = on => {
  if (isWide()) wideOpened = !on; // ở tool rộng: chỉ nhớ trong phiên
  else store.set('hub-collapsed', on ? '1' : '');
  paintCollapsed();
};
$('#btnCollapse').addEventListener('click', () => setCollapsed(!$('#hub').classList.contains('collapsed')));
addEventListener('hashchange', paintCollapsed);
paintCollapsed();

// ---------- Chế độ màu: chỉ Sáng / Tối, bấm để đổi ----------
function renderModeBtn() {
  const dark = Theme.get().mode === 'dark';
  $('#btnMode .ms').textContent = dark ? 'light_mode' : 'dark_mode';
  $('#btnMode').setAttribute('aria-label', dark ? 'Đang dùng giao diện tối. Bấm để chuyển sang sáng' : 'Đang dùng giao diện sáng. Bấm để chuyển sang tối');
  $('#btnMode').title = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
}
$('#btnMode').addEventListener('click', () => { Theme.toggle(); renderModeBtn(); });
addEventListener('storage', e => { if (e.key === 'bcc-theme') renderModeBtn(); });

// ---------- Cập nhật phiên bản (GitHub Releases) ----------
// Tự kiểm tra tối đa 6 giờ/lần (GitHub giới hạn 60 lượt/giờ cho mỗi IP), bấm "Kiểm tra cập nhật" để kiểm tra ngay.
const REPO = 'vietvd13/qa-toolkit'; // đổi cùng link trong hub.html, manifest.json, package.json
const RELEASES = `https://github.com/${REPO}/releases`;
const UPDATE_EVERY = 6 * 3600e3;
const upd = { current: '', latest: null, state: 'idle' }; // state: idle | loading | ok | error

const newer = (a, b) => { // a > b theo semver (x.y.z)
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
const hasUpdate = () => !!(upd.current && upd.latest && newer(upd.latest.version, upd.current));

// Ghi chú phát hành (Markdown đơn giản: tiêu đề, gạch đầu dòng, **đậm**, `mã`, [link](url))
function mdLite(md) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[(.+?)\]\((.+?)\)/g, '$1');
  let html = '', list = false;
  for (const line of String(md || '').split(/\r?\n/)) {
    const li = line.match(/^\s*[-*] (.*)/), h = line.match(/^#{1,4} (.*)/);
    if (!li && list) { html += '</ul>'; list = false; }
    if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; }
    else if (h) html += `<h4>${inline(h[1])}</h4>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}

function renderUpdate() {
  const on = hasUpdate();
  $('#btnUpdate').classList.toggle('hidden', !on);
  if (on) {
    $('#updPillText').textContent = `Bản mới v${upd.latest.version}`;
    $('#btnUpdate').setAttribute('aria-label', `Có bản mới v${upd.latest.version}, bấm để xem cách cập nhật`);
    $('#btnUpdate').title = `Có bản mới v${upd.latest.version}`;
  }
  if ($('#updDlg').classList.contains('hidden')) return;

  const L = upd.latest, cur = upd.current ? `v${upd.current}` : '';
  $('#updSub').textContent = on ? `${cur} → v${L.version}` + (L.date ? ` · phát hành ${new Date(L.date).toLocaleDateString('vi-VN')}` : '') : `Đang dùng ${cur}`;
  const btnCheck = `<button class="btn btn-ghost btn-sm" type="button" data-act="check"><span class="ms sm" aria-hidden="true">refresh</span>Kiểm tra lại</button>`;

  if (upd.state === 'loading' && !L) {
    $('#updBody').innerHTML = `<p class="muted"><span class="ms sm spin" aria-hidden="true">progress_activity</span> Đang kiểm tra bản mới…</p>`;
  } else if (upd.state === 'error' && !L) {
    $('#updBody').innerHTML = `
      <div class="verdict miss"><span class="ms sm" aria-hidden="true">cloud_off</span><span>Không kiểm tra được lúc này (mất mạng hoặc GitHub tạm giới hạn). Thử lại sau, hoặc xem trực tiếp trên GitHub.</span></div>
      <div class="upd-actions">${btnCheck}<a class="btn btn-sm" href="${RELEASES}" target="_blank" rel="noopener">Mở trang Releases</a></div>`;
  } else if (!on) {
    $('#updBody').innerHTML = `
      <div class="verdict ok"><span class="ms sm" aria-hidden="true">check_circle</span><span>Bạn đang dùng bản mới nhất${cur ? ` (${cur})` : ''}.</span></div>
      <div class="upd-actions">${btnCheck}<a class="btn btn-ghost btn-sm" href="${RELEASES}" target="_blank" rel="noopener">Xem các bản đã phát hành</a></div>`;
  } else {
    const steps = PLATFORM === 'extension' ? `
      <ol class="upd-steps">
        <li><strong>Tải file .zip</strong> bản mới bằng nút bên dưới.</li>
        <li><strong>Giải nén đè</strong> vào đúng thư mục extension đang dùng (chọn <em>Replace</em> khi được hỏi). Giữ nguyên thư mục cũ để không mất cài đặt.</li>
        <li>Bấm <strong>Tải lại extension</strong>. Tab này sẽ đóng, bấm icon extension để mở lại.</li>
      </ol>
      <div class="upd-actions">
        ${L.zip ? `<a class="btn btn-primary btn-sm" href="${esc(L.zip)}"><span class="ms sm" aria-hidden="true">download</span>Tải v${esc(L.version)} (.zip)</a>` : ''}
        <button class="btn btn-sm" type="button" data-act="reload"><span class="ms sm" aria-hidden="true">restart_alt</span>Tải lại extension</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="ext-page">Mở trang tiện ích</button>
      </div>` : `
      <ol class="upd-steps">
        <li>Trong thư mục dự án, chạy <code>git pull</code> rồi <code>npm install</code>.</li>
        <li>Tắt và chạy lại <code>npm run ui</code>, sau đó tải lại trang này.</li>
      </ol>`;
    $('#updBody').innerHTML = `
      ${L.notes ? `<div class="upd-notes">${mdLite(L.notes)}</div>` : ''}
      <h4 class="upd-h">Cách cập nhật</h4>
      ${steps}
      <p class="muted upd-foot"><a href="${esc(L.url)}" target="_blank" rel="noopener">Xem bản phát hành trên GitHub</a></p>`;
  }
}

async function checkUpdate(force) {
  let cached = null;
  try { cached = JSON.parse(store.get('hub-update') || 'null'); } catch {}
  if (cached?.latest) upd.latest = cached.latest;
  if (!force && cached && Date.now() - cached.at < UPDATE_EVERY) return renderUpdate();
  upd.state = 'loading'; renderUpdate();
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    upd.latest = {
      version: String(j.tag_name || '').replace(/^v/, ''),
      date: j.published_at,
      url: j.html_url || RELEASES,
      zip: (j.assets || []).find(a => /\.zip$/i.test(a.name))?.browser_download_url || '',
      notes: String(j.body || '').slice(0, 4000),
    };
    upd.state = 'ok';
    store.set('hub-update', JSON.stringify({ at: Date.now(), latest: upd.latest }));
  } catch {
    upd.state = 'error';
  }
  renderUpdate();
}

let updOpener = null;
function openUpdate() {
  updOpener = document.activeElement;
  $('#updDlg').classList.remove('hidden');
  renderUpdate();
  $('#updDlg .x').focus();
}
function closeUpdate() {
  $('#updDlg').classList.add('hidden');
  updOpener?.focus();
}
$('#btnUpdate').addEventListener('click', openUpdate);
$('#btnCheckUpdate').addEventListener('click', () => { openUpdate(); checkUpdate(true); });
$('#updDlg').addEventListener('click', e => {
  if (e.target === $('#updDlg') || e.target.closest('[data-close]')) return closeUpdate();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'check') checkUpdate(true);
  if (act === 'reload') chrome.runtime.reload();
  if (act === 'ext-page') chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#updDlg').classList.contains('hidden')) closeUpdate(); });

// ---------- Khởi động: mở lại tool dùng lần trước ----------
renderNav();
renderHome(true);
renderModeBtn();
versionP.then(v => { upd.current = v; checkUpdate(); }).catch(() => {});
if (!location.hash) {
  let last = store.get('hub-last') || '';
  if (tools.length === 1 && !last) last = tools[0].id; // mới có 1 tool thì vào thẳng
  if (tools.some(t => t.id === last)) history.replaceState(null, '', '#/' + last);
}
show();
