const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Khả năng của bộ máy chạy (extension hoặc server) ----------
const ENGINE = window.RedirectEngine.features || {};
if (!ENGINE.clearCookies) $('#clearCookiesRow').remove();
$('#concurrency').max = ENGINE.maxConcurrency || 10;
$('#concHint').textContent = `1–${ENGINE.maxConcurrency || 10}`;
if (ENGINE.runNote) $('#runNote').textContent = ENGINE.runNote;

// Báo cho bộ công cụ (nếu tool đang mở bên trong) biết tool đang chạy hay không
const reportBusy = busy => { try { if (parent !== window) parent.postMessage({ type: 'tool-busy', busy }, '*'); } catch {} };

const state = {
  es: null, running: false, total: 0, params: [], rows: [], byStt: new Map(),
  startedAt: 0, endedAt: 0, filter: 'all', groupFilter: null, valueFilter: null, search: '',
  tab: 'overview', highCard: new Set(),
};
let mobile = '0';

// ---------- Lưu lại lần nhập trước ----------
const FIELDS = ['url', 'repeat', 'concurrency', 'params', 'idle', 'timeout'];
const CHECKS = ['clearCookies'].filter(f => $('#' + f));
try {
  const saved = JSON.parse(localStorage.getItem('redirect-checker') || '{}');
  // Danh sách tham số mặc định cũ → nâng lên danh sách mới
  if (saved.params && saved.params.replace(/\s/g, '').match(/^sub3,affiliate_id(,click_id,utm_content)?$/)) delete saved.params;
  FIELDS.forEach(f => saved[f] != null && ($('#' + f).value = saved[f]));
  if (saved.mobile) setDevice(saved.mobile);
  CHECKS.forEach(f => saved[f] != null && ($('#' + f).checked = saved[f]));
} catch {}
function saveForm() {
  try {
    const o = Object.fromEntries(FIELDS.map(f => [f, $('#' + f).value]));
    o.mobile = mobile;
    CHECKS.forEach(f => (o[f] = $('#' + f).checked));
    localStorage.setItem('redirect-checker', JSON.stringify(o));
  } catch {}
}

function setDevice(v) {
  mobile = v;
  document.querySelectorAll('#device button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === v);
    b.setAttribute('aria-pressed', b.dataset.v === v);
  });
}
$('#device').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !state.running) setDevice(b.dataset.v); });

// ---------- Chạy ----------
$('#form').addEventListener('submit', e => {
  e.preventDefault();
  if (state.running) return;
  const url = $('#url').value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) { $('#url').focus(); return showMsg('Link phải bắt đầu bằng http:// hoặc https://'); }
  const params = $('#params').value.split(',').map(s => s.trim()).filter(Boolean);
  if (!params.length) { $('#params').focus(); return showMsg('Nhập ít nhất một tham số cần tìm.'); }
  showMsg('');
  saveForm();
  start({
    url, params: params.join(','), mobile,
    repeat: $('#repeat').value, concurrency: $('#concurrency').value,
    idle: $('#idle').value, timeout: $('#timeout').value, clearCookies: !!$('#clearCookies')?.checked,
  }, params);
});
$('#btnStop').addEventListener('click', () => finish('stop'));

function showMsg(m) { $('#formMsg').textContent = m; }

function start(query, params) {
  Object.assign(state, {
    running: true, params, rows: [], byStt: new Map(), highCard: new Set(),
    total: Number(query.repeat) || 0, startedAt: Date.now(), endedAt: 0,
    filter: 'all', groupFilter: null, valueFilter: null, search: '',
  });
  $('#search').value = '';
  $('#resTable').querySelectorAll('tbody').forEach(t => t.remove());
  buildHeads();
  setRunning(true);
  $('#introCard').classList.add('hidden');
  $('#runbar').classList.remove('hidden');
  $('#results').classList.remove('hidden');
  showTab('overview');
  setStatus('run', 'Đang mở cửa sổ kiểm tra…');
  render();
  $('#runbar').scrollIntoView({ behavior: 'smooth', block: 'start' });

  state.es = RedirectEngine.run(query, {
    start: d => { state.total = d.total; setStatus('run', 'Đang chạy'); },
    row: r => addRow(r),
    done: () => finish('done'),
    fatal: m => finish('error', m),
  });
}

function finish(kind, message) {
  if (!state.running) return;
  state.es?.close();
  state.running = false;
  state.endedAt = Date.now();
  setRunning(false);
  if (kind === 'done') setStatus('ok', 'Hoàn tất');
  else if (kind === 'stop') setStatus('stop', 'Đã dừng');
  else setStatus('err', message || 'Có lỗi xảy ra');
  render();
}

function setStartLabel(kind) {
  const [icon, text] = { run: ['progress_activity', 'Đang chạy…'], again: ['refresh', 'Chạy lại'], start: ['play_arrow', 'Bắt đầu kiểm tra'] }[kind];
  $('#btnStart').innerHTML = `<span class="ms fill${kind === 'run' ? ' spin' : ''}" aria-hidden="true">${icon}</span><span>${text}</span>`;
}
function setRunning(on) {
  reportBusy(on);
  $('#btnStart').disabled = on;
  setStartLabel(on ? 'run' : state.rows.length ? 'again' : 'start');
  $('#btnStop').classList.toggle('hidden', !on);
  document.querySelectorAll('#form input, #device button').forEach(i => (i.disabled = on));
}
function setStatus(kind, text) {
  $('#dot').className = 's-dot ' + kind;
  $('#statusText').textContent = text;
}

