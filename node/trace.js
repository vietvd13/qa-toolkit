#!/usr/bin/env node
// Mở 1 link bằng trình duyệt thật, ghi lại toàn bộ chuỗi redirect
// (HTTP 3xx, meta refresh, JS redirect, tab mới, deep link app)
// và trích xuất các params cần thiết ở từng bước.
//
// Dùng:
//   node node/trace.js "<url>"
//   node node/trace.js "<url>" --params sub3,affiliate_id --idle 4000 --timeout 45000 --headful --mobile
//   node node/trace.js --file links.txt          (mỗi dòng 1 link)
//   node node/trace.js "<url>" --repeat 1000 --concurrency 5   (mở lại link 1000 lần)
//   thêm --detail để in bảng chi tiết từng bước redirect

const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

function parseArgs(argv) {
  const opts = {
    urls: [],
    params: ['sub3', 'sub4', 'Sub_id', 'affiliate_id', 'utm_content'],
    idle: 4000,       // không có điều hướng mới trong X ms => coi như kết thúc
    timeout: 45000,   // tổng thời gian tối đa cho 1 link
    headful: false,
    mobile: false,
    out: 'results',
    full: false,      // in URL đầy đủ trong bảng (mặc định cắt ngắn)
    urlWidth: 80,
    repeat: 1000,     // số lần mở lại mỗi link
    concurrency: 5,   // số phiên chạy song song
    detail: false,    // in bảng chi tiết từng bước redirect
    evidenceWidth: 130,// độ rộng cột bằng chứng trong bảng
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--params') opts.params = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--idle') opts.idle = Number(argv[++i]);
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--headful') opts.headful = true;
    else if (a === '--full') opts.full = true;
    else if (a === '--url-width') opts.urlWidth = Number(argv[++i]);
    else if (a === '--mobile') opts.mobile = true;
    else if (a === '--repeat') opts.repeat = Number(argv[++i]);
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (a === '--detail') opts.detail = true;
    else if (a === '--evidence-width') opts.evidenceWidth = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--file') {
      const lines = fs.readFileSync(argv[++i], 'utf8').split(/\r?\n/).map(s => s.trim());
      opts.urls.push(...lines.filter(l => l && !l.startsWith('#')));
    } else opts.urls.push(a);
  }
  return opts;
}

// Lấy toàn bộ params của 1 URL: query + hash, và đệ quy vào các value
// là URL lồng nhau (vd: ?url=https%3A%2F%2F...%3Fsub3%3Dabc).
function extractAllParams(rawUrl, depth = 0, acc = []) {
  if (depth > 5 || !rawUrl) return acc;
  let u;
  try { u = new URL(rawUrl); } catch { return acc; }

  const sources = [u.searchParams];
  if (u.hash.length > 1) {
    const h = u.hash.slice(1);
    const q = h.includes('?') ? h.slice(h.indexOf('?') + 1) : h;
    if (q.includes('=')) sources.push(new URLSearchParams(q));
  }
  for (const sp of sources) {
    for (const [k, v] of sp) {
      acc.push({ key: k, value: v, depth });
      let inner = v;
      for (let n = 0; n < 3 && /%[0-9a-f]{2}/i.test(inner); n++) {
        try { inner = decodeURIComponent(inner); } catch { break; }
      }
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inner)) extractAllParams(inner, depth + 1, acc);
    }
  }
  return acc;
}

function pickParams(url, wanted) {
  const all = extractAllParams(url);
  const found = {};
  for (const name of wanted) {
    // Ưu tiên param ở tầng ngoài cùng (depth nhỏ nhất)
    const hit = all
      .filter(p => p.key.toLowerCase() === name.toLowerCase())
      .sort((a, b) => a.depth - b.depth)[0];
    if (hit) found[name] = hit.value;
  }
  return found;
}

