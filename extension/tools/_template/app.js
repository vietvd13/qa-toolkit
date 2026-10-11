// Tool mẫu: chép cả thư mục _template thành tools/<id>/, sửa nội dung,
// rồi thêm 1 dòng vào tools/registry.js. Có thể dùng chrome.* API (tabs, cookies…)
// nếu manifest.json đã khai báo quyền tương ứng.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Báo cho bộ công cụ biết tool đang bận (hiện chấm xanh ở thanh bên)
const reportBusy = busy => { try { if (parent !== window) parent.postMessage({ type: 'tool-busy', busy }, '*'); } catch {} };

$('#form').addEventListener('submit', e => {
  e.preventDefault();
  reportBusy(true);
  const lines = $('#input').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  $('#out').innerHTML = lines.map((v, i) => `<tr><td>${i + 1}</td><td>${esc(v)}</td></tr>`).join('');
  $('#empty').classList.toggle('hidden', lines.length > 0);
  reportBusy(false);
});
