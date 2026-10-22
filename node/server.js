#!/usr/bin/env node
// Bản web (chạy trên máy) của Bộ công cụ.
//   npm run ui          → mở http://localhost:3000
// Phục vụ NGUYÊN thư mục extension/ (khung bộ công cụ, giao diện, các tool) để bản web giống hệt extension.
// Khác biệt duy nhất: tools/redirect/engine.js được thay bằng node/redirect-engine.js —
// trình duyệt ngầm (Playwright) chạy ở đây, trang nhận kết quả qua SSE.
// Kiểm thử API (tools/api-test) gửi request qua /api/proxy (không bị CORS, có kiểm SSRF).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const https = require('https');
const zlib = require('zlib');
const { pipeline } = require('stream');
const dns = require('dns');
const net = require('net');
const vm = require('vm');
const { chromium } = require('playwright');
const { traceOne, hostOf, hostChain } = require('./trace.js');

const PORT = Number(process.env.PORT) || 3000;
const EXT_DIR = path.join(__dirname, '..', 'extension');
const WEB_ENGINE = path.join(__dirname, 'redirect-engine.js');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
// Trang sandbox chạy script của tester (Kiểm thử API): dùng đúng CSP khai báo trong manifest.json
// (origin riêng, chặn mọi kết nối mạng) để bản web cách ly giống extension.
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
const SANDBOX_PAGES = new Set((MANIFEST.sandbox?.pages || []).map(p => '/' + p));
const SANDBOX_CSP = MANIFEST.content_security_policy?.sandbox || "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-eval'; worker-src blob:";
// File chỉ dành cho extension, không phục vụ trên web
const EXT_ONLY = new Set(['/background.js']);

// Phục vụ file tĩnh trong extension/ (chặn đi ra ngoài thư mục)
function serveStatic(res, pathname) {
  if (pathname === '/tools/redirect/engine.js') return sendFile(res, WEB_ENGINE);
  if (EXT_ONLY.has(pathname)) return false;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const extra = SANDBOX_PAGES.has(pathname) ? { 'Content-Security-Policy': SANDBOX_CSP } : {};
  let file;
  try { file = path.normalize(path.join(EXT_DIR, decodeURIComponent(pathname))); } catch { return false; }
  if (!file.startsWith(EXT_DIR + path.sep)) return false;
  return sendFile(res, file, extra);
}
function sendFile(res, file, extra = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...extra });
    fs.createReadStream(file).pipe(res);
  });
  return true;
}

function parseRunParams(u) {
  const q = u.searchParams;
  const num = (k, def, min, max) => {
    const n = Number(q.get(k));
    return Number.isInteger(n) && n >= min ? Math.min(n, max) : def;
  };
  return {
    url: (q.get('url') || '').trim(),
    repeat: num('repeat', 1000, 1, 100000),
    concurrency: num('concurrency', 5, 1, 30),
    idle: num('idle', 4000, 500, 60000),
    timeout: num('timeout', 45000, 5000, 300000),
    mobile: q.get('mobile') === '1',
    params: (q.get('params') || 'sub3,sub4,Sub_id,affiliate_id,utm_content').split(',').map(s => s.trim()).filter(Boolean),
  };
}

