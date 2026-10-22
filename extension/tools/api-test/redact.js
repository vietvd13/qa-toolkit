// Che dữ liệu nhạy cảm trước khi hiển thị, lưu bằng chứng hay xuất file + chính sách host (chống SSRF) phía client.
//   ApiRedact.create(secretValues) → { url(u), headers(obj), body(text), text(s), any: () => đã che gì chưa }
//   ApiRedact.isSecretName(name)   → tên header / tham số / khoá JSON / biến có vẻ là bí mật
//   ApiPolicy.check(url, allowList) → null nếu được phép gửi, ngược lại là lý do bị chặn
(() => {
  const MASK = '****';
  const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|token)$/i;
  const SECRET_KEY = /(pass(word|wd)?$|^pwd$|secret|token|api[_-]?key|authorization|cookie|session|^otp$|private[_-]?key|signature|^sig$|credential)/i;
  const isSecretName = n => SECRET_HEADER.test(String(n)) || SECRET_KEY.test(String(n));

  function create(secretValues = []) {
    // Giá trị bí mật dài trước để không che dở (vd "abc" nằm trong "abcdef")
    const values = [...new Set(secretValues.map(v => String(v ?? '')).filter(v => v.length >= 4))].sort((a, b) => b.length - a.length);
    let hit = false;
    const text = s => {
      if (s == null) return s;
      let out = String(s);
      for (const v of values) if (out.includes(v)) { out = out.split(v).join(MASK); hit = true; }
      return out;
    };
    const maskHeaderValue = v => {
      hit = true;
      const m = String(v).match(/^(Bearer|Basic|Token|Digest)\s+/i);
      return m ? `${m[1]} ${MASK}` : MASK;
    };
    const headers = h => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, isSecretName(k) && v !== '' ? maskHeaderValue(v) : text(v)]));
    const pairs = s => String(s).split('&').map(p => {
      const i = p.indexOf('=');
      if (i < 0) return p;
      let k = p.slice(0, i);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch {}
      if (isSecretName(k)) { hit = true; return p.slice(0, i + 1) + MASK; }
      return p;
    }).join('&');
    const url = u => {
      if (!u) return u;
      const s = String(u);
      const q = s.indexOf('?');
      return text(q < 0 ? s : s.slice(0, q + 1) + pairs(s.slice(q + 1)));
    };
    const deep = v => {
      if (Array.isArray(v)) return v.map(deep);
      if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => {
          if (isSecretName(k) && x != null && typeof x !== 'object' && x !== '') { hit = true; return [k, MASK]; }
          return [k, deep(x)];
        }));
      }
      return typeof v === 'string' ? text(v) : v;
    };
    // Body: JSON → che theo khoá (giữ định dạng gốc nếu không có gì phải che); a=1&b=2 → che theo tên; còn lại che theo giá trị
    const body = s => {
      if (s == null || s === '') return s;
      const str = String(s);
      try {
        const parsed = JSON.parse(str);
        if (parsed && typeof parsed === 'object') {
          const before = hit;
          hit = false;
          const red = deep(parsed);
          const changed = hit;
          hit = before || changed;
          return changed ? JSON.stringify(red, null, /\n/.test(str) ? 2 : 0) : str;
        }
      } catch {}
      if (/^[^=&\s{[]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(str.trim())) return text(pairs(str));
      return text(str);
    };
    return { text, headers, url, body, deep, any: () => hit };
  }

  // ---------- Chính sách host ----------
  const METADATA = new Set(['169.254.169.254', 'metadata.google.internal', 'metadata', '100.100.100.200', 'fd00:ec2::254', '[fd00:ec2::254]']);
  function isPrivateHost(h) {
    h = h.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    if (h.includes(':')) return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
    return !h.includes('.'); // tên máy trong mạng nội bộ, vd "api-server"
  }
  const parseList = list => (Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/)).map(s => s.trim().toLowerCase()).filter(Boolean)
    .map(s => s.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  // Mẫu: "api.example.com", "api.example.com:8443", "*.example.com". Host nội bộ chỉ được phép khi ghi đúng tên (không qua *)
  function matchHost(host, port, list) {
    for (const p of parseList(list)) {
      const [ph, pp] = p.startsWith('[') ? [p.slice(0, p.indexOf(']') + 1), p.slice(p.indexOf(']') + 2) || ''] : p.split(':');
      if (pp && pp !== port) continue;
      if (ph === host) return 'exact';
      if (ph.startsWith('*.') && host.endsWith(ph.slice(1))) return 'wildcard';
    }
    return null;
  }
  function check(url, allowList) {
    let u;
    try { u = new URL(url); } catch { return `URL không hợp lệ: ${url}`; }
    if (!/^https?:$/.test(u.protocol)) return `Giao thức ${u.protocol} không được phép (chỉ http, https)`;
    if (u.username || u.password) return 'URL chứa user:password, hãy dùng header Authorization';
    const host = u.hostname.toLowerCase();
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (METADATA.has(host)) return `Host ${host} là dịch vụ metadata của cloud, luôn bị chặn`;
    if (!parseList(allowList).length) return 'Environment chưa có Allowed hosts';
    const m = matchHost(host, port, allowList);
    if (!m) return `Host ${u.host} không có trong Allowed hosts`;
    if (m === 'wildcard' && isPrivateHost(host)) return `Host nội bộ ${host} phải được ghi đúng tên trong Allowed hosts (không dùng *)`;
    return null;
  }

  window.ApiRedact = { create, isSecretName, MASK };
  window.ApiPolicy = { check, isPrivateHost, matchHost, parseList, METADATA };
})();