// ---------- Tabs ----------
function showTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
  $('#panel-overview').classList.toggle('hidden', name !== 'overview');
  $('#panel-rows').classList.toggle('hidden', name !== 'rows');
}
document.querySelector('.tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) showTab(t.dataset.tab); });
document.querySelector('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const next = state.tab === 'overview' ? 'rows' : 'overview';
  showTab(next);
  $('#tab-' + next).focus();
});
function goToRows() {
  showTab('rows');
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Dữ liệu ----------
const valText = v => (v && v.length ? v.join(' | ') : null);
const hasParam = (r, p) => !!(r.values[p] && r.values[p].length);
const isFail = r => !!(r.error && !r.hops.length);
// Tham số có quá nhiều giá trị khác nhau (vd Sub_id mỗi lượt 1 giá trị) thì nhóm chỉ xét có/không
const groupVal = (r, p) => (state.highCard.has(p) ? (hasParam(r, p) ? '✓' : null) : valText(r.values[p]));
const groupKey = r => JSON.stringify([...state.params.map(p => groupVal(r, p)), isFail(r) ? 'ERR' : r.chain]);
function updateHighCard() {
  const n = state.rows.length;
  state.highCard = new Set(state.params.filter(p => {
    const vals = new Set();
    state.rows.forEach(r => (r.values[p] || []).forEach(v => vals.add(v)));
    return vals.size > Math.max(5, n * 0.3);
  }));
}
const statusCls = h => (!h.status ? 'sx' : h.status < 300 ? 's2' : h.status < 400 ? 's3' : 'sx');
const hostOfUrl = u => { try { const x = new URL(u); return x.host || x.protocol; } catch { return u; } };
const typeLabel = t => ({ request: 'Mở link', navigated: 'Chuyển trang', js: 'JavaScript', failed: 'Mở app / lỗi', error: 'Lỗi' }[t] || t.replace('popup-', 'Tab mới · '));

// ---------- Giải thích lỗi ----------
// t: tên lỗi dễ hiểu · why: nguyên nhân thường gặp · fix: nên kiểm tra gì
const NET_ERRORS = {
  NAME_NOT_RESOLVED: ['Không tìm thấy tên miền', 'Tên miền không tồn tại, gõ sai, đã hết hạn hoặc DNS chưa cập nhật.', 'Kiểm tra chính tả domain trong link, thử mở bằng tay hoặc tra DNS (nslookup).'],
  NAME_RESOLUTION_FAILED: ['Không tra được DNS', 'Máy chủ DNS của mạng đang dùng không trả lời.', 'Thử lại, đổi mạng hoặc đổi DNS (8.8.8.8 / 1.1.1.1).'],
  CONNECTION_REFUSED: ['Máy chủ từ chối kết nối', 'Tên miền có IP nhưng máy chủ không mở cổng web (server tắt hoặc sai cổng).', 'Báo bên quản lý link / server, kiểm tra cổng 80/443 có chạy không.'],
  CONNECTION_RESET: ['Kết nối bị cắt ngang', 'Máy chủ, tường lửa hoặc nhà mạng ngắt kết nối giữa chừng (thường do chặn bot / chặn theo vùng).', 'Thử lại với ít luồng hơn, đổi mạng/VPN, so với khi mở bằng tay.'],
  CONNECTION_CLOSED: ['Máy chủ đóng kết nối', 'Máy chủ đóng kết nối trước khi gửi trả lời.', 'Thử lại; nếu lặp lại nhiều lượt, máy chủ có thể đang quá tải hoặc chặn.'],
  CONNECTION_TIMED_OUT: ['Hết giờ khi kết nối', 'Máy chủ không phản hồi (quá tải, sập, hoặc tường lửa lặng lẽ chặn).', 'Mở bằng tay xem có chậm không, giảm số luồng chạy cùng lúc.'],
  TIMED_OUT: ['Hết giờ chờ phản hồi', 'Máy chủ nhận kết nối nhưng trả lời quá chậm.', 'Giảm số luồng, tăng thời gian chờ, kiểm tra máy chủ có quá tải không.'],
  CONNECTION_FAILED: ['Không kết nối được', 'Không tạo được kết nối tới máy chủ.', 'Kiểm tra mạng và thử mở link bằng tay.'],
  ADDRESS_UNREACHABLE: ['Không tới được địa chỉ máy chủ', 'IP của máy chủ không truy cập được từ mạng này.', 'Đổi mạng/VPN hoặc báo bên quản lý server.'],
  INTERNET_DISCONNECTED: ['Mất mạng', 'Máy đang chạy tool bị mất kết nối Internet.', 'Kiểm tra mạng rồi chạy lại.'],
  NETWORK_CHANGED: ['Mạng thay đổi giữa chừng', 'Mạng của máy bị đổi (wifi chuyển, VPN bật/tắt) trong lúc mở link.', 'Giữ mạng ổn định rồi chạy lại.'],
  NETWORK_ACCESS_DENIED: ['Bị chặn truy cập mạng', 'Tường lửa / phần mềm diệt virus trên máy chặn Chrome.', 'Kiểm tra tường lửa, phần mềm bảo mật.'],
  EMPTY_RESPONSE: ['Máy chủ không trả dữ liệu', 'Máy chủ kết nối được nhưng trả về rỗng (lỗi server hoặc chặn bot).', 'Thử lại, mở bằng tay để so sánh.'],
  TOO_MANY_REDIRECTS: ['Chuyển hướng vòng lặp', 'Các link chuyển qua lại lẫn nhau không dừng (thường do cấu hình redirect sai hoặc cần cookie).', 'Xem chuỗi link bên dưới để tìm đoạn lặp; thử tắt “Xoá cookie”.'],
  INVALID_REDIRECT: ['Link chuyển hướng không hợp lệ', 'Máy chủ trả về địa chỉ chuyển hướng sai định dạng.', 'Xem header Location của bước trước, báo bên cấu hình link.'],
  UNSAFE_REDIRECT: ['Chuyển hướng không an toàn bị chặn', 'Chrome chặn chuyển hướng sang địa chỉ không được phép.', 'Xem link đích ở bước trước.'],
  UNKNOWN_URL_SCHEME: ['Không hiểu loại link', 'Link dạng app (vd shopeevn://, intent://) mà trình duyệt không mở được.', 'Bình thường với link mở app; kiểm tra trên điện thoại thật nếu cần.'],
  INVALID_URL: ['Link sai định dạng', 'Link có ký tự hoặc cấu trúc không hợp lệ.', 'Kiểm tra lại link (dấu cách, ký tự lạ, mã hoá %).'],
  BLOCKED_BY_CLIENT: ['Bị tiện ích trình duyệt chặn', 'Một tiện ích (chặn quảng cáo, bảo mật…) chặn link này.', 'Tắt tiện ích chặn quảng cáo rồi chạy lại.'],
  BLOCKED_BY_ADMINISTRATOR: ['Bị chính sách quản trị chặn', 'Chrome do công ty quản lý đã chặn địa chỉ này.', 'Liên hệ IT hoặc chạy trên máy khác.'],
  BLOCKED_BY_RESPONSE: ['Trang từ chối hiển thị', 'Máy chủ gửi header bảo mật không cho mở trang theo cách này.', 'Thường không ảnh hưởng chuỗi redirect; xem link trước đó.'],
  BLOCKED_BY_ORB: ['Trình duyệt chặn phản hồi', 'Chrome chặn phản hồi vì nghi ngờ không an toàn.', 'Mở bằng tay để so sánh.'],
  HTTP2_PROTOCOL_ERROR: ['Lỗi giao thức HTTP/2', 'Máy chủ trả dữ liệu sai chuẩn, hoặc proxy/CDN ở giữa bị lỗi.', 'Thử lại; nếu lặp lại hãy báo bên quản lý server.'],
  QUIC_PROTOCOL_ERROR: ['Lỗi giao thức QUIC', 'Kết nối HTTP/3 bị lỗi (thường do mạng chặn UDP).', 'Đổi mạng hoặc tắt QUIC trong chrome://flags.'],
  SSL_PROTOCOL_ERROR: ['Lỗi kết nối bảo mật (SSL)', 'Máy chủ cấu hình HTTPS sai hoặc kết nối bị can thiệp.', 'Thử mở bằng http/https khác, báo bên quản lý server.'],
  SSL_VERSION_OR_CIPHER_MISMATCH: ['SSL không tương thích', 'Máy chủ dùng chuẩn mã hoá quá cũ mà Chrome không còn hỗ trợ.', 'Báo bên quản lý server nâng cấp TLS.'],
  BAD_SSL_CLIENT_AUTH_CERT: ['Máy chủ đòi chứng chỉ máy khách', 'Trang yêu cầu chứng chỉ riêng để truy cập.', 'Link này không dành cho người dùng thường.'],
  CERT_COMMON_NAME_INVALID: ['Chứng chỉ SSL sai tên miền', 'Chứng chỉ HTTPS không khớp với tên miền đang mở.', 'Báo bên quản lý domain cập nhật chứng chỉ.'],
  CERT_DATE_INVALID: ['Chứng chỉ SSL hết hạn', 'Chứng chỉ HTTPS đã hết hạn (hoặc giờ trên máy sai).', 'Kiểm tra đồng hồ máy; nếu đúng giờ thì báo gia hạn chứng chỉ.'],
  CERT_AUTHORITY_INVALID: ['Chứng chỉ SSL không đáng tin', 'Chứng chỉ tự ký hoặc không do tổ chức uy tín cấp.', 'Báo bên quản lý domain dùng chứng chỉ hợp lệ.'],
  CERT_: ['Chứng chỉ SSL có vấn đề', 'Chứng chỉ HTTPS của trang không hợp lệ.', 'Mở bằng tay để xem cảnh báo chi tiết của Chrome.'],
  PROXY_CONNECTION_FAILED: ['Không kết nối được proxy', 'Máy đang cài proxy nhưng proxy không hoạt động.', 'Kiểm tra cài đặt proxy / VPN.'],
  TUNNEL_CONNECTION_FAILED: ['Proxy không mở được kết nối', 'Proxy / VPN không cho đi tới máy chủ đích.', 'Kiểm tra proxy / VPN.'],
  CONTENT_DECODING_FAILED: ['Không giải nén được nội dung', 'Máy chủ gửi dữ liệu nén bị hỏng.', 'Báo bên quản lý server.'],
  RESPONSE_HEADERS_TOO_BIG: ['Header trả về quá lớn', 'Thường do cookie tích luỹ quá nhiều.', 'Bật “Xoá cookie” rồi chạy lại.'],
  FILE_NOT_FOUND: ['Không tìm thấy tệp', 'Link trỏ tới tệp không tồn tại.', 'Kiểm tra lại link.'],
  INSECURE_RESPONSE: ['Phản hồi không an toàn', 'Chrome từ chối phản hồi vì vấn đề bảo mật.', 'Mở bằng tay để xem cảnh báo.'],
  ABORTED: ['Tải trang bị huỷ', 'Trang bị huỷ giữa chừng (thường do trang khác thay thế, hoặc là tệp tải về).', 'Thường không phải lỗi thật nếu sau đó vẫn có link tiếp theo.'],
};
const HTTP_ERRORS = {
  400: ['Yêu cầu không hợp lệ (400)', 'Link thiếu hoặc sai tham số mà máy chủ cần.', 'So link với link mẫu đúng, kiểm tra tham số bị mã hoá sai.'],
  401: ['Cần đăng nhập (401)', 'Trang yêu cầu xác thực.', 'Link này cần tài khoản; kiểm tra lại quyền truy cập.'],
  403: ['Bị từ chối truy cập (403)', 'Máy chủ chặn: theo IP/quốc gia, chặn bot, hoặc link đã bị khoá.', 'Thử mở bằng tay, đổi mạng/VPN, giảm số luồng chạy.'],
  404: ['Không tìm thấy trang (404)', 'Đường dẫn không tồn tại: link sai, đã bị xoá hoặc chiến dịch đã kết thúc.', 'Kiểm tra lại đường dẫn của link ở bước này.'],
  405: ['Phương thức không được phép (405)', 'Máy chủ không chấp nhận kiểu truy cập này.', 'Báo bên quản lý link.'],
  408: ['Máy chủ hết giờ chờ (408)', 'Máy chủ chờ yêu cầu quá lâu.', 'Thử lại.'],
  410: ['Trang đã bị gỡ (410)', 'Link đã bị xoá vĩnh viễn (thường là chiến dịch đã đóng).', 'Lấy link mới từ bên cung cấp.'],
  429: ['Quá nhiều yêu cầu (429)', 'Máy chủ giới hạn tốc độ vì tool mở link quá nhanh / quá nhiều.', 'Giảm số luồng chạy cùng lúc và số lượt.'],
  451: ['Bị chặn vì lý do pháp lý (451)', 'Nội dung bị chặn tại khu vực của bạn.', 'Thử từ mạng/quốc gia khác.'],
  500: ['Lỗi máy chủ (500)', 'Máy chủ gặp lỗi nội bộ khi xử lý link.', 'Lỗi phía server; báo bên quản lý link kèm thời điểm lỗi.'],
  502: ['Cổng trung gian lỗi (502)', 'Proxy/CDN không nhận được phản hồi hợp lệ từ máy chủ gốc.', 'Thường tạm thời; thử lại sau, nếu kéo dài thì báo server.'],
  503: ['Máy chủ tạm ngưng (503)', 'Máy chủ quá tải hoặc đang bảo trì.', 'Thử lại sau, giảm số luồng chạy.'],
  504: ['Cổng trung gian hết giờ (504)', 'Máy chủ gốc trả lời quá chậm.', 'Thử lại sau; nếu kéo dài thì báo server.'],
  520: ['Cloudflare: lỗi không xác định (520)', 'Máy chủ gốc trả phản hồi lạ cho Cloudflare.', 'Báo bên quản lý server.'],
  521: ['Cloudflare: máy chủ gốc tắt (521)', 'Cloudflare không kết nối được tới máy chủ gốc.', 'Báo bên quản lý server.'],
  522: ['Cloudflare: kết nối hết giờ (522)', 'Máy chủ gốc không phản hồi Cloudflare kịp.', 'Báo bên quản lý server.'],
  523: ['Cloudflare: không tới được máy chủ gốc (523)', 'Đường đi tới máy chủ gốc bị lỗi.', 'Báo bên quản lý server.'],
  524: ['Cloudflare: máy chủ xử lý quá lâu (524)', 'Máy chủ gốc xử lý quá 100 giây.', 'Báo bên quản lý server.'],
  525: ['Cloudflare: lỗi SSL với máy chủ gốc (525)', 'Cloudflare không bắt tay SSL được với máy chủ gốc.', 'Báo bên quản lý server.'],
  526: ['Cloudflare: chứng chỉ máy chủ gốc sai (526)', 'Chứng chỉ SSL của máy chủ gốc không hợp lệ.', 'Báo bên quản lý server.'],
};
const mk = (code, [t, why, fix]) => ({ code, t, why, fix });

// Đọc chuỗi lỗi gốc (net::ERR_…, lỗi Playwright, lỗi tool) → lời giải thích
function explainError(raw) {
  const s = String(raw || '');
  const net = s.match(/(?:net::)?ERR_([A-Z0-9_]+)/);
  if (net) {
    const key = Object.keys(NET_ERRORS).find(k => net[1] === k) || (net[1].startsWith('CERT_') ? 'CERT_' : null);
    return key ? mk('ERR_' + net[1], NET_ERRORS[key]) : { code: 'ERR_' + net[1], t: 'Lỗi mạng ' + net[1].toLowerCase().replace(/_/g, ' '), why: 'Chrome báo lỗi khi tải link này.', fix: 'Tra mã lỗi bên cạnh hoặc mở link bằng tay để xem Chrome hiển thị gì.' };
  }
  const to = s.match(/Timeout (\d+)ms exceeded/i);
  if (to) return { code: 'TIMEOUT', t: `Quá ${Math.round(to[1] / 1000)} giây chưa tải xong`, why: 'Trang tải quá chậm hoặc cứ chuyển hướng mãi không dừng.', fix: 'Tăng “Thời gian chờ tối đa” hoặc giảm số luồng chạy cùng lúc.' };
  if (/Chuyển sang app/.test(s)) return { code: 'APP', t: 'Chuyển sang app', why: 'Link cuối là link mở ứng dụng (deep link), trình duyệt không đi tiếp được.', fix: 'Thường là bình thường. Muốn xem trong app thì thử trên điện thoại thật.' };
  if (/bị chặn|chính sách bảo mật/i.test(s)) return { code: 'BLOCKED', t: 'Bị chặn bởi chính sách của tool', why: s, fix: 'Link trỏ tới địa chỉ nội bộ/không được phép.' };
  if (/Quá \d+ lần redirect/.test(s)) return mk('TOO_MANY_REDIRECTS', NET_ERRORS.TOO_MANY_REDIRECTS);
  if (/Không ghi nhận được link nào/.test(s)) return { code: 'NO_HOPS', t: 'Không ghi nhận được link nào', why: 'Tab kiểm tra không bắt đầu tải link (tab bị đóng sớm, link bị chặn ngay từ đầu).', fix: 'Thử mở link bằng tay; kiểm tra tiện ích chặn quảng cáo.' };
  return { code: null, t: s || 'Lỗi không rõ', why: '', fix: '' };
}
function explainHttp(status) {
  // Mã đã hiện riêng cạnh tên lỗi nên bỏ "(404)" trong tên cho khỏi lặp
  if (HTTP_ERRORS[status]) { const [t, why, fix] = HTTP_ERRORS[status]; return { code: 'HTTP ' + status, t: t.replace(/ \(\d{3}\)$/, ''), why, fix }; }
  return status >= 500
    ? { code: 'HTTP ' + status, t: 'Lỗi máy chủ', why: 'Máy chủ gặp lỗi khi xử lý link.', fix: 'Lỗi phía server; báo bên quản lý link kèm thời điểm lỗi.' }
    : { code: 'HTTP ' + status, t: 'Lỗi yêu cầu', why: 'Máy chủ từ chối link này.', fix: 'Kiểm tra lại link ở bước này.' };
}

// Mọi vấn đề của 1 lượt. level: err (lỗi thật) · warn (đáng chú ý) · info (thông tin)
function rowIssues(r) {
  if (r._issues) return r._issues;
  const out = [];
  if (r.error) out.push({ level: 'err', step: null, ...explainError(r.error), raw: r.error });
  r.hops.forEach((h, i) => {
    const last = i === r.hops.length - 1;
    if (h.error) {
      const e = explainError(h.error);
      out.push({ level: e.code === 'APP' ? 'info' : e.code === 'ERR_ABORTED' && !last ? 'info' : 'err', step: h.step, host: hostOfUrl(h.url), ...e, raw: h.error });
    } else if (h.status >= 400) {
      // Lỗi ở link cuối là lỗi thật; ở giữa chuỗi mà vẫn đi tiếp được thì chỉ cảnh báo
      out.push({ level: last ? 'err' : 'warn', step: h.step, host: hostOfUrl(h.url), ...explainHttp(h.status), raw: h.statusLine || null });
    }
  });
  if (r.timedOut) {
    out.push({ level: 'warn', step: null, code: 'TIMEOUT', raw: null,
      t: `Hết ${Math.round(r.timedOut.ms / 1000)} giây chờ${r.timedOut.loading ? ', trang vẫn đang tải' : ', vẫn còn chuyển hướng'}`,
      why: 'Tool dừng lượt này khi chưa chắc đã tới link cuối cùng. Các tham số có thể chưa đầy đủ.',
      fix: 'Tăng “Thời gian chờ tối đa” hoặc giảm số luồng chạy cùng lúc.' });
  }
  return (r._issues = out);
}
const hasErr = r => rowIssues(r).some(i => i.level === 'err');
const hasWarn = r => rowIssues(r).some(i => i.level === 'warn');
const hopIssue = (r, h) => rowIssues(r).find(i => i.step === h.step);
const issueWhere = i => (i.step ? `Link thứ ${i.step}${i.host ? ' · ' + i.host : ''}` : 'Cả lượt');
const ISSUE_ICON = { err: 'error', warn: 'warning', info: 'info' };
function issueBox(i) {
  return `<div class="issue-box ${i.level}">
    <div class="ib-h"><span class="ms sm fill" aria-hidden="true">${ISSUE_ICON[i.level]}</span><b>${esc(i.t)}</b>${i.code ? ` <code>${esc(i.code)}</code>` : ''}</div>
    <div class="ib-w">${esc(issueWhere(i))}</div>
    ${i.why ? `<div><span class="ib-k">Nguyên nhân thường gặp:</span> ${esc(i.why)}</div>` : ''}
    ${i.fix ? `<div><span class="ib-k">Nên kiểm tra:</span> ${esc(i.fix)}</div>` : ''}
    ${i.raw && i.raw !== i.t ? `<div class="ib-raw">Thông báo gốc: ${esc(i.raw)}</div>` : ''}
  </div>`;
}
const issueText = i => `[${issueWhere(i)}] ${i.t}${i.code ? ` (${i.code})` : ''}${i.why ? ' - ' + i.why : ''}${i.fix ? ' Nên kiểm tra: ' + i.fix : ''}`;

function addRow(r) {
  state.rows.push(r);
  state.byStt.set(r.stt, r);
  insertRowEl(r);
  if (state.rows.length === 1) $('#btnCsv').disabled = false;
  scheduleRender();
}

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

// ---------- Bảng kết quả ----------
function buildHeads() {
  $('#resHead').innerHTML = `<tr><th>STT</th>${state.params.map(p => `<th>${esc(p)}</th>`).join('')}<th>Đường đi · tham số ở link nào</th></tr>`;
  $('#groupHead').innerHTML = `<tr>${state.params.map(p => `<th>${esc(p)}</th>`).join('')}<th>Đường đi</th><th>Số lượt</th><th style="min-width:150px">Tỉ lệ</th></tr>`;
}

// URL rút gọn: domain in đậm + phần còn lại
function urlShort(u) {
  try {
    const x = new URL(u);
    if (!x.host) return esc(u);
    return `<b>${esc(x.host)}</b>${esc(x.pathname + x.search + x.hash)}`;
  } catch { return esc(u); }
}

// Điểm nhấn: đường đi vẽ như một tuyến, tham số gắn tại link chứa nó
function routeHtml(r) {
  if (isFail(r)) {
    const e = rowIssues(r)[0];
    return `<div class="route-err"><span class="ms sm" aria-hidden="true">error</span> Không mở được link: <b>${esc(e.t)}</b>${e.code ? ` <code>${esc(e.code)}</code>` : ''}${e.why ? `<div class="re-why">${esc(e.why)}</div>` : ''}<div class="re-more">Bấm vào dòng để xem cách kiểm tra</div></div>`;
  }
  const issues = rowIssues(r).filter(i => i.level !== 'info')
    .map(i => `<div class="issue-line ${i.level}"><span class="ms sm" aria-hidden="true">${ISSUE_ICON[i.level]}</span>${i.step ? `Link ${i.step}: ` : ''}<b>${esc(i.t)}</b>${i.code ? ` <code>${esc(i.code)}</code>` : ''}</div>`).join('');
  const missing = state.params.filter(p => !r.found[p].length);
  const miss = missing.length
    ? `<div class="missing"><span class="ms sm" aria-hidden="true">warning</span>Thiếu ${missing.map(p => `<button type="button" class="miss-chip" data-proof="${esc(p)}">${esc(p)}</button>`).join('')}</div>`
    : '';
  const stops = r.hops.map((h, i) => {
    const chips = state.params.filter(p => h.params && h.params[p] != null)
      .map(p => `<button type="button" class="pchip" data-proof="${esc(p)}">${esc(p)}</button>`).join('');
    return `<li class="stop ${chips ? 'has' : ''} ${i === r.hops.length - 1 ? 'end' : ''}">
      <span class="node"></span>
      <span class="st ${statusCls(h)}">${h.status ?? (h.error ? 'LỖI' : '—')}</span>
      <span class="u" data-hop="${h.step}">${urlShort(h.url)}</span>
      <span class="pchips">${chips}</span>
    </li>`;
  }).join('');
  return `${issues}${miss}<ol class="route">${stops || '<li class="muted">Không ghi nhận được link nào.</li>'}</ol>`;
}

function insertRowEl(r) {
  const tb = document.createElement('tbody');
  tb.dataset.stt = r.stt;
  tb.innerHTML = `<tr class="main">
    <td class="stt"><span class="ms sm caret" aria-hidden="true">chevron_right</span>${r.stt}</td>
    ${state.params.map(p => { const v = valText(r.values[p]); return `<td class="val">${v ? `<span class="clamp" data-proof="${esc(p)}">${esc(v)}</span>` : `<span class="none" data-proof="${esc(p)}">—</span>`}</td>`; }).join('')}
    <td class="route-cell">${routeHtml(r)}</td>
  </tr>`;
  tb.querySelector('tr.main').addEventListener('click', e => { if (!e.target.closest('[data-proof]')) toggleDetail(tb, r); });
  r._el = tb;
  // Chèn đúng thứ tự STT (các lượt chạy song song có thể xong lệch thứ tự)
  const table = $('#resTable');
  let before = null;
  for (let el = table.lastElementChild; el && el.tagName === 'TBODY'; el = el.previousElementSibling) {
    if (Number(el.dataset.stt) > r.stt) before = el; else break;
  }
  table.insertBefore(tb, before);
  applyFilter(r);
}

function highlightUrl(url, only) {
  const ranges = [];
  for (const p of only ? [only] : state.params) {
    const re = new RegExp(`([?&#;]${escRe(p)}=)([^&#]*)`, 'gi');
    let m;
    while ((m = re.exec(url))) ranges.push([m.index + 1, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [s, e] of ranges) {
    if (s < pos) continue;
    out += esc(url.slice(pos, s)) + '<mark>' + esc(url.slice(s, e)) + '</mark>';
    pos = e;
  }
  return out + esc(url.slice(pos));
}

// Tô param trong URL; nếu param nằm trong link lồng đã mã hoá (%3D…) thì giải mã rồi tô
function proofUrlHtml(url, p) {
  const re = new RegExp(`[?&#;]${escRe(p)}=`, 'i');
  if (re.test(url)) return { html: highlightUrl(url, p), decoded: false };
  let d = url;
  for (let i = 0; i < 3 && !re.test(d); i++) { try { d = decodeURIComponent(d); } catch { break; } }
  return re.test(d) ? { html: highlightUrl(d, p), decoded: true } : { html: esc(url), decoded: false };
}

function proofFor(r, p) {
  const steps = new Set(r.found[p].map(f => f.step));
  return { found: r.hops.filter(h => steps.has(h.step)), value: valText(r.values[p]) };
}

// ---------- Tooltip ----------
const tip = document.createElement('div');
tip.id = 'tip';
tip.className = 'hidden';
tip.setAttribute('role', 'tooltip');
document.body.appendChild(tip);
const rowOf = el => state.byStt.get(Number(el.closest('tbody')?.dataset.stt));

function placeTip(el) {
  tip.classList.remove('hidden');
  const b = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  let top = b.bottom + 8;
  if (top + t.height > innerHeight - 8) top = b.top - t.height - 8;
  tip.style.top = Math.max(8, top) + 'px';
  tip.style.left = Math.max(8, Math.min(b.left, innerWidth - t.width - 12)) + 'px';
}

$('#resTable').addEventListener('mouseover', e => {
  const el = e.target.closest('[data-proof], [data-hop]');
  if (!el) return;
  const r = rowOf(el);
  if (!r) return;
  if (el.dataset.hop) {
    const h = r.hops.find(x => x.step === Number(el.dataset.hop));
    if (!h) return;
    tip.innerHTML = `<div class="t-h">Link thứ ${h.step} / ${r.hops.length} · ${h.status ?? typeLabel(h.type)}</div>
      <div class="t-u">${highlightUrl(h.url)}</div>
      ${h.location ? `<div class="t-f"><span class="ms sm" aria-hidden="true">subdirectory_arrow_right</span> chuyển tiếp đến: ${esc(h.location)}</div>` : ''}
      ${(i => (i ? `<div class="t-e ${i.level}"><b>${esc(i.t)}</b>${i.code ? ` · ${esc(i.code)}` : ''}${i.why ? `<br>${esc(i.why)}` : ''}</div>` : ''))(hopIssue(r, h))}`;
    return placeTip(el);
  }
  const p = el.dataset.proof;
  const { found, value } = proofFor(r, p);
  if (found.length) {
    const h = found[0], u = proofUrlHtml(h.url, p);
    tip.innerHTML = `<div class="t-h">${esc(p)} = ${esc(value)} · link thứ ${h.step} (${h.status ?? h.type})</div>
      <div class="t-u">${u.html}</div>
      <div class="t-f">${found.length > 1 ? `+ ${found.length - 1} link khác cũng chứa ${esc(p)} · ` : ''}Bấm để mở bằng chứng</div>`;
  } else {
    tip.innerHTML = `<div class="t-h">Không có ${esc(p)} trong cả ${r.hops.length} link đã đi qua:</div>
      <ol>${r.hops.map(h => `<li>[${h.status ?? h.type}] ${esc(h.url)}</li>`).join('')}</ol>
      <div class="t-f">Bấm để mở bằng chứng</div>`;
  }
  placeTip(el);
});
$('#resTable').addEventListener('mouseout', e => { if (e.target.closest('[data-proof], [data-hop]')) tip.classList.add('hidden'); });
addEventListener('scroll', () => tip.classList.add('hidden'), true);

$('#resTable').addEventListener('click', e => {
  const el = e.target.closest('[data-proof]');
  if (!el) return;
  tip.classList.add('hidden');
  const r = rowOf(el);
  if (r) openProof(r, el.dataset.proof, el);
});

// ---------- Modal bằng chứng ----------
function openProof(r, p, opener) {
  const { found, value } = proofFor(r, p);
  const list = found.length ? found : r.hops;
  const items = list.map(h => {
    const u = found.length ? proofUrlHtml(h.url, p) : { html: highlightUrl(h.url), decoded: false };
    return `<div class="proof-item ${found.length ? 'found' : ''}">
      <div class="proof-top">
        <span><b>Link thứ ${h.step}</b> / ${r.hops.length} · ${esc(hostOfUrl(h.url))} · <span class="mono">${h.status ?? (h.error ? 'LỖI' : '—')}</span> · ${esc(typeLabel(h.type))}</span>
        <span class="proof-actions">
          <button class="btn btn-sm" type="button" data-copy="${esc(h.url)}"><span class="ms sm" aria-hidden="true">content_copy</span><span>Sao chép link</span></button>
          <a class="btn btn-sm" href="${esc(h.url)}" target="_blank" rel="noopener noreferrer"><span class="ms sm" aria-hidden="true">open_in_new</span>Mở</a>
        </span>
      </div>
      <div class="proof-url">${u.html}</div>
      ${u.decoded ? `<div class="proof-note">${esc(p)} nằm trong một link lồng đã mã hoá, bên trên là link sau khi giải mã.</div>` : ''}
      ${h.location ? `<div class="proof-note"><span class="ms sm" aria-hidden="true">subdirectory_arrow_right</span> máy chủ chuyển tiếp đến: ${esc(h.location)}</div>` : ''}
      ${(i => (i ? `<div class="proof-note">${issueBox(i)}</div>` : ''))(hopIssue(r, h))}
    </div>`;
  }).join('');

  const verdict = found.length
    ? `<div class="verdict ok"><span class="ms fill" aria-hidden="true">check_circle</span><span>Tìm thấy <b>${esc(p)} = ${esc(value)}</b> ở link thứ ${found.map(h => h.step).join(', ')} (trên tổng ${r.hops.length} link đã đi qua).</span></div>`
    : `<div class="verdict miss"><span class="ms fill" aria-hidden="true">cancel</span><span>Đã kiểm tra cả <b>${r.hops.length} link</b> của lượt này, không link nào chứa <b>${esc(p)}</b>.</span></div>`;

  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <div class="modal-h">
      <div>
        <h3 id="mTitle">Bằng chứng <code>${esc(p)}</code> · lượt #${r.stt}</h3>
        <div class="muted">Bắt đầu lúc ${new Date(r.startedAt).toLocaleString('vi-VN')} · ${esc(r.chain)}</div>
      </div>
      <button class="x" type="button" aria-label="Đóng"><span class="ms" aria-hidden="true">close</span></button>
    </div>
    <div class="modal-b">
      ${verdict}
      ${items || '<span class="muted">Không ghi nhận được link nào.</span>'}
      <div class="warn-open">Nút “Mở” sẽ truy cập link thật và có thể được tính là 1 lượt click.</div>
    </div>
  </div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); opener?.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', async e => {
    if (e.target === bg || e.target.closest('.x')) return close();
    const c = e.target.closest('[data-copy]');
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); c.lastElementChild.textContent = 'Đã sao chép'; c.firstElementChild.textContent = 'check'; }
      catch { c.lastElementChild.textContent = 'Không sao chép được'; }
      setTimeout(() => { c.lastElementChild.textContent = 'Sao chép link'; c.firstElementChild.textContent = 'content_copy'; }, 1500);
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  bg.querySelector('.x').focus();
}

