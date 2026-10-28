// Chế độ màu dùng chung: Sáng hoặc Tối. Màu lấy cố định từ hệ thiết kế (shared/theme.css), không cho tự chọn màu.
// Nạp trong <head> SAU theme.css ở mọi trang (hub + từng tool) để không bị nháy màu khi mở.
// Lưu ở localStorage → mọi trang của extension (cùng origin) dùng chung và cập nhật ngay qua sự kiện "storage".
// Chưa chọn lần nào thì theo giao diện của máy; bấm đổi là ghi cố định sáng / tối.
(() => {
  const KEY = 'bcc-theme';
  const MODES = ['light', 'dark'];

  const system = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  function get() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}').mode; } catch {}
    return { mode: MODES.includes(saved) ? saved : system() };
  }
  function save(prefs) {
    try { localStorage.setItem(KEY, JSON.stringify({ mode: prefs.mode })); } catch {}
  }

  function apply(prefs = get()) {
    const root = document.documentElement;
    // Tắt hiệu ứng chuyển màu trong lúc đổi giao diện để mọi màu đổi cùng lúc (không bị nền cũ + chữ mới)
    root.classList.add('theme-switching');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    root.dataset.theme = prefs.mode;
    document.getElementById('bcc-custom-theme')?.remove(); // màu tự chọn của bản cũ
  }

  function set(mode) {
    const prefs = { mode: MODES.includes(mode) ? mode : system() };
    save(prefs);
    apply(prefs);
    return prefs;
  }
  const toggle = () => set(get().mode === 'dark' ? 'light' : 'dark');

  apply();
  addEventListener('storage', e => { if (e.key === KEY) apply(); }); // trang/tool khác vừa đổi → cập nhật ngay

  window.Theme = { get, set, toggle, apply };
})();