async function traceOne(browser, startUrl, opts) {
  const ctxOpts = opts.mobile
    ? { ...devices['iPhone 13'] }
    : { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
  const context = await browser.newContext({ ...ctxOpts, ignoreHTTPSErrors: true });

  const hops = [];
  const seen = new Set();
  let lastActivity = Date.now();
  const t0 = Date.now();

  const record = (url, type, status = null, extra = {}) => {
    if (!url || url === 'about:blank') return;
    if (seen.has(url)) return;
    seen.add(url);
    lastActivity = Date.now();
    hops.push({ step: hops.length + 1, ms: Date.now() - t0, type, status, url, ...extra });
  };

  const watchPage = (page, tag) => {
    // Mọi request điều hướng của main frame (bao gồm từng bước 3xx)
    page.on('request', req => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        record(req.url(), tag === 'main' ? 'request' : `${tag}-request`);
      }
    });
    // Ghi status + Location header của các response redirect
    page.on('response', res => {
      const req = res.request();
      if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
      const h = hops.find(x => x.url === res.url() && x.status === null);
      if (h) {
        h.status = res.status();
        const loc = res.headers()['location'];
        if (loc) h.location = loc;
      }
    });
    page.on('framenavigated', f => {
      if (f === page.mainFrame()) record(f.url(), tag === 'main' ? 'navigated' : `${tag}-navigated`);
    });
    // Deep link app (shopee://, intent://, ...) thường fail ở đây
    page.on('requestfailed', req => {
      if (req.isNavigationRequest()) record(req.url(), 'failed', null, { error: req.failure()?.errorText });
    });
  };

  // Bắt các scheme lạ / JS gán location mà trình duyệt không xử lý được
  await context.addInitScript(() => {
    /* global window, location, Location -- đoạn này chạy bên trong trang web, không phải Node */
    const report = u => { try { window.__hop && window.__hop(String(u)); } catch {} };
    const origOpen = window.open;
    window.open = function (u, ...r) { report(new URL(u, location.href).href); return origOpen.call(this, u, ...r); };
    const origAssign = Location.prototype.assign, origReplace = Location.prototype.replace;
    Location.prototype.assign = function (u) { report(new URL(u, location.href).href); return origAssign.call(this, u); };
    Location.prototype.replace = function (u) { report(new URL(u, location.href).href); return origReplace.call(this, u); };
  });
  await context.exposeFunction('__hop', u => record(u, 'js'));

  const mainPage = await context.newPage();
  watchPage(mainPage, 'main');
  context.on('page', p => watchPage(p, 'popup'));

  try {
    await mainPage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
  } catch (e) {
    record(startUrl, 'error', null, { error: e.message.split('\n')[0] });
  }

  // Chờ tới khi không còn điều hướng mới trong `idle` ms
  while (Date.now() - lastActivity < opts.idle && Date.now() - t0 < opts.timeout) {
    await new Promise(r => setTimeout(r, 250));
  }

  let finalUrl = mainPage.url();
  const pages = context.pages();
  if (pages.length > 1) finalUrl = pages[pages.length - 1].url();
  await context.close();

  // Trích params ở từng hop
  // (Không gộp params của Location vào bước trước — URL đích sẽ là 1 bước riêng)
  for (const h of hops) h.params = pickParams(h.url, opts.params);

  // Giá trị cuối cùng xuất hiện cho mỗi param + nơi xuất hiện đầu tiên
  const summary = {};
  for (const name of opts.params) {
    const withIt = hops.filter(h => h.params[name] !== undefined);
    summary[name] = withIt.length
      ? {
          value: withIt[withIt.length - 1].params[name],
          allValues: [...new Set(withIt.map(h => h.params[name]))],
          firstSeenStep: withIt[0].step,
          lastSeenStep: withIt[withIt.length - 1].step,
          // Từng bước có chứa param này: ở link nào, giá trị gì
          foundAt: withIt.map(h => ({ step: h.step, value: h.params[name], url: h.url })),
        }
      : null;
  }

  return { startUrl, startedAt: new Date(t0).toISOString(), finalUrl, totalHops: hops.length, durationMs: Date.now() - t0, summary, hops };
}

// Vẽ bảng dạng ┌─┬─┐ với các cột tự co theo nội dung
function drawTable(headers, rows) {
  const cells = [headers, ...rows].map(r => r.map(c => String(c ?? '')));
  const widths = headers.map((_, i) => Math.max(...cells.map(r => r[i].length)));
  const sep = (l, m, r) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r;
  const row = r => '│' + r.map((c, i) => ` ${c.padEnd(widths[i])} `).join('│') + '│';
  const out = [sep('┌', '┬', '┐'), row(cells[0]), sep('├', '┼', '┤'), ...cells.slice(1).map(row), sep('└', '┴', '┘')];
  console.log(out.join('\n'));
}

const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

function printResult(r, wanted, opts) {
  console.log(`\nSTART: ${r.startUrl}\nFINAL: ${r.finalUrl}   (${r.totalHops} bước, ${r.durationMs} ms)`);

  drawTable(
    ['#', 'Loại', 'Status', 'URL', ...wanted],
    r.hops.map(h => [
      h.step,
      h.type,
      h.status ?? (h.error ? 'ERR' : ''),
      opts.full ? h.url : cut(h.url, opts.urlWidth),
      ...wanted.map(p => h.params[p] ?? ''),
    ]),
  );

  drawTable(
    ['Param', 'Giá trị', 'Tìm thấy ở bước'],
    wanted.map(p => {
      const s = r.summary[p];
      return s
        ? [p, s.allValues.join(' | '), s.foundAt.map(f => `#${f.step}`).join(', ')]
        : [p, '(không tìm thấy)', ''];
    }),
  );
}