// ---------- Chi tiết (link đầy đủ) ----------
// Thông tin mạng của 1 link: lúc nào, IP máy chủ, dòng trạng thái gốc
function hopMeta(h) {
  const bits = [];
  if (h.at != null) bits.push(`sau ${(h.at / 1000).toFixed(1)} giây`);
  if (h.ip) bits.push(`IP máy chủ ${esc(h.ip)}`);
  if (h.statusLine) bits.push(esc(h.statusLine));
  return bits.length ? `<div class="loc">${bits.join(' · ')}</div>` : '';
}
function toggleDetail(tb, r) {
  const open = tb.classList.toggle('open');
  if (!open) return tb.querySelector('tr.detail')?.remove();
  const hops = r.hops.map(h => `<div class="hop">
      <div class="n">Link ${h.step}<br><span style="font-size:11.5px">${esc(typeLabel(h.type))}</span></div>
      <div class="badge ${statusCls(h)}">${h.status ?? (h.error ? 'LỖI' : '—')}</div>
      <div>
        <div class="u">${highlightUrl(h.url)}</div>
        ${h.location ? `<div class="loc"><span class="ms sm" aria-hidden="true">subdirectory_arrow_right</span> máy chủ chuyển tiếp đến: ${esc(h.location)}</div>` : ''}
        ${hopMeta(h)}
        ${(i => (i ? issueBox(i) : ''))(hopIssue(r, h))}
      </div>
    </div>`).join('');
  const meta = `Bắt đầu lúc ${new Date(r.startedAt).toLocaleTimeString('vi-VN')} · mất ${(r.durationMs / 1000).toFixed(1)} giây · ${r.hops.length} link · phần tô vàng là tham số`;
  const rowLevel = rowIssues(r).filter(i => !i.step).map(issueBox).join('');
  const tr = document.createElement('tr');
  tr.className = 'detail';
  tr.innerHTML = `<td colspan="${state.params.length + 2}"><div class="detail-meta">${meta}</div>${rowLevel}${hops || (rowLevel ? '' : '<span class="muted">Không ghi nhận được link nào.</span>')}</td>`;
  tb.appendChild(tr);
}

