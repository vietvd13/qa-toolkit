#!/usr/bin/env node
// Bản web (chạy trên máy) của tool Kiểm tra Redirect.
//   npm run ui          → mở http://localhost:3000
// Dùng CHUNG giao diện với extension (extension/tools/redirect/), chỉ thay engine.js
// bằng node/redirect-engine.js: trình duyệt ngầm (Playwright) chạy ở đây, trang nhận kết quả qua SSE.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { chromium } = require('playwright');
const { traceOne, hostOf, hostChain } = require('./trace.js');

const PORT = Number(process.env.PORT) || 3000;
const EXT_DIR = path.join(__dirname, '..', 'extension');
const WEB_ENGINE = path.join(__dirname, 'redirect-engine.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Phục vụ file tĩnh trong extension/shared và extension/tools/redirect (chặn đi ra ngoài thư mục)
function serveStatic(res, pathname) {
  if (pathname === '/tools/redirect/engine.js') return sendFile(res, WEB_ENGINE);
  if (pathname === '/tools/redirect/') pathname += 'index.html';
  if (!/^\/(shared|tools\/redirect)\//.test(pathname)) return false;
  const file = path.normalize(path.join(EXT_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(EXT_DIR + path.sep)) return false;
  return sendFile(res, file);
}
function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
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

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  // Cho phép script dán vào console ở tab khác gọi API (CORS + Private Network Access của Chrome)
  if (u.pathname.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' });
      return res.end();
    }
  }
  if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/tools/redirect') {
    res.writeHead(302, { Location: '/tools/redirect/' });
    return res.end();
  }
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
