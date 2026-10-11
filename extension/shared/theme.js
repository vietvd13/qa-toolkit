// Cài đặt giao diện dùng chung: chế độ sáng/tối/theo hệ thống + màu chủ đạo/màu phụ tự chọn.
// Nạp trong <head> SAU theme.css ở mọi trang (hub + từng tool) để không bị nháy màu khi mở.
// Lưu ở localStorage → mọi trang của extension (cùng origin) dùng chung và cập nhật ngay
// qua sự kiện "storage". Ưu tiên: người dùng chọn > theo hệ thống > sáng.
(() => {
  const KEY = 'bcc-theme';
  const DEFAULTS = { mode: 'system', primary: null, secondary: null };
  const LIGHT = { bg: '#FFFFFF', surface: '#F8F6F8' };
  const DARK = { bg: '#171419', elevated: '#2B2630' };

  const PRESETS = {
    primary: [
      { name: 'Hồng hoa (mặc định)', hex: null, swatch: '#C6537B' },
      { name: 'Đỏ mận', hex: '#A63D5A' },
      { name: 'Cam đào', hex: '#C8643B' },
      { name: 'Tím oải hương', hex: '#8E5BB5' },
      { name: 'Xanh biển', hex: '#3559A8' },
      { name: 'Xanh ngọc', hex: '#0A7C86' },
      { name: 'Xanh lá', hex: '#2F7D57' },
    ],
    secondary: [
      { name: 'Tím mauve (mặc định)', hex: null, swatch: '#79638F' },
      { name: 'Xám ấm', hex: '#716975' },
      { name: 'Xanh xám', hex: '#5B7083' },
      { name: 'Nâu be', hex: '#8A6F5A' },
      { name: 'Xanh rêu', hex: '#5F7A5B' },
    ],
  };

  // ---------- Màu ----------
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const toRgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, c => c + c); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const toHex = rgb => '#' + rgb.map(v => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const mix = (a, b, t) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); }; // t = phần của b
  const lum = h => { const c = toRgb(h).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const isHex = h => typeof h === 'string' && /^#?[0-9a-f]{6}$/i.test(h.trim());
  const norm = h => (isHex(h) ? '#' + h.trim().replace('#', '').toUpperCase() : null);
  const toHsl = hex => {
    const [r, g, b] = toRgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const fromHsl = (h, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return toHex([r, g, b].map(v => (v + m) * 255));
  };
  // Đổi độ sáng (giữ nguyên sắc màu & độ đậm) cho tới khi đạt tương phản với mọi nền trong `bgs`.
  // toward '#000000' = tối dần, '#FFFFFF' = sáng dần.
  const ensure = (hex, bgs, ratio, toward) => {
    if (bgs.every(bg => contrast(hex, bg) >= ratio)) return toHex(toRgb(hex));
    const [h, s, l0] = toHsl(hex);
    const dir = toward === '#000000' ? -1 : 1;
    let c = hex;
    for (let l = l0; l >= 0 && l <= 1; l += dir * 0.01) {
      c = fromHsl(h, s, l);
      if (bgs.every(bg => contrast(c, bg) >= ratio)) return c;
    }
    return c;
  };

  // Từ 1 màu → đủ bộ sắc độ cho sáng & tối, đảm bảo chữ đạt 4.5:1
  function deriveBrand(hex, kind) {
    const L = {}, D = {};
    if (kind === 'primary') {
      L.primary = ensure(hex, [LIGHT.bg], 3, '#000000');                 // đồ hoạ (thanh, viền, chấm) cần 3:1
      L.subtle = mix(L.primary, '#FFFFFF', 0.9);
      L.strong = ensure(hex, [LIGHT.bg, LIGHT.surface, L.subtle], 4.5, '#000000'); // chữ & nền nút
      L.hover = mix(L.primary, '#000000', 0.12);
      L.active = mix(L.primary, '#000000', 0.3);
      L.strongHover = mix(L.strong, '#000000', 0.2);
      L.strongActive = mix(L.strong, '#000000', 0.38);
      L.onPrimary = '#FFFFFF';
      D.primary = ensure(hex, [DARK.elevated], 4.5, '#FFFFFF');
      D.subtle = mix(DARK.bg, D.primary, 0.26);
      D.primary = ensure(D.primary, [DARK.elevated, D.subtle], 4.5, '#FFFFFF');
      D.hover = mix(D.primary, '#FFFFFF', 0.25);
      D.active = mix(D.primary, '#FFFFFF', 0.45);
      D.strong = D.primary; D.strongHover = D.hover; D.strongActive = D.active;
      D.onPrimary = contrast(mix(D.primary, '#000000', 0.82), D.primary) >= 4.5 ? mix(D.primary, '#000000', 0.82) : '#000000';
    } else {
      L.secondary = ensure(hex, [LIGHT.bg], 3, '#000000');
      L.subtle = mix(L.secondary, '#FFFFFF', 0.88);
      L.strong = ensure(hex, [LIGHT.bg, L.subtle], 4.5, '#000000');
      D.secondary = ensure(hex, [DARK.elevated], 4.5, '#FFFFFF');
      D.subtle = mix(DARK.bg, D.secondary, 0.2);
      D.secondary = ensure(D.secondary, [D.subtle], 4.5, '#FFFFFF');
      D.strong = D.secondary;
    }
    return { light: L, dark: D };
  }

  // Bộ màu mặc định (đúng file thiết kế) để báo cáo tương phản
  const SPEC = {
    primary: { light: { primary: '#C6537B', subtle: '#FCE7EF', strong: '#AD4168', onPrimary: '#FFFFFF' }, dark: { primary: '#F09AB8', subtle: '#482635', strong: '#F09AB8', onPrimary: '#30121F' } },
    secondary: { light: { secondary: '#79638F', subtle: '#F0EAF6', strong: '#604B75' }, dark: { secondary: '#C1ACD4', subtle: '#30243A', strong: '#C1ACD4' } },
  };

  // ---------- Đọc / ghi ----------
  function get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
  }
  function save(prefs) {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  }

  // ---------- Áp dụng ----------
  const ld = (l, d) => `light-dark(${l}, ${d})`;
  function cssFor(prefs) {
    const lines = [];
    const p = norm(prefs.primary), s = norm(prefs.secondary);
    if (p) {
      const { light: L, dark: D } = deriveBrand(p, 'primary');
      lines.push(
        `--primary: ${ld(L.primary, D.primary)};`, `--primary-hover: ${ld(L.hover, D.hover)};`, `--primary-active: ${ld(L.active, D.active)};`,
        `--primary-subtle: ${ld(L.subtle, D.subtle)};`, `--surface-selected: ${ld(L.subtle, D.subtle)};`,
        `--primary-strong: ${ld(L.strong, D.strong)};`, `--primary-strong-hover: ${ld(L.strongHover, D.strongHover)};`, `--primary-strong-active: ${ld(L.strongActive, D.strongActive)};`,
        `--text-on-primary: ${ld(L.onPrimary, D.onPrimary)};`, `--focus-ring: ${ld(L.primary, D.primary)};`,
      );
    }
    if (s) {
      const { light: L, dark: D } = deriveBrand(s, 'secondary');
      lines.push(`--secondary: ${ld(L.secondary, D.secondary)};`, `--secondary-subtle: ${ld(L.subtle, D.subtle)};`, `--secondary-strong: ${ld(L.strong, D.strong)};`);
    }
    return lines.length ? `:root {\n  ${lines.join('\n  ')}\n}` : '';
  }

  function apply(prefs = get()) {
    const root = document.documentElement;
    if (prefs.mode === 'light' || prefs.mode === 'dark') root.dataset.theme = prefs.mode;
    else delete root.dataset.theme; // theo hệ thống: CSS tự đổi khi hệ điều hành đổi
    let el = document.getElementById('bcc-custom-theme');
    if (!el) {
      el = document.createElement('style');
      el.id = 'bcc-custom-theme';
      (document.head || root).appendChild(el);
    }
    el.textContent = cssFor(prefs);
  }

  function set(patch) {
    const prefs = { ...get(), ...patch };
    save(prefs);
    apply(prefs);
    return prefs;
  }
  function reset() { save({ ...DEFAULTS }); apply({ ...DEFAULTS }); }

  // Bảng kiểm tra tương phản cho màu đang dùng (sáng + tối)
  function report(prefs = get()) {
    const P = norm(prefs.primary) ? deriveBrand(norm(prefs.primary), 'primary') : SPEC.primary;
    const S = norm(prefs.secondary) ? deriveBrand(norm(prefs.secondary), 'secondary') : SPEC.secondary;
    const row = (label, l, d) => ({ label, light: l, dark: d });
    return [
      row('Chữ trên nút chính', contrast(P.light.onPrimary, P.light.strong), contrast(P.dark.onPrimary, P.dark.strong)),
      row('Chữ màu chủ đạo trên nền', contrast(P.light.strong, LIGHT.bg), contrast(P.dark.strong, DARK.elevated)),
      row('Mục đang chọn (thanh bên, bộ lọc)', contrast(P.light.strong, P.light.subtle), contrast(P.dark.strong, P.dark.subtle)),
      row('Chữ màu phụ trên nền nhạt', contrast(S.light.strong, S.light.subtle), contrast(S.dark.strong, S.dark.subtle)),
    ];
  }
  // Màu thật sự dùng sau khi tự chỉnh (để báo cho người dùng)
  function adjusted(prefs = get()) {
    const out = [];
    const p = norm(prefs.primary), s = norm(prefs.secondary);
    if (p) { const L = deriveBrand(p, 'primary').light; if (L.strong !== p) out.push({ kind: 'primary', from: p, to: L.strong }); }
    if (s) { const L = deriveBrand(s, 'secondary').light; if (L.strong !== s) out.push({ kind: 'secondary', from: s, to: L.strong }); }
    return out;
  }

  apply();
  addEventListener('storage', e => { if (e.key === KEY) apply(); }); // trang/tool khác vừa đổi → cập nhật ngay

  window.Theme = { get, set, reset, apply, report, adjusted, contrast, norm, PRESETS };
})();
