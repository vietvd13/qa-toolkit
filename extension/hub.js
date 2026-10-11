// Khung bộ công cụ: điều hướng giữa các tool (#/<id>), mỗi tool chạy trong iframe riêng
// và được giữ lại khi chuyển sang tool khác (đang chạy dở không bị mất).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toolFrames = new Map(); // id -> iframe
const busy = new Set();

try { $('#ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}

// ---------- Vẽ danh sách ----------
function renderNav() {
  $('#navTools').innerHTML = TOOLS.map(t => `
    <a class="nav-item" href="#/${esc(t.id)}" data-id="${esc(t.id)}" title="${esc(t.name)}">
      <span class="ms" aria-hidden="true">${esc(t.icon)}</span>
      <span class="nav-label">${esc(t.name)}</span>
      ${busy.has(t.id) ? '<span class="busy-dot" title="Đang chạy"></span>' : ''}
    </a>`).join('');
  $('#toolGrid').innerHTML = TOOLS.map(t => `
    <a class="tool-card" href="#/${esc(t.id)}">
      <div class="tc-top">
        <span class="tc-icon"><span class="ms" aria-hidden="true">${esc(t.icon)}</span></span>
        <span class="ms tc-go" aria-hidden="true">arrow_forward</span>
      </div>
      <h2>${esc(t.name)}</h2>
      <p>${esc(t.desc)}</p>
      ${busy.has(t.id) ? '<span class="tc-busy"><span class="busy-dot" style="margin:0"></span>Đang chạy</span>' : ''}
      <div class="tc-tags">${(t.tags || []).map(x => `<span>${esc(x)}</span>`).join('')}</div>
    </a>`).join('');
  markCurrent();
}

function markCurrent() {
  const id = currentId();
  document.querySelectorAll('.side .nav-item[data-id]').forEach(a => {
    if (a.dataset.id === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// ---------- Điều hướng ----------
const currentId = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));

function show() {
  const id = currentId();
  const tool = TOOLS.find(t => t.id === id);
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
  try { localStorage.setItem('hub-last', id); } catch {}
  markCurrent();
  if (tool) toolFrames.get(id).focus();
}
addEventListener('hashchange', show);

// ---------- Tool báo đang chạy ----------
addEventListener('message', e => {
  if (e.data?.type !== 'tool-busy') return;
  for (const [id, f] of toolFrames) {
    if (f.contentWindow !== e.source) continue;
    if (e.data.busy) busy.add(id); else busy.delete(id);
    renderNav();
  }
});
// Đóng tab bộ công cụ khi còn tool đang chạy → hỏi lại
addEventListener('beforeunload', e => { if (busy.size) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Thu gọn thanh bên ----------
const setCollapsed = on => {
  $('#hub').classList.toggle('collapsed', on);
  $('#btnCollapse').setAttribute('aria-label', on ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên');
  $('#btnCollapse .nav-label').textContent = on ? 'Mở rộng' : 'Thu gọn';
  try { localStorage.setItem('hub-collapsed', on ? '1' : ''); } catch {}
};
$('#btnCollapse').addEventListener('click', () => setCollapsed(!$('#hub').classList.contains('collapsed')));
try { if (localStorage.getItem('hub-collapsed')) setCollapsed(true); } catch {}

// ---------- Cài đặt giao diện ----------

function swatchesHtml(kind) {
  const cur = Theme.norm(Theme.get()[kind]);
  const presets = Theme.PRESETS[kind];
  const inPreset = presets.some(p => (p.hex || null) === cur);
  const name = cur ? (presets.find(p => p.hex === cur)?.name || 'Màu tự chọn') : presets[0].name;
  const tick = hex => (Theme.contrast('#FFFFFF', hex) >= 3 ? '#FFFFFF' : '#29242D');
  return presets.map(p => {
    const c = p.hex || p.swatch;
    const on = (p.hex || null) === cur;
    return `<button type="button" class="sw" role="radio" aria-checked="${on}" data-kind="${kind}" data-hex="${p.hex || ''}"
      style="--c:${c};color:${tick(c)}" title="${esc(p.name)}" aria-label="${esc(p.name)}"><span class="ms sm" aria-hidden="true">check</span></button>`;
  }).join('') + `
    <label class="sw sw-custom" title="Tự chọn màu" aria-checked="${!!cur && !inPreset}">
      <input type="color" data-kind="${kind}" value="${cur || presets[0].swatch}" aria-label="Tự chọn màu">
      <span class="ms sm" aria-hidden="true">colorize</span>
    </label>
    <input class="hex" type="text" data-kind="${kind}" maxlength="7" spellcheck="false" value="${cur || presets[0].swatch}" aria-label="Mã màu (dạng #RRGGBB)">
    <span class="sw-name">${esc(name)}</span>`;
}

// Vẽ lại toàn bộ ô màu (chỉ khi mở bảng hoặc khôi phục mặc định)
function renderTheme() {
  $('#swPrimary').innerHTML = swatchesHtml('primary');
  $('#swSecondary').innerHTML = swatchesHtml('secondary');
  renderThemeStatus();
}

// Cập nhật trạng thái mà không thay ô nhập (không làm đóng bảng chọn màu đang mở)
function renderThemeStatus() {
  const prefs = Theme.get();
  document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === prefs.mode));
  for (const kind of ['primary', 'secondary']) {
    const cur = Theme.norm(prefs[kind]);
    const presets = Theme.PRESETS[kind];
    const preset = presets.find(p => (p.hex || null) === cur);
    const box = $(kind === 'primary' ? '#swPrimary' : '#swSecondary');
    box.querySelectorAll('button.sw').forEach(b => b.setAttribute('aria-checked', (b.dataset.hex || null) === cur));
    box.querySelector('.sw-custom').setAttribute('aria-checked', !!cur && !preset);
    const shown = cur || presets[0].swatch;
    const color = box.querySelector('input[type=color]'), hex = box.querySelector('.hex');
    if (document.activeElement !== color) color.value = shown.toLowerCase();
    if (document.activeElement !== hex) { hex.value = shown; hex.removeAttribute('aria-invalid'); }
    box.querySelector('.sw-name').textContent = preset ? preset.name : 'Màu tự chọn';
  }
  const cell = r => `<td class="r">${r >= 4.5
    ? `<span class="ok"><span class="ms sm" aria-hidden="true">check_circle</span> ${r.toFixed(2)}:1 đạt</span>`
    : `<span class="bad"><span class="ms sm" aria-hidden="true">error</span> ${r.toFixed(2)}:1 chưa đạt</span>`}</td>`;
  $('#contrastBody').innerHTML = Theme.report(prefs).map(x => `<tr><td>${esc(x.label)}</td>${cell(x.light)}${cell(x.dark)}</tr>`).join('');
  const adj = Theme.adjusted(prefs);
  $('#adjNote').innerHTML = adj.length
    ? 'Màu bạn chọn hơi nhạt nên chữ và nút dùng sắc đậm hơn cho dễ đọc: ' + adj.map(x => `${x.kind === 'primary' ? 'màu chủ đạo' : 'màu phụ'} <code>${x.from}</code> → <code>${x.to}</code>`).join(', ') + '.'
    : '';
}

function setColor(kind, hex) {
  Theme.set({ [kind]: hex || null });
  renderThemeStatus();
}

let themeOpener = null;
function openTheme() {
  themeOpener = document.activeElement;
  renderTheme();
  $('#themeDlg').classList.remove('hidden');
  $('#themeDlg [aria-checked=true]')?.focus();
}
function closeTheme() {
  $('#themeDlg').classList.add('hidden');
  themeOpener?.focus();
}
$('#btnTheme').addEventListener('click', openTheme);
$('#themeDlg').addEventListener('click', e => {
  if (e.target === $('#themeDlg') || e.target.closest('[data-close]')) return closeTheme();
  const mode = e.target.closest('#modeSeg button');
  if (mode) { Theme.set({ mode: mode.dataset.mode }); return renderThemeStatus(); }
  const sw = e.target.closest('button.sw');
  if (sw) setColor(sw.dataset.kind, sw.dataset.hex);
});
$('#themeDlg').addEventListener('input', e => {
  const t = e.target;
  if (t.type === 'color') setColor(t.dataset.kind, t.value);
  if (t.classList.contains('hex')) {
    const ok = Theme.norm(t.value);
    t.setAttribute('aria-invalid', !ok && t.value.length >= 6);
    if (ok) setColor(t.dataset.kind, ok);
  }
});
$('#btnThemeReset').addEventListener('click', () => { Theme.reset(); renderTheme(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#themeDlg').classList.contains('hidden')) closeTheme(); });
addEventListener('storage', e => { if (e.key === 'bcc-theme' && !$('#themeDlg').classList.contains('hidden')) renderThemeStatus(); });

// ---------- Khởi động: mở lại tool dùng lần trước ----------
renderNav();
if (!location.hash) {
  let last = '';
  try { last = localStorage.getItem('hub-last') || ''; } catch {}
  if (TOOLS.length === 1 && !last) last = TOOLS[0].id; // mới có 1 tool thì vào thẳng
  if (TOOLS.some(t => t.id === last)) history.replaceState(null, '', '#/' + last);
}
show();