// ---------- Lọc ----------
function matches(r) {
  if (state.groupFilter && groupKey(r) !== state.groupFilter) return false;
  if (state.valueFilter) {
    const { p, v } = state.valueFilter;
    if (v === null ? hasParam(r, p) : !(r.values[p] || []).includes(v)) return false;
  }
  if (state.filter === 'err' && !hasErr(r)) return false;
  if (state.filter === 'warn' && !hasWarn(r)) return false;
  if (state.filter.startsWith('has:') && !hasParam(r, state.filter.slice(4))) return false;
  if (state.filter.startsWith('miss:') && hasParam(r, state.filter.slice(5))) return false;
  if (state.search) {
    const hay = (state.params.map(p => valText(r.values[p])).join(' ') + ' ' + r.chain + ' ' + r.hops.map(h => h.url).join(' ') + ' ' + rowIssues(r).map(i => `${i.t} ${i.code}`).join(' ')).toLowerCase();
    if (!hay.includes(state.search)) return false;
  }
  return true;
}
function applyFilter(r) { r._el.classList.toggle('hidden', !matches(r)); }
function applyAllFilters() { updateHighCard(); state.rows.forEach(applyFilter); render(); }

$('#search').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); applyAllFilters(); });
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  state.filter = b.dataset.f;
  state.groupFilter = null;
  state.valueFilter = null;
  applyAllFilters();
});
$('#groupBody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-key]');
  if (!tr) return;
  state.groupFilter = tr.dataset.key;
  state.valueFilter = null;
  state.filter = 'all';
  applyAllFilters();
  goToRows();
});
$('#dist').addEventListener('click', e => {
  const row = e.target.closest('.dist-row[data-p]');
  if (!row) return;
  state.valueFilter = { p: row.dataset.p, v: row.dataset.none === '1' ? null : row.dataset.v };
  state.groupFilter = null;
  state.filter = 'all';
  applyAllFilters();
  goToRows();
});