// Chạy N lượt và đẩy từng kết quả về trình duyệt qua Server-Sent Events.
// Người dùng bấm "Dừng" / đóng tab → kết nối đóng → ngừng nhận lượt mới.
async function handleRun(req, res, opts) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let aborted = false;
  req.on('close', () => { aborted = true; });

  if (!/^https?:\/\/\S+$/i.test(opts.url)) {
    send('fatal', { message: 'Link không hợp lệ, phải bắt đầu bằng http:// hoặc https://' });
    return res.end();
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    send('fatal', { message: 'Không mở được trình duyệt Chromium. Hãy chạy: npm run setup', detail: e.message });
    return res.end();
  }

  send('start', { total: opts.repeat, params: opts.params, startedAt: Date.now() });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  let cursor = 0;
  const worker = async () => {
    while (!aborted && cursor < opts.repeat) {
      const stt = ++cursor;
      let r;
      try {
        r = await traceOne(browser, opts.url, opts);
      } catch (e) {
        r = { startUrl: opts.url, finalUrl: '', totalHops: 0, hops: [], summary: null, error: e.message.split('\n')[0] };
      }
      if (aborted) break;
      send('row', {
        stt,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
        finalUrl: r.finalUrl,
        error: r.error || null,
        chain: hostChain(r),
        values: Object.fromEntries(opts.params.map(p => [p, r.summary?.[p]?.allValues ?? null])),
        found: Object.fromEntries(opts.params.map(p => [p,
          r.summary?.[p]?.foundAt.map(f => ({ step: f.step, host: hostOf(f.url) })) ?? []])),
        hops: (r.hops || []).map(h => ({
          step: h.step, type: h.type, status: h.status, url: h.url,
          location: h.location || null, error: h.error || null, params: h.params,
        })),
      });
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, opts.repeat) }, worker));
  } finally {
    clearInterval(heartbeat);
    await browser.close().catch(() => {});
  }
  if (!aborted) {
    send('done', { finishedAt: Date.now() });
    res.end();
  }
}

// Kiểm thử API (tools/api-test): máy chủ gọi API hộ trang web nên không bị CORS.
// Chỉ nhận request từ chính trang của bản web: phải là POST JSON cùng origin
// (trang lạ gửi JSON sẽ phải hỏi trước bằng OPTIONS và bị từ chối vì không có CORS).
// Chống SSRF: dùng chung chính sách host với trang (extension/tools/api-test/redact.js → ApiPolicy), thêm kiểm IP:
//   - host phải nằm trong danh sách được phép (tester khai báo; biến môi trường QA_ALLOWED_HOSTS nếu đặt thì giới hạn thêm)
//   - IP nội bộ / loopback chỉ được phép khi tên host được ghi đúng (không qua *), IP metadata của cloud luôn bị chặn
//   - IP được kiểm NGAY LÚC KẾT NỐI (hàm lookup của http/https), tức đúng địa chỉ socket sẽ nối tới: không còn khoảng
//     hở "tra DNS rồi kết nối lại" để DNS rebinding lợi dụng
//   - redirect đi từng bước (tối đa 5), mỗi bước kiểm lại như trên; không tắt kiểm tra chứng chỉ TLS
//   - body gửi tối đa 20 MB, response đọc tối đa 10 MB (sau khi giải nén gzip / deflate / br)
const ApiPolicy = (() => {
  const sandbox = { window: {}, URL };
  vm.runInNewContext(fs.readFileSync(path.join(EXT_DIR, 'tools', 'api-test', 'redact.js'), 'utf8'), sandbox);
  return sandbox.window.ApiPolicy;
})();
const PROXY_MAX_BODY = 20 * 1024 * 1024;
const PROXY_MAX_RESPONSE = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const SERVER_ALLOW = process.env.QA_ALLOWED_HOSTS || '';
const TEXTUAL = /^(text\/|application\/(json|.*\+json|xml|.*\+xml|javascript|x-www-form-urlencoded|graphql|problem\+json))/i;
const HOP_HEADERS = /^(host|content-length|connection|transfer-encoding|keep-alive|upgrade|te|trailer|proxy-connection)$/i;

