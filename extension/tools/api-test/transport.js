// Service: gửi HTTP request.
// - Extension: trang của extension có quyền host nên fetch() tới API không bị CORS; không gửi cookie của trình duyệt
//   (credentials: 'omit'). Header trình duyệt không cho fetch() tự đặt (Cookie, Origin, Referer, User-Agent) được gắn bằng
//   luật declarativeNetRequest; mặc định bỏ header Origin như Postman.
//   Redirect: một luật DNR "block" chặn mọi request do extension gửi tới domain ngoài Allowed hosts, nên trình duyệt
//   không đi theo redirect sang host lạ (chặn ngay ở tầng mạng). Sau khi nhận response, URL cuối còn được kiểm lại bằng
//   ApiPolicy (đủ luật host nội bộ / cổng); sai → lỗi, bỏ response (fail closed). Không đặt được luật → redirect: 'manual',
//   gặp redirect là dừng.
//   Các request cần cùng một bộ luật (header đặc biệt + Allowed hosts) chạy chung; bộ luật khác phải chờ.
//   Chrome host permission: kiểm chrome.permissions.contains trước khi gửi; thiếu → lỗi code 'permission' để giao diện
//   xin quyền (chrome.permissions.request phải chạy trong thao tác bấm của tester).
// - Bản web (npm run ui): gửi qua /api/proxy của node/server.js; máy chủ kiểm allowlist, IP thật lúc kết nối và từng bước redirect.
// ApiTransport.send(request, { timeout, signal, allowHosts })
//   → { status, statusText, headers, body, isBinary, size, truncated, timeMs, url, redirected, warnings }
//   hoặc ném Error tiếng Việt có .code: timeout · network · cancelled · permission · redirect · policy
(() => {
  const IS_EXT = !!globalThis.chrome?.runtime?.id;
  const RULE_ID = 2_000_001; // tools/redirect dùng id 1…1.000.000
  const BLOCK_ID = 2_000_002;
  const VIA_RULE = new Set(['cookie', 'origin', 'referer', 'user-agent']);
  const FORBIDDEN = /^(accept-charset|accept-encoding|access-control-request-.*|connection|content-length|cookie2|date|dnt|expect|host|keep-alive|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/i;
  const MAX_RESPONSE = 10 * 1024 * 1024;
  const TEXTUAL = /^(text\/|application\/(json|.*\+json|xml|.*\+xml|javascript|x-www-form-urlencoded|graphql|problem\+json))/i;
  const err = (msg, code, cause) => Object.assign(new Error(msg, cause ? { cause } : undefined), { code });

  // ---------- Khoá theo bộ luật DNR: cùng bộ luật thì chạy chung, khác thì chờ ----------
  let active = 0, activeKey = null;
  const waiters = [];
  const wake = () => { while (waiters.length && waiters[0]()) waiters.shift(); };
  const acquire = key => new Promise(res => {
    const tryIt = () => {
      if (active && activeKey !== key) return false;
      activeKey = key;
      active++;
      res();
      return true;
    };
    if (!waiters.length && tryIt()) return;
    waiters.push(tryIt);
  });
  const release = () => { active--; wake(); };

  // Allowed hosts → domain cho luật DNR (bỏ cổng; *.a.com → a.com, DNR tự gồm subdomain). Không đổi được → null
  function dnrDomains(allowHosts) {
    const out = new Set();
    for (const p of ApiPolicy.parseList(allowHosts)) {
      if (p.startsWith('[')) return null; // IPv6: không chắc DNR khớp được → dùng redirect: 'manual'
      const host = p.replace(/:\d+$/, '').replace(/^\*\./, '');
      if (!/^[a-z0-9.-]+$/.test(host)) return null;
      out.add(host);
    }
    return out.size ? [...out] : null;
  }

  let ruleKey = null;
  // special: header đặc biệt cần gắn; domains: domain được phép (null = không đặt luật block)
  async function setRules(special, domains) {
    const key = JSON.stringify([special, domains]);
    if (key === ruleKey) return;
    const requestHeaders = Object.entries(special).map(([header, value]) => ({ header, operation: 'set', value }));
    if (!('origin' in special)) requestHeaders.push({ header: 'origin', operation: 'remove' });
    const cond = { initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest'] };
    const addRules = [{ id: RULE_ID, priority: 2, action: { type: 'modifyHeaders', requestHeaders }, condition: cond }];
    if (domains) addRules.push({ id: BLOCK_ID, priority: 3, action: { type: 'block' }, condition: { ...cond, excludedRequestDomains: domains } });
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID, BLOCK_ID], addRules });
    ruleKey = key;
  }
  async function cleanup() {
    ruleKey = null;
    if (IS_EXT && chrome.declarativeNetRequest) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID, BLOCK_ID] }).catch(() => {});
  }

  // ---------- Chrome host permission ----------
  const originPattern = url => { try { const u = new URL(url); return `${u.protocol}//${u.hostname}/*`; } catch { return null; } };
  async function hasPermission(url) {
    if (!IS_EXT || !chrome.permissions?.contains) return true;
    const o = originPattern(url);
    if (!o) return true;
    try { return await chrome.permissions.contains({ origins: [o] }); } catch { return true; }
  }
  // Phải gọi trong thao tác bấm của tester
  async function requestPermission(urls) {
    if (!IS_EXT || !chrome.permissions?.request) return true;
    const origins = [...new Set(urls.map(originPattern).filter(Boolean))];
    if (!origins.length) return true;
    try { return await chrome.permissions.request({ origins }); } catch { return false; }
  }

  const friendly = (e, timeout) => {
    if (e?.code) return e;
    if (e?.name === 'TimeoutError' || e?.message === 'timeout') return err(`Quá thời gian chờ (${timeout} ms) mà máy chủ chưa trả lời`, 'timeout', e);
    if (e?.name === 'AbortError') return err('Đã dừng giữa chừng, không nhận được response', 'cancelled', e);
    if (/Failed to fetch|NetworkError|fetch failed|ERR_BLOCKED/i.test(e?.message)) {
      return err('Không kết nối được tới máy chủ (sai địa chỉ, máy chủ đang tắt, lỗi chứng chỉ TLS, mất mạng, hoặc redirect tới host ngoài Allowed hosts nên bị chặn)', 'network', e);
    }
    return e instanceof Error ? e : new Error(String(e));
  };

  // Đọc tối đa MAX_RESPONSE byte, phần dư bỏ đi và đánh dấu truncated
  async function readLimited(res) {
    const reader = res.body?.getReader();
    if (!reader) return { bytes: new Uint8Array(0), truncated: false, size: 0 };
    const chunks = [];
    let size = 0, truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > MAX_RESPONSE) {
        chunks.push(value.subarray(0, MAX_RESPONSE - size));
        size = MAX_RESPONSE;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      size += value.length;
    }
    const bytes = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return { bytes, truncated, size };
  }
  const hex = u8 => Array.from(u8.subarray(0, 64), b => b.toString(16).padStart(2, '0')).join(' ');
  function decodeBody(bytes, contentType) {
    const textual = !contentType || TEXTUAL.test(contentType);
    if (textual) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      // Không khai báo content-type mà có nhiều ký tự điều khiển → coi là nhị phân
      if (contentType || !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 2000))) return { body: text, isBinary: false }; // eslint-disable-line no-control-regex
    }
    return { body: `[Dữ liệu nhị phân] content-type: ${contentType || '(không có)'} · ${bytes.length} byte · 64 byte đầu (hex): ${hex(bytes)}`, isBinary: true };
  }

  async function sendExt(req, { timeout, signal, allowHosts }) {
    if (!(await hasPermission(req.url))) {
      throw err(`Chrome chưa cấp quyền cho extension truy cập ${new URL(req.url).host}. Bấm “Cấp quyền” rồi gửi lại.`, 'permission');
    }
    const normal = {}, special = {}, dropped = [];
    for (const [k, v] of Object.entries(req.headers)) {
      if (VIA_RULE.has(k.toLowerCase())) special[k.toLowerCase()] = v;
      else if (FORBIDDEN.test(k)) dropped.push(k);
      else normal[k] = v;
    }
    const domains = chrome.declarativeNetRequest ? dnrDomains(allowHosts) : null;
    const key = JSON.stringify([special, domains]);
    await acquire(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeout);
    const onStop = () => ctrl.abort(new DOMException('stop', 'AbortError'));
    if (signal?.aborted) onStop();
    signal?.addEventListener('abort', onStop);
    try {
      let guarded = false;
      if (chrome.declarativeNetRequest) {
        try { await setRules(special, domains); guarded = !!domains; } catch { guarded = false; }
      }
      const t0 = performance.now();
      const res = await fetch(req.url, {
        method: req.method, headers: normal, body: req.body ?? undefined,
        credentials: 'omit', cache: 'no-store', redirect: guarded ? 'follow' : 'manual', referrerPolicy: 'no-referrer', signal: ctrl.signal,
      });
      if (res.type === 'opaqueredirect') {
        throw err('Máy chủ trả về redirect nhưng extension không kiểm được đích nên đã dừng (fail closed). Thêm host đích vào Allowed hosts hoặc dùng bản web để đi theo redirect có kiểm tra.', 'redirect');
      }
      if (res.redirected) {
        const blocked = ApiPolicy.check(res.url, allowHosts);
        if (blocked) { res.body?.cancel().catch(() => {}); throw err(`Redirect tới ${res.url} không được phép: ${blocked}. Đã bỏ response.`, 'redirect'); }
      }
      const { bytes, truncated, size } = await readLimited(res);
      const timeMs = Math.round(performance.now() - t0);
      const ct = res.headers.get('content-type') || '';
      const warnings = [];
      if (dropped.length) warnings.push(`Trình duyệt không cho gửi header: ${dropped.join(', ')}. Dùng bản web (npm run ui) nếu cần.`);
      if (truncated) warnings.push(`Response lớn hơn ${MAX_RESPONSE / 1024 / 1024} MB, chỉ giữ phần đầu`);
      return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers), ...decodeBody(bytes, ct), size, truncated, timeMs, url: res.url, redirected: res.redirected, warnings };
    } catch (e) {
      throw friendly(ctrl.signal.reason?.name ? ctrl.signal.reason : e, timeout);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onStop);
      release();
    }
  }

  async function sendWeb(req, { timeout, signal, allowHosts }) {
    let r;
    try {
      r = await fetch('/api/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: req.body, timeout, allowHosts }),
      });
    } catch (e) {
      if (e.name === 'AbortError') throw err('Đã dừng giữa chừng, không nhận được response', 'cancelled', e);
      throw err('Mất kết nối tới máy chủ của bản web. Kiểm tra cửa sổ đang chạy “npm run ui”.', 'network', e);
    }
    const d = await r.json().catch(() => ({ error: `Máy chủ bản web trả lỗi ${r.status}` }));
    if (d.error) throw err(d.error, d.code || 'network');
    return { ...d, warnings: d.warnings || [] };
  }

  window.ApiTransport = {
    mode: IS_EXT ? 'extension' : 'web', send: IS_EXT ? sendExt : sendWeb, cleanup, hasPermission, requestPermission, MAX_RESPONSE,
  };
})();