// ---------- Vẽ ----------
const fmtTime = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} giây` : `${Math.floor(s / 60)} phút ${s % 60} giây`; };
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

function render() {
  updateHighCard();
  const done = state.rows.length;
  const total = state.total || 0;
  $('#barFill').style.width = `${pct(done, total)}%`;
  $('#countBig').innerHTML = `${done} <small>/ ${total} lượt</small>`;
  $('#tabRowsCount').textContent = done;

  const elapsed = (state.endedAt || Date.now()) - state.startedAt;
  let time = fmtTime(elapsed);
  if (state.running && done > 0 && total > done) time += ` · còn khoảng ${fmtTime((elapsed / done) * (total - done))}`;
  $('#timeText').textContent = time;


  renderKpis(done);
  renderInsights(done);
  renderDist(done);
  renderGroups(done);
  renderFilters();

  const visible = state.rows.filter(r => !r._el.classList.contains('hidden')).length;
  $('#countText').textContent = done ? `Đang hiện ${visible}/${done} lượt` : '';
  $('#emptyMsg').classList.toggle('hidden', visible > 0);
  $('#emptyMsg').textContent = done ? 'Không có lượt nào khớp bộ lọc. Bấm “Tất cả” để xem lại toàn bộ.' : 'Đang chờ kết quả lượt đầu tiên…';
}

function renderKpis(done) {
  const errors = state.rows.filter(hasErr).length;
  $('#kpis').innerHTML = state.params.map(p => {
    const n = state.rows.filter(r => hasParam(r, p)).length;
    const pc = pct(n, done);
    return `<div class="kpi ${pc < 100 ? 'low' : ''}">
      <div class="k">${esc(p)}</div>
      <div class="v">${pc}%</div>
      <div class="d">có ở ${n}/${done} lượt</div>
      <div class="meter"><div style="width:${pc}%"></div></div>
    </div>`;
  }).join('') + (errors ? `<div class="kpi err"><div class="k">lỗi</div><div class="v">${errors}</div><div class="d">lượt gặp lỗi · xem “Nhận xét” để biết lỗi gì</div></div>` : '');
}

// Mỗi tham số: từng giá trị xuất hiện bao nhiêu lượt, chiếm bao nhiêu %
const DIST_MAX_ROWS = 300; // tham số có quá nhiều giá trị (vd utm_content) → chỉ vẽ 300 dòng đầu cho nhẹ
function renderDist(done) {
  // Giữ vị trí cuộn của từng ô khi vẽ lại (trang vẽ lại liên tục trong lúc chạy)
  const scrolls = {};
  document.querySelectorAll('#dist .dist-body').forEach(el => (scrolls[el.dataset.p] = el.scrollTop));
  $('#dist').innerHTML = state.params.map(p => {
    const counts = new Map();
    let none = 0;
    for (const r of state.rows) {
      if (isFail(r)) continue;
      const vals = r.values[p];
      if (vals && vals.length) vals.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
      else none++;
    }
    const all = [...counts.entries()];
    if (none) all.push([null, none]);
    all.sort((a, b) => b[1] - a[1]);
    const rows = all.slice(0, DIST_MAX_ROWS);
    const hidden = all.slice(DIST_MAX_ROWS);
    const isActive = v => state.valueFilter && state.valueFilter.p === p && state.valueFilter.v === v;
    const more = hidden.length
      ? `<div class="dist-more">… và ${hidden.length} giá trị khác (${hidden.reduce((s, x) => s + x[1], 0)} lượt). Dùng ô tìm kiếm ở tab Từng lượt để tra.</div>`
      : '';
    return `<div class="dist-panel">
      <h3>${esc(p)} <span>${counts.size} giá trị</span></h3>
      <div class="dist-body" data-p="${esc(p)}">
      ${rows.map(([v, n]) => { const pc = done ? (100 * n / done) : 0; return `
        <button type="button" class="dist-row ${v === null ? 'none' : ''} ${isActive(v) ? 'active' : ''}" data-p="${esc(p)}" data-v="${v === null ? '' : esc(v)}" data-none="${v === null ? 1 : 0}" title="${v === null ? 'Không có' : esc(v)}">
          <span class="v">${v === null ? 'không có' : esc(v)}</span>
          <span class="c">${n}</span>
          <span class="pct"><span class="track"><span style="width:${pc}%"></span></span><span>${pc.toFixed(pc && pc < 10 ? 1 : 0)}%</span></span>
        </button>`; }).join('') || '<div class="dist-more">Chưa có dữ liệu.</div>'}
      ${more}
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('#dist .dist-body').forEach(el => { if (scrolls[el.dataset.p]) el.scrollTop = scrolls[el.dataset.p]; });
}