// Kiểm theo tên host (allowlist của tester + của máy chủ)
function hostPolicy(url, allowHosts) {
  return ApiPolicy.check(url, allowHosts) || (SERVER_ALLOW && ApiPolicy.check(url, SERVER_ALLOW) ? 'Host không nằm trong QA_ALLOWED_HOSTS của máy chủ' : null);
}
function ipBlocked(address, host, exact) {
  if (ApiPolicy.METADATA.has(address)) return `${host} trỏ tới IP metadata ${address}, luôn bị chặn`;
  if (ApiPolicy.isPrivateHost(address) && !exact) return `${host} trỏ tới IP nội bộ ${address}; muốn test API nội bộ hãy ghi đúng tên host (không dùng *) trong danh sách được phép`;
  return null;
}
// lookup dùng cho socket: kiểm mọi địa chỉ phân giải được trước khi http / https kết nối
function guardedLookup(exact) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err);
      for (const { address } of addrs) {
        const why = ipBlocked(address, hostname, exact);
        if (why) return cb(Object.assign(new Error(why), { code: 'EPOLICY' }));
      }
      if (options.all) cb(null, addrs);
      else cb(null, addrs[0].address, addrs[0].family);
    });
  };
}
function requestOnce(url, { method, headers, body, signal, lookup }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (!HOP_HEADERS.test(k)) h[k] = String(v);
    if (!Object.keys(h).some(k => /^accept-encoding$/i.test(k))) h['Accept-Encoding'] = 'gzip, deflate, br';
    const buf = body == null ? null : Buffer.from(String(body), 'utf8');
    if (buf) h['Content-Length'] = String(buf.length);
    let r;
    try {
      r = (u.protocol === 'https:' ? https : http).request(u, { method, headers: h, lookup, signal }, resolve);
    } catch (e) { reject(e); return; }
    r.on('error', reject);
    if (buf) r.write(buf);
    r.end();
  });
}
// Đọc response (giải nén nếu cần) tối đa PROXY_MAX_RESPONSE byte
async function readLimited(resp) {
  const enc = String(resp.headers['content-encoding'] || '').toLowerCase().trim();
  const z = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip() : enc === 'deflate' ? zlib.createInflate() : enc === 'br' ? zlib.createBrotliDecompress() : null;
  const stream = z ? pipeline(resp, z, () => {}) : resp;
  const chunks = [];
  let size = 0, truncated = false;
  for await (const value of stream) {
    if (size + value.length > PROXY_MAX_RESPONSE) { chunks.push(value.subarray(0, PROXY_MAX_RESPONSE - size)); size = PROXY_MAX_RESPONSE; truncated = true; break; }
    chunks.push(value);
    size += value.length;
  }
  if (truncated) resp.destroy();
  return { buf: Buffer.concat(chunks), size, truncated };
}