// In bảng STT | params theo kiểu stream (in dần từng dòng, đúng thứ tự STT)
function createStreamTable(headers, widths) {
  const sep = (l, m, r) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r;
  const row = r => '│' + r.map((c, i) => ` ${String(c ?? '').padEnd(widths[i])} `).join('│') + '│';
  return {
    header: () => console.log([sep('┌', '┬', '┐'), row(headers), sep('├', '┼', '┤')].join('\n')),
    row: r => console.log(row(r)),
    footer: () => console.log(sep('└', '┴', '┘')),
  };
}

const hostOf = u => {
  try { const x = new URL(u); return x.host || x.protocol.replace(':', '') + '://'; } catch { return u; }
};

// Chuỗi domain đã đi qua, gộp các link liền nhau cùng domain: a.com → b.com (2 link) → c.com
function hostChain(r) {
  const out = [];
  for (const h of r.hops || []) {
    const host = hostOf(h.url);
    const last = out[out.length - 1];
    if (last && last.host === host) last.n++;
    else out.push({ host, n: 1 });
  }
  return out.map(x => (x.n > 1 ? `${x.host} (${x.n} link)` : x.host)).join(' → ');
}

// Câu giải thích dễ đọc cho từng lần chạy, vd:
//   "Có affiliate_id ở link thứ 2 (abc.com) · KHÔNG có sub3 trong cả 3 link đã đi qua · Đường đi: ..."
function evidenceText(r, params) {
  if (r.error && !r.hops?.length) return `Lỗi, không mở được link: ${r.error}`;
  const parts = params.map(p => {
    const s = r.summary?.[p];
    if (!s) return `KHÔNG có ${p} trong cả ${r.totalHops} link đã đi qua`;
    const steps = [...new Set(s.foundAt.map(f => f.step))].join(', ');
    const hosts = [...new Set(s.foundAt.map(f => hostOf(f.url)))].join(', ');
    return `Có ${p} ở link thứ ${steps} (${hosts})`;
  });
  return [...parts, `Đường đi: ${hostChain(r)}`].join(' · ');
}