function renderGroups(done) {
  const map = new Map();
  for (const r of state.rows) {
    const k = groupKey(r);
    const g = map.get(k) || { key: k, sample: r, stts: [] };
    g.stts.push(r.stt);
    map.set(k, g);
  }
  const groups = [...map.values()].sort((a, b) => b.stts.length - a.stts.length);
  $('#groupBody').innerHTML = groups.map(g => {
    const r = g.sample;
    const p = pct(g.stts.length, done);
    return `<tr data-key="${esc(g.key)}" class="${state.groupFilter === g.key ? 'active' : ''}" tabindex="0">
      ${state.params.map(pp => {
        if (state.highCard.has(pp)) return `<td class="val">${hasParam(r, pp) ? '<span style="color:var(--ok)"><span class="ms sm" aria-hidden="true">check</span> có</span> <span class="none">· mỗi lượt 1 giá trị</span>' : '<span class="none">không có</span>'}</td>`;
        const v = valText(r.values[pp]);
        return `<td class="val">${v ? `<span class="clamp" title="${esc(v)}">${esc(v)}</span>` : '<span class="none">không có</span>'}</td>`;
      }).join('')}
      <td class="path-cell">${isFail(r) ? 'Lỗi' : esc(r.chain)}</td>
      <td class="num"><b>${g.stts.length}</b></td>
      <td class="num"><div class="pct"><div class="track"><div style="width:${p}%"></div></div><span>${p}%</span></div></td>
    </tr>`;
  }).join('');
}
$('#groupBody').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('tr')?.click(); });

