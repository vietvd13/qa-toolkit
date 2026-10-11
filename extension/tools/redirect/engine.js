// Lõi kiểm tra redirect chạy ngay trong extension (không cần server).
// Mỗi lượt mở link trong 1 tab mới của một cửa sổ riêng, dùng webRequest + webNavigation
// để ghi lại MỌI bước chuyển hướng (3xx, JS, meta refresh, deep link app).
// Trả kết quả cùng định dạng với server.js để giao diện dùng lại được.
(() => {
  const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- Lấy param: query + hash + link lồng đã mã hoá (giống trace.js) ----------
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
      const hit = all.filter(p => p.key.toLowerCase() === name.toLowerCase()).sort((a, b) => a.depth - b.depth)[0];
      if (hit) found[name] = hit.value;
    }
    return found;
  }
  const hostOf = u => { try { const x = new URL(u); return x.host || x.protocol.replace(':', '') + '://'; } catch { return u; } };
  function hostChain(hops) {
    const out = [];
    for (const h of hops) {
      const host = hostOf(h.url);
      const last = out[out.length - 1];
      if (last && last.host === host) last.n++;
      else out.push({ host, n: 1 });
    }
    return out.map(x => (x.n > 1 ? `${x.host} (${x.n} link)` : x.host)).join(' → ');
  }

  // ---------- Theo dõi các tab đang kiểm tra ----------
  const watched = new Map(); // tabId -> ctx
  const isHttp = u => /^https?:/i.test(u);

  function record(ctx, url, type, extra = {}) {
    if (!url || /^(about|chrome|chrome-extension|data|blob):/i.test(url)) return null;
    ctx.last = Date.now();
    const old = ctx.hops.find(h => h.url === url);
    if (old) return old;
    const h = { step: ctx.hops.length + 1, type, status: null, url, location: null, error: null, ...extra };
    ctx.hops.push(h);
    return h;
  }
  const ctxOf = d => watched.get(d.tabId);
  const MAIN = { urls: ['<all_urls>'], types: ['main_frame'] };

  chrome.webRequest.onBeforeRequest.addListener(d => { const c = ctxOf(d); if (c) record(c, d.url, 'request'); }, MAIN);
  chrome.webRequest.onBeforeRedirect.addListener(d => {
    const c = ctxOf(d);
    if (!c) return;
    const h = record(c, d.url, 'request');
    if (h) { h.status = d.statusCode; h.location = d.redirectUrl; }
    if (!isHttp(d.redirectUrl)) record(c, d.redirectUrl, 'failed', { error: 'Chuyển sang app (không mở được trong trình duyệt)' });
  }, MAIN);
  chrome.webRequest.onCompleted.addListener(d => {
    const c = ctxOf(d);
    if (!c) return;
    const h = record(c, d.url, 'request');
    if (h && h.status == null) h.status = d.statusCode;
  }, MAIN);
  chrome.webRequest.onErrorOccurred.addListener(d => {
    const c = ctxOf(d);
    if (!c) return;
    const h = record(c, d.url, 'failed');
    if (h && !h.status && d.error !== 'net::ERR_ABORTED') h.error = d.error;
  }, MAIN);
  // Bắt cả điều hướng không đi qua webRequest (deep link app, chuyển trang bằng JS)
  chrome.webNavigation.onBeforeNavigate.addListener(d => {
    if (d.frameId !== 0) return;
    const c = ctxOf(d);
    if (c) record(c, d.url, isHttp(d.url) ? 'navigated' : 'failed', isHttp(d.url) ? {} : { error: 'Chuyển sang app (không mở được trong trình duyệt)' });
  });
  chrome.webNavigation.onCommitted.addListener(d => {
    if (d.frameId !== 0) return;
    const c = ctxOf(d);
    if (c) record(c, d.url, d.transitionQualifiers?.includes('client_redirect') ? 'js' : 'navigated');
  });

  // ---------- Giả lập điện thoại: đổi User-Agent cho riêng tab kiểm tra ----------
  async function setMobileUA(tabId, on) {
    const id = (tabId % 1_000_000) + 1;
    const rule = {
      id, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: MOBILE_UA }] },
      condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'other'] },
    };
    await chrome.declarativeNetRequest.updateSessionRules(on ? { removeRuleIds: [id], addRules: [rule] } : { removeRuleIds: [id] });
  }

  // ---------- Xoá cookie của các link đã đi qua (để lượt sau như người mới) ----------
  async function clearCookiesOf(hops) {
    for (const h of hops) {
      if (!isHttp(h.url)) continue;
      const cookies = await chrome.cookies.getAll({ url: h.url }).catch(() => []);
      for (const c of cookies) {
        const url = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`;
        await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId }).catch(() => {});
      }
    }
  }

  function buildRow(stt, ctx, startUrl, t0, params, error) {
    const hops = ctx.hops.map(h => ({ ...h, params: pickParams(h.url, params) }));
    const values = {}, found = {};
    for (const p of params) {
      const withIt = hops.filter(h => h.params[p] !== undefined);
      values[p] = withIt.length ? [...new Set(withIt.map(h => h.params[p]))] : null;
      found[p] = withIt.map(h => ({ step: h.step, host: hostOf(h.url) }));
    }
    return {
      stt, startedAt: new Date(t0).toISOString(), durationMs: Date.now() - t0,
      finalUrl: hops.length ? hops[hops.length - 1].url : '',
      error: error || (hops.length ? null : 'Không ghi nhận được link nào'),
      chain: hostChain(hops), values, found, hops,
    };
  }

  // ---------- Chạy N lượt ----------
  // handlers: { start({total}), row(row), done(), fatal(message) } → trả về { close() } để dừng
  function run(query, handlers) {
    const num = (v, def, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min ? Math.min(n, max) : def; };
    const opts = {
      url: String(query.url || '').trim(),
      repeat: num(query.repeat, 1000, 1, 100000),
      concurrency: num(query.concurrency, 5, 1, 10),
      idle: num(query.idle, 4000, 500, 60000),
      timeout: num(query.timeout, 45000, 5000, 300000),
      mobile: query.mobile === '1',
      clearCookies: !!query.clearCookies,
      params: String(query.params || 'sub3,sub4,Sub_id,affiliate_id,utm_content').split(',').map(s => s.trim()).filter(Boolean),
    };
    let aborted = false, windowId = null, ended = false;
    const end = (kind, msg) => {
      if (ended) return;
      ended = true;
      aborted = true;
      if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
      if (kind === 'done') handlers.done();
      else if (kind === 'fatal') handlers.fatal(msg);
    };
    const onWinClosed = id => { if (id === windowId && !ended) end('fatal', 'Cửa sổ kiểm tra đã bị đóng nên tool dừng lại.'); };

    (async () => {
      if (!/^https?:\/\/\S+$/i.test(opts.url)) return end('fatal', 'Link phải bắt đầu bằng http:// hoặc https://');
      try {
        const win = await chrome.windows.create({ url: 'about:blank', focused: false, width: 560, height: 460, left: 40, top: 40 });
        windowId = win.id;
      } catch (e) {
        return end('fatal', 'Không mở được cửa sổ kiểm tra: ' + e.message);
      }
      chrome.windows.onRemoved.addListener(onWinClosed);
      handlers.start({ total: opts.repeat });

      let next = 1;
      const worker = async () => {
        while (!aborted && next <= opts.repeat) {
          const stt = next++;
          const t0 = Date.now();
          const ctx = { hops: [], last: t0 };
          let tabId = null, error = null;
          try {
            const tab = await chrome.tabs.create({ windowId, url: 'about:blank', active: false });
            tabId = tab.id;
            watched.set(tabId, ctx);
            if (opts.mobile) await setMobileUA(tabId, true);
            await chrome.tabs.update(tabId, { url: opts.url });
            // Chờ tới khi không còn điều hướng mới trong `idle` ms (và trang đã tải xong), hoặc hết giờ
            while (!aborted && Date.now() - t0 < opts.timeout) {
              await sleep(150);
              const quiet = Date.now() - ctx.last;
              if (quiet < opts.idle) continue;
              const t = await chrome.tabs.get(tabId).catch(() => null);
              if (!t || t.status === 'complete' || quiet >= opts.idle * 2) break;
            }
          } catch (e) {
            error = e.message;
          } finally {
            if (tabId != null) {
              watched.delete(tabId);
              if (opts.mobile) await setMobileUA(tabId, false).catch(() => {});
              await chrome.tabs.remove(tabId).catch(() => {});
            }
          }
          if (aborted) break;
          if (opts.clearCookies) await clearCookiesOf(ctx.hops);
          handlers.row(buildRow(stt, ctx, opts.url, t0, opts.params, error));
        }
      };
      await Promise.all(Array.from({ length: Math.min(opts.concurrency, opts.repeat) }, worker));
      chrome.windows.onRemoved.removeListener(onWinClosed);
      if (!ended) end('done');
    })();

    addEventListener('beforeunload', () => { if (windowId != null) chrome.windows.remove(windowId); });
    return { close: () => end('stop') };
  }

  window.RedirectEngine = {
    run,
    features: {
      clearCookies: true,
      maxConcurrency: 10,
      runNote: 'Tool mở link trong một cửa sổ Chrome riêng, đi hết chuỗi chuyển hướng rồi vẽ lại các link đã qua. Cửa sổ đó tự đóng khi chạy xong. Đóng nó giữa chừng thì tool dừng.',
    },
  };
})();