async function askInputs(opts) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Hàng đợi dòng: không bị mất dòng khi dán/nhập nhanh hơn câu hỏi
  const lines = [], waiters = [];
  rl.on('line', l => (waiters.length ? waiters.shift()(l) : lines.push(l)));
  rl.on('close', () => { while (waiters.length) waiters.shift()(null); });
  rl.question = q => {
    process.stdout.write(q);
    return new Promise(res => (lines.length ? res(lines.shift()) : waiters.push(res))).then(l => {
      if (l === null) { console.log('\nĐã huỷ.'); process.exit(1); }
      return l;
    });
  };
  const askNumber = async (label, def) => {
    for (;;) {
      const a = (await rl.question(`${label} [mặc định ${def}]: `)).trim();
      if (!a) return def;
      const n = Number(a);
      if (Number.isInteger(n) && n > 0) return n;
      console.log('  → Vui lòng nhập số nguyên dương.');
    }
  };

  for (;;) {
    const url = (await rl.question('Nhập link cần kiểm tra: ')).trim().replace(/^["']|["']$/g, '');
    if (/^https?:\/\/\S+$/i.test(url)) { opts.urls.push(url); break; }
    console.log('  → Link không hợp lệ, phải bắt đầu bằng http:// hoặc https://');
  }
  opts.repeat = await askNumber('Số lượt cần thử', opts.repeat);
  opts.concurrency = await askNumber('Số lượt chạy song song', opts.concurrency);
  rl.close();
  console.log();
}

module.exports = { traceOne, pickParams, hostOf, hostChain, evidenceText };

// Chỉ chạy CLI khi gọi trực tiếp `node trace.js` (không chạy khi server.js require)
if (require.main === module) (async () => {
  const opts = parseArgs(process.argv.slice(2));
  // Không truyền link trên dòng lệnh => hỏi người dùng nhập
  if (!opts.urls.length) await askInputs(opts);

  // Danh sách job: mỗi link lặp lại opts.repeat lần
  const jobs = [];
  for (const url of opts.urls) for (let k = 0; k < opts.repeat; k++) jobs.push({ stt: jobs.length + 1, url });

  fs.mkdirSync(opts.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(opts.out, `summary-${stamp}.csv`);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  // Ghi CSV dần từng dòng => dừng giữa chừng vẫn giữ được dữ liệu
  fs.writeFileSync(csvPath, '﻿' + [
    'stt', ...opts.params, 'started_at', 'chuoi_redirect',
    ...opts.params.map(p => `${p}_tim_thay_o_url`), 'tat_ca_url', 'final_url', 'hops', 'error',
  ].map(esc).join(',') + '\n');
  // Bằng chứng đầy đủ: toàn bộ các bước redirect của từng lần chạy (1 dòng JSON / 1 lần)
  const evidencePath = path.join(opts.out, `evidence-${stamp}.jsonl`);
  fs.writeFileSync(evidencePath, '');

  const widths = [Math.max(3, String(jobs.length).length), ...opts.params.map(p => Math.max(p.length, 16)), opts.evidenceWidth];
  const table = createStreamTable(['STT', ...opts.params, 'Bằng chứng'], widths);
  const groups = new Map(); // gom nhóm theo (giá trị params + chuỗi redirect) để giải thích quy luật
  if (!opts.detail) table.header();

  const browser = await chromium.launch({ headless: !opts.headful });
  const results = new Array(jobs.length);
  const done = new Map();
  let nextToPrint = 1;
  const stats = Object.fromEntries(opts.params.map(p => [p, 0]));

  const flush = () => {
    while (done.has(nextToPrint)) {
      const r = done.get(nextToPrint);
      done.delete(nextToPrint);
      const vals = opts.params.map(p => r.summary?.[p]?.allValues.join(' | ') ?? (r.error ? 'ERR' : '-'));
      const chain = hostChain(r);
      if (opts.detail) printResult(r, opts.params, opts);
      else table.row([nextToPrint, ...vals.map((v, i) => cut(v, widths[i + 1])), cut(evidenceText(r, opts.params), opts.evidenceWidth)]);

      fs.appendFileSync(csvPath, [
        nextToPrint, ...vals, r.startedAt, chain,
        ...opts.params.map(p => r.summary?.[p]?.foundAt.map(f => `#${f.step} ${f.url}`).join('\n')
          ?? `KHÔNG CÓ ${p} - đã kiểm tra ${r.totalHops} link:\n` + (r.hops || []).map(h => `#${h.step} ${h.url}`).join('\n')),
        (r.hops || []).map(h => `#${h.step} [${h.status ?? h.type}] ${h.url}`).join('\n'),
        r.finalUrl, r.totalHops, r.error,
      ].map(esc).join(',') + '\n');
      fs.appendFileSync(evidencePath, JSON.stringify({ stt: nextToPrint, ...r }) + '\n');

      const key = JSON.stringify([...vals, chain]);
      const g = groups.get(key) || { vals, chain, stts: [] };
      g.stts.push(nextToPrint);
      groups.set(key, g);
      nextToPrint++;
    }
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      let r;
      try {
        r = await traceOne(browser, job.url, opts);
      } catch (e) {
        r = { startUrl: job.url, finalUrl: '', totalHops: 0, hops: [], summary: null, error: e.message.split('\n')[0] };
      }
      for (const p of opts.params) if (r.summary?.[p]) stats[p]++;
      results[job.stt - 1] = r;
      done.set(job.stt, r);
      flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, jobs.length) }, worker));
  await browser.close();

  if (!opts.detail) table.footer();
  console.log(`Tổng: ${jobs.length} lần  |  ${opts.params.map(p => `${p}: ${stats[p]}/${jobs.length}`).join('  |  ')}`);

  // Tỉ lệ xuất hiện của từng giá trị (vd: mỗi affiliate_id chiếm bao nhiêu %)
  const ran = results.filter(Boolean);
  for (const p of opts.params) {
    const counts = new Map();
    let none = 0;
    for (const r of ran) {
      const vals = r.summary?.[p]?.allValues;
      if (vals?.length) vals.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
      else none++;
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (none) rows.push(['(không có)', none]);
    console.log(`\nTỈ LỆ XUẤT HIỆN CỦA ${p.toUpperCase()}:`);
    drawTable([p, 'Số lượt', 'Tỉ lệ'], rows.map(([v, n]) => [v, n, `${(100 * n / ran.length).toFixed(1)}%`]));
  }

  // Bảng nhóm: mỗi kiểu kết quả đi qua chuỗi redirect nào, bao nhiêu lần, ở các STT nào
  const sttList = a => (a.length > 12 ? `${a.slice(0, 12).join(',')},… (${a.length})` : a.join(','));
  console.log('\nTHỐNG KÊ THEO NHÓM (cùng giá trị params + cùng chuỗi redirect):');
  drawTable(
    [...opts.params, 'Số lần', '%', 'Chuỗi redirect', 'STT'],
    [...groups.values()]
      .sort((a, b) => b.stts.length - a.stts.length)
      .map(g => [...g.vals, g.stts.length, (100 * g.stts.length / jobs.length).toFixed(1), opts.full ? g.chain : cut(g.chain, 90), sttList(g.stts)]),
  );

  console.log(`\nĐã lưu: ${csvPath}`);
  console.log(`        ${evidencePath}   (toàn bộ URL từng bước của mỗi lần chạy)`);
})();