// Tự rút ra quy luật: khi thiếu param X thì param Y luôn có giá trị gì
function renderInsights(done) {
  const out = [];
  if (!done) { $('#insights').innerHTML = '<li>Đang chờ các lượt đầu tiên…</li>'; return; }
  const ran = state.rows.filter(r => r.hops.length);
  const codes = ps => ps.map(p => `<code>${esc(p)}</code>`).join(', ');
  // Tóm tắt lỗi: cùng loại lỗi ở cùng tên miền gộp lại, kèm nguyên nhân + cách kiểm tra
  const errMap = new Map();
  for (const r of state.rows) {
    for (const i of rowIssues(r)) {
      if (i.level === 'info') continue;
      const k = [i.level, i.code, i.t, i.host || ''].join('|');
      const g = errMap.get(k) || { i, stts: new Set() };
      g.stts.add(r.stt);
      errMap.set(k, g);
    }
  }
  [...errMap.values()].sort((a, b) => (a.i.level === b.i.level ? b.stts.size - a.stts.size : a.i.level === 'err' ? -1 : 1)).slice(0, 6).forEach(({ i, stts }) => {
    const list = [...stts].sort((a, b) => a - b);
    out.push([i.level === 'err' ? 'err' : 'strong', `<b>${stts.size}/${done}</b> lượt ${i.level === 'err' ? 'lỗi' : 'cảnh báo'}: <b>${esc(i.t)}</b>${i.code ? ` <code>${esc(i.code)}</code>` : ''}${i.host ? ` tại <code>${esc(i.host)}</code>` : ''}.`
      + (i.why ? `<br>Nguyên nhân thường gặp: ${esc(i.why)}` : '') + (i.fix ? `<br>Nên kiểm tra: ${esc(i.fix)}` : '')
      + `<br><span class="muted">Lượt #${list.slice(0, 12).join(', #')}${list.length > 12 ? ` … (+${list.length - 12})` : ''}</span>`]);
  });
  // Gom các tham số luôn có/thiếu cùng lúc (vd sub3 và sub4) để nói 1 lần
  const bySig = new Map();
  for (const p of state.params) {
    const sig = ran.map(r => (hasParam(r, p) ? 1 : 0)).join('');
    bySig.set(sig, [...(bySig.get(sig) || []), p]);
  }
  const full = [];
  for (const ps of bySig.values()) {
    const miss = ran.filter(r => !hasParam(r, ps[0]));
    const has = ran.filter(r => hasParam(r, ps[0]));
    if (!miss.length) { full.push(...ps); continue; }
    if (!has.length) { out.push(['', `Không lượt nào có ${codes(ps)} (đã kiểm tra ${done} lượt).`]); continue; }
    const together = ps.length > 1 ? ` ${codes(ps)} luôn xuất hiện cùng nhau.` : '';
    // Tìm tham số khác (có giá trị) phân biệt rõ 2 nhóm lượt
    let explained = false;
    for (const q of state.params) {
      if (ps.includes(q) || state.highCard.has(q)) continue;
      const missVals = new Set(miss.map(r => valText(r.values[q])));
      const hasVals = new Set(has.map(r => valText(r.values[q])));
      const v = [...missVals][0];
      if (missVals.size === 1 && v != null && !hasVals.has(v)) {
        out.push(['strong', `<b>${miss.length}</b> lượt thiếu ${codes(ps)} đều có <code>${esc(q)} = ${esc(v)}</code>. Các lượt có ${codes(ps)} thì ${esc(q)} = <code>${[...hasVals].map(x => esc(x ?? 'trống')).join(', ')}</code>.${together} Link đang chia lượt theo ${esc(q)}, và chỉ ${esc(q)} đó mới gắn ${codes(ps)}.`]);
        explained = true;
        break;
      }
    }
    if (!explained) out.push(['', `<b>${miss.length}/${done}</b> lượt thiếu ${codes(ps)}.${together} Xem bảng “Các nhóm kết quả” để so đường đi.`]);
  }
  // Kiểm tra có luân phiên đều theo STT không (so theo có/thiếu tham số)
  const sig = r => state.params.map(p => hasParam(r, p)).join();
  const sorted = [...state.rows].filter(r => r.hops.length).sort((a, b) => a.stt - b.stt);
  if (sorted.length >= 6 && new Set(sorted.map(sig)).size === 2) {
    let alt = 0;
    for (let i = 1; i < sorted.length; i++) if (sig(sorted[i - 1]) !== sig(sorted[i])) alt++;
    const rate = alt / (sorted.length - 1);
    if (rate > 0.8) out.push(['strong', `Kết quả <b>luân phiên xen kẽ</b> theo thứ tự lượt mở (${Math.round(rate * 100)}% lượt liền nhau khác nhóm). Máy chủ đang chia lượt kiểu xoay vòng, không phải ngẫu nhiên.`]);
  }
  if (full.length) out.push(['', `Luôn có ở mọi lượt: ${full.map(p => `<code>${esc(p)}</code>`).join(', ')}.`]);
  $('#insights').innerHTML = out.map(([cls, x]) => `<li class="${cls}">${x}</li>`).join('');
}