function handleProxy(req, res) {
  const reply = (code, data) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
  const origin = req.headers.origin;
  if (req.method !== 'POST' || !/^application\/json/i.test(req.headers['content-type'] || '') || (origin && origin !== `http://${req.headers.host}`)) {
    return reply(403, { error: 'Chỉ trang của bản web được dùng proxy này' });
  }
  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > PROXY_MAX_BODY) req.destroy();
    else chunks.push(c);
  });
  req.on('end', async () => {
    let opts;
    try { opts = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { error: 'Dữ liệu gửi lên proxy không hợp lệ' }); }
    const timeout = Math.min(Math.max(Number(opts.timeout) || 30000, 1000), 600000);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeout);
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); }); // trang bấm Dừng
    let url = String(opts.url || '');
    let method = String(opts.method || 'GET').toUpperCase();
    let body = opts.body ?? undefined;
    const headers = Object.fromEntries(Object.entries(opts.headers || {}).filter(([, v]) => v != null));
    const t0 = performance.now();
    let hop = 0;
    try {
      let r;
      for (; ; hop++) {
        const blocked = hostPolicy(url, opts.allowHosts);
        if (blocked) return reply(200, { error: (hop ? `Redirect bước ${hop} bị chặn: ` : 'Bị chính sách bảo mật chặn, request chưa được gửi: ') + blocked, code: hop ? 'redirect' : 'policy' });
        const u = new URL(url);
        const host = u.hostname.replace(/^\[|\]$/g, '');
        const port = u.port || (u.protocol === 'https:' ? '443' : '80');
        const exact = ApiPolicy.matchHost(u.hostname.toLowerCase(), port, opts.allowHosts) === 'exact';
        if (net.isIP(host)) { // IP ghi thẳng: socket không gọi lookup nên kiểm ở đây
          const why = ipBlocked(host, host, exact);
          if (why) return reply(200, { error: (hop ? `Redirect bước ${hop} bị chặn: ` : 'Bị chính sách bảo mật chặn, request chưa được gửi: ') + why, code: hop ? 'redirect' : 'policy' });
        }
        r = await requestOnce(url, { method, headers, body, signal: ctrl.signal, lookup: guardedLookup(exact) });
        const loc = r.headers.location;
        if (![301, 302, 303, 307, 308].includes(r.statusCode) || !loc) break;
        r.resume();
        if (hop >= MAX_REDIRECTS) return reply(200, { error: `Quá ${MAX_REDIRECTS} lần redirect`, code: 'redirect' });
        url = new URL(loc, url).toString();
        if (r.statusCode === 303 || ((r.statusCode === 301 || r.statusCode === 302) && method === 'POST')) {
          method = method === 'HEAD' ? 'HEAD' : 'GET';
          body = undefined;
          for (const k of Object.keys(headers)) if (/^content-(type|length)$/i.test(k)) delete headers[k];
        }
      }
      const { buf, size: got, truncated } = await readLimited(r);
      const outHeaders = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]));
      const ct = outHeaders['content-type'] || '';
      const text = buf.toString('utf8');
      const isBinary = ct ? !TEXTUAL.test(ct) : /[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 2000)); // eslint-disable-line no-control-regex
      reply(200, {
        status: r.statusCode, statusText: r.statusMessage || '', headers: outHeaders,
        body: isBinary ? `[Dữ liệu nhị phân] content-type: ${ct || '(không có)'} · ${got} byte · 64 byte đầu (hex): ${buf.subarray(0, 64).toString('hex').replace(/(..)(?!$)/g, '$1 ')}` : text,
        isBinary, size: got, truncated, timeMs: Math.round(performance.now() - t0), url, redirected: url !== opts.url,
        warnings: truncated ? [`Response lớn hơn ${PROXY_MAX_RESPONSE / 1024 / 1024} MB, chỉ giữ phần đầu`] : [],
      });
    } catch (e) {
      const reason = ctrl.signal.reason;
      const pre = hop ? `Redirect bước ${hop} bị chặn: ` : 'Bị chính sách bảo mật chặn, request chưa được gửi: ';
      const [msg, code] = e.code === 'EPOLICY' ? [pre + e.message, hop ? 'redirect' : 'policy']
        : reason?.name === 'TimeoutError' ? [`Quá thời gian chờ (${timeout} ms) mà máy chủ chưa trả lời`, 'timeout']
          : ctrl.signal.aborted ? ['Đã dừng giữa chừng, không nhận được response', 'cancelled']
            : e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? [`Không phân giải được tên miền (${e.code})`, 'network']
              : /^Z_/.test(e.code || '') ? [`Có response nhưng không giải nén được body (${e.code})`, 'network']
              : [`Không kết nối được tới máy chủ: ${e.code || e.message}`, 'network'];
      if (!res.writableEnded && !res.destroyed) reply(200, { error: msg, code });
    } finally {
      clearTimeout(timer);
    }
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/proxy') return handleProxy(req, res);
  // Cho phép script dán vào console ở tab khác gọi API (CORS + Private Network Access của Chrome)
  if (u.pathname.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' });
      return res.end();
    }
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(302, { Location: '/hub.html' });
    return res.end();
  }
  if (u.pathname === '/favicon.ico') return sendFile(res, path.join(EXT_DIR, 'icons', 'icon32.png'));
  if (u.pathname === '/api/run') return handleRun(req, res, parseRunParams(u));
  if (serveStatic(res, u.pathname)) return;
  res.writeHead(404).end('Not found');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Cổng ${PORT} đang bận. Chạy với cổng khác: set PORT=3001 && npm run ui`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}`;
  console.log(`Giao diện đang chạy tại: ${link}\n(Nhấn Ctrl+C để tắt)`);
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
    exec(cmd);
  }
});