function renderFilters() {
  const done = state.rows.length;
  const chip = (f, t, on) => `<button type="button" class="chip ${on ? 'on' : ''}" data-f="${esc(f)}">${t}</button>`;
  const active = state.groupFilter || state.valueFilter ? '' : state.filter;
  let html = chip('all', `Tất cả ${done}`, active === 'all');
  for (const p of state.params) {
    const n = state.rows.filter(r => hasParam(r, p)).length;
    if (n === done || n === 0) continue; // chỉ hiện bộ lọc cho tham số lúc có lúc không
    html += `<span class="chip-sep"></span>` + chip(`has:${p}`, `Có ${esc(p)} ${n}`, active === `has:${p}`) + chip(`miss:${p}`, `Thiếu ${esc(p)} ${done - n}`, active === `miss:${p}`);
  }
  const errs = state.rows.filter(hasErr).length;
  const warns = state.rows.filter(hasWarn).length;
  if (errs || warns) html += `<span class="chip-sep"></span>`;
  if (errs) html += chip('err', `Lỗi ${errs}`, active === 'err');
  if (warns) html += chip('warn', `Cảnh báo ${warns}`, active === 'warn');
  if (state.groupFilter) html += `<span class="chip-sep"></span><button type="button" class="chip on clear" data-f="all">Đang xem 1 nhóm <span class="ms sm" aria-hidden="true">close</span></button>`;
  if (state.valueFilter) html += `<span class="chip-sep"></span><button type="button" class="chip on clear" data-f="all">${esc(state.valueFilter.p)} = ${esc(state.valueFilter.v ?? 'không có')} <span class="ms sm" aria-hidden="true">close</span></button>`;
  $('#filters').innerHTML = html;
}

// ---------- Xuất CSV ----------
$('#btnCsv').addEventListener('click', () => {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['STT', ...state.params, ...state.params.map(p => `Link chứa ${p}`), 'Bằng chứng', 'Đường đi', 'Bắt đầu lúc', 'Tất cả link', 'Lỗi'];
  const lines = [head.map(q).join(',')];
  for (const r of [...state.rows].sort((a, b) => a.stt - b.stt)) {
    const ev = state.params.map(p => {
      const f = r.found[p];
      return f.length ? `Có ${p} ở link thứ ${[...new Set(f.map(x => x.step))].join(', ')} (${[...new Set(f.map(x => x.host))].join(', ')})` : `Không có ${p} trong cả ${r.hops.length} link`;
    }).join('; ');
    lines.push([r.stt, ...state.params.map(p => valText(r.values[p]) ?? ''),
      ...state.params.map(p => { const f = proofFor(r, p).found; return f.length ? f.map(h => `Link ${h.step}: ${h.url}`).join('\n') : `KHÔNG CÓ ${p} - đã kiểm tra ${r.hops.length} link:\n` + r.hops.map(h => `Link ${h.step}: ${h.url}`).join('\n'); }),
      ev, r.chain, r.startedAt, r.hops.map(h => `Link ${h.step} [${h.status ?? h.type}]${h.ip ? ` (IP ${h.ip})` : ''} ${h.url}`).join('\n'),
      rowIssues(r).map(issueText).join('\n')].map(q).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ket-qua-redirect-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

setInterval(() => state.running && render(), 1000);
