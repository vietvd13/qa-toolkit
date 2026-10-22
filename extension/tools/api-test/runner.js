// Domain: ghép request cuối cùng, chấm kết quả, chạy cả bộ test.
//   ApiRunner.build(base, env, kase, vars)  → { request, missing: [tên biến], warnings }
//   ApiRunner.evaluate(expect, response)    → { statusPass, assertions: [{ source, path, operator, expected, actual, pass, reason }] }
//   ApiRunner.executor(ctx)                 → { execute(kase, i, { vars }) }: chạy MỘT case qua toàn bộ pipeline
//                                             (ghép → pre-request → kiểm biến / host → gửi → chấm → extract → post-response → che).
//                                             Dùng chung cho nút Send và cho runner nhiều request (engine.js).
//   ApiRunner.run(opts)                     → Promise<result[]>; chạy một suite, gọi opts.onResult(result) sau mỗi case
// Script trước khi gửi chạy sau khi ghép request (có thể sửa request, đặt biến); script sau response chạy sau khi chấm,
// mỗi pm.test thành một assertion (source "script").
// result.errorKind phân loại ERROR / SKIPPED: build · script · variable · policy · permission · network · evaluate · cancelled · dependency.
// Thứ tự ghép header: Base Request (cURL) → header của environment → requestOverride.headers (không phân biệt hoa thường;
// null = xoá). queryParams ghép theo khoá. requestOverride.body thay thế toàn bộ body. Mỗi case dùng bản sao, không sửa Base Request.
(() => {
  const MISSING = Symbol('missing');
  const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const MAX_REQUEST_BODY = 5 * 1024 * 1024;

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function newRunId(d = new Date()) {
    return `RUN-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // ---------- Biến ----------
  const sub = (s, vars, missing) => ApiCheck.substitute(s, vars, missing);
  const subDeep = (v, vars, missing) => {
    if (typeof v === 'string') return sub(v, vars, missing);
    if (Array.isArray(v)) return v.map(x => subDeep(x, vars, missing));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subDeep(x, vars, missing)]));
    return v;
  };

  // ---------- Ghép request ----------
  function mergeHeaders(layers) {
    const out = [];
    for (const layer of layers) {
      for (const [k, v] of layer) {
        const i = out.findIndex(([x]) => x.toLowerCase() === k.toLowerCase());
        if (i >= 0) out.splice(i, 1);
        if (v !== null && v !== undefined) out.push([k, String(v)]);
      }
    }
    return out;
  }

  // base: { method, url, query: [{key,value,enabled}], headers: [{key,value,enabled}], body: { mode, value } | null }
  // env:  { headers: [{key,value,enabled}] }
  function build(base, env, kase, vars) {
    const missing = new Set();
    const warnings = [];
    const o = kase.requestOverride || {};
    const method = String(o.method || base.method || 'GET').toUpperCase();

    // URL + query
    const baseUrl = sub(base.url, vars, missing);
    let url = baseUrl;
    let query = (base.query || []).filter(q => q.enabled !== false && q.key).map(q => [q.key, sub(q.value, vars, missing)]);
    if (o.url) {
      const raw = sub(o.url.trim(), vars, missing);
      if (raw.startsWith('/')) {
        let origin;
        try { origin = new URL(baseUrl).origin; } catch { throw new Error(`Không ghép được requestOverride.url "${o.url}" vì URL của Base Request chưa hợp lệ`); }
        url = origin + raw;
      } else url = raw;
      const q = url.indexOf('?');
      if (q >= 0) { // URL ghi đè có query riêng → thay query của Base Request
        query = url.slice(q + 1).split('&').filter(Boolean).map(p => {
          const i = p.indexOf('=');
          const d = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
          return [d(i < 0 ? p : p.slice(0, i)), i < 0 ? '' : d(p.slice(i + 1))];
        });
        url = url.slice(0, q);
      }
    }
    if (o.queryParams) {
      for (const [k, v] of Object.entries(o.queryParams)) {
        query = query.filter(([x]) => x !== k);
        if (v === null) continue;
        for (const one of Array.isArray(v) ? v : [v]) query.push([k, sub(String(one), vars, missing)]);
      }
    }
    let finalUrl = url;
    if (query.length) finalUrl += (url.includes('?') ? '&' : '?') + query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

    // Header
    const headers = mergeHeaders([
      (base.headers || []).filter(h => h.enabled !== false && h.key).map(h => [h.key, sub(h.value, vars, missing)]),
      (env.headers || []).filter(h => h.enabled !== false && h.key).map(h => [h.key, sub(h.value, vars, missing)]),
      Object.entries(o.headers || {}).map(([k, v]) => [k, v === null ? null : sub(String(v), vars, missing)]),
    ]);
    const hasHeader = name => headers.some(([k]) => k.toLowerCase() === name);

    // Body
    const body = o.body || base.body || null;
    let bodyText = null;
    if (body) {
      if (body.mode === 'json') bodyText = JSON.stringify(subDeep(body.value, vars, missing));
      else if (body.mode === 'raw') bodyText = sub(String(body.value ?? ''), vars, missing);
      else if (body.mode === 'form-urlencoded') {
        bodyText = typeof body.value === 'string' ? sub(body.value, vars, missing)
          : new URLSearchParams(Object.entries(body.value || {}).filter(([, v]) => v !== null).map(([k, v]) => [k, sub(String(v), vars, missing)])).toString();
      }
      if (bodyText != null && !hasHeader('content-type')) {
        headers.push(['Content-Type', body.mode === 'json' ? 'application/json' : body.mode === 'form-urlencoded' ? 'application/x-www-form-urlencoded' : 'text/plain;charset=UTF-8']);
      }
    }
    if (bodyText != null && (method === 'GET' || method === 'HEAD')) {
      warnings.push(`Method ${method} không gửi được body, đã bỏ body khi gửi`);
      bodyText = null;
    }
    if (bodyText != null && bodyText.length > MAX_REQUEST_BODY) throw new Error(`Request body vượt giới hạn ${MAX_REQUEST_BODY / 1024 / 1024} MB`);
    return { request: { method, url: finalUrl, headers: Object.fromEntries(headers), body: bodyText, bodyMode: bodyText == null ? null : body.mode }, missing: [...missing], warnings };
  }

  // ---------- Chấm ----------
  const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  const subset = (whole, part) => (part && typeof part === 'object' && !Array.isArray(part) && whole && typeof whole === 'object' && !Array.isArray(whole))
    ? Object.entries(part).every(([k, v]) => Object.prototype.hasOwnProperty.call(whole, k) && (deepEqual(whole[k], v) || subset(whole[k], v)))
    : deepEqual(whole, part);
  const show = v => (v === MISSING ? '(không có)' : v === undefined ? '' : JSON.stringify(v) ?? String(v));
  const getPath = (obj, keys) => {
    let cur = obj;
    for (const k of keys) {
      if (cur === null || typeof cur !== 'object') return MISSING;
      if (typeof k === 'number' ? !Array.isArray(cur) || k >= cur.length : !Object.prototype.hasOwnProperty.call(cur, k)) return MISSING;
      cur = cur[k];
    }
    return cur;
  };

  function compare(op, actual, expected) {
    if (op === 'exists') return actual !== MISSING ? [true] : [false, 'Không có trường này trong response'];
    if (op === 'notExists') return actual === MISSING ? [true] : [false, 'Trường này vẫn có trong response'];
    if (actual === MISSING) return [false, 'Không có trường này trong response'];
    switch (op) {
      case 'eq': return deepEqual(actual, expected) ? [true] : [false, typeOf(actual) !== typeOf(expected) ? `Khác kiểu: mong ${typeOf(expected)}, thực tế ${typeOf(actual)}` : 'Giá trị khác'];
      case 'ne': return !deepEqual(actual, expected) ? [true] : [false, 'Giá trị bằng giá trị không mong muốn'];
      case 'contains':
      case 'notContains': {
        let has;
        if (Array.isArray(actual)) has = actual.some(x => deepEqual(x, expected) || subset(x, expected));
        else if (typeof actual === 'string') has = actual.includes(typeof expected === 'string' ? expected : JSON.stringify(expected));
        else if (actual && typeof actual === 'object') has = subset(actual, expected);
        else return [false, `Không áp dụng "${op}" cho kiểu ${typeOf(actual)}`];
        return op === 'contains' ? (has ? [true] : [false, 'Không chứa giá trị mong muốn']) : (!has ? [true] : [false, 'Vẫn chứa giá trị không mong muốn']);
      }
      case 'type': return typeOf(actual) === expected ? [true] : [false, `Kiểu thực tế là ${typeOf(actual)}`];
      case 'in': return expected.some(e => deepEqual(actual, e)) ? [true] : [false, 'Giá trị không thuộc danh sách'];
      case 'gt': case 'gte': case 'lt': case 'lte': {
        if (typeof actual !== 'number') return [false, `Giá trị thực tế không phải số (${typeOf(actual)})`];
        const ok = { gt: actual > expected, gte: actual >= expected, lt: actual < expected, lte: actual <= expected }[op];
        return ok ? [true] : [false, 'So sánh số không đạt'];
      }
    }
    return [false, `Operator "${op}" không được hỗ trợ`];
  }

  // response: { status, headers, body (chuỗi), isBinary }
  function evaluate(expect, res) {
    const statusPass = expect.statusCodes.includes(res.status);
    let json = MISSING;
    if (!res.isBinary && res.body != null && res.body !== '') { try { json = JSON.parse(res.body); } catch {} }
    const headers = Object.fromEntries(Object.entries(res.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const assertions = (expect.assertions || []).map(a => {
      let actual;
      let reason = '';
      if (a.source === 'header') actual = Object.prototype.hasOwnProperty.call(headers, a.path.toLowerCase()) ? headers[a.path.toLowerCase()] : MISSING;
      else if (json === MISSING) {
        actual = a.path === '$' && !res.isBinary ? res.body ?? '' : MISSING;
        if (actual === MISSING) reason = res.isBinary ? 'Response là dữ liệu nhị phân, không đọc được JSON' : 'Response không phải JSON';
      } else actual = getPath(json, ApiSchema.parsePath(a.path));
      const [pass, why] = reason && a.operator !== 'notExists' ? [false, reason] : compare(a.operator, actual, a.value);
      return {
        source: a.source, path: a.path, operator: a.operator,
        expected: ApiSchema.NO_VALUE.includes(a.operator) ? '' : show(a.value),
        actual: shorten(show(actual)), pass, reason: pass ? '' : why || reason,
      };
    });
    if (expect.maxTimeMs != null) { // schema 1.1
      const t = res.timeMs;
      const pass = t != null && t <= expect.maxTimeMs;
      assertions.push({ source: 'time', path: 'response time', operator: 'lte', expected: `${expect.maxTimeMs} ms`, actual: t == null ? '(không đo được)' : `${t} ms`,
        pass, reason: pass ? '' : t == null ? 'Không đo được thời gian phản hồi' : `Chậm hơn ngưỡng ${t - expect.maxTimeMs} ms` });
    }
    return { statusPass, assertions };
  }
  const shorten = s => (s.length > 2000 ? s.slice(0, 2000) + '… (đã rút gọn, xem Response Body)' : s);
  function extract(path, res) {
    try { return getPath(JSON.parse(res.body), ApiSchema.parsePath(path)); } catch { return MISSING; }
  }
  // Rule lưu biến của request (chọn từ response): { name, source: 'body'|'header'|'status', path }
  function extractRule(x, res) {
    if (x.source === 'status') return res.status;
    if (x.source === 'header') {
      const k = Object.keys(res.headers || {}).find(h => h.toLowerCase() === String(x.path || '').toLowerCase());
      return k === undefined ? MISSING : res.headers[k];
    }
    return extract(x.path || '$', res);
  }

  // Request do script trước khi gửi sửa lại: thay nốt {{biến}} còn lại (body JSON thay trong từng chuỗi để không vỡ JSON)
  function resubstitute(req, vars) {
    const missing = new Set();
    const out = { ...req, url: sub(req.url, vars, missing), headers: Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k, sub(String(v), vars, missing)])) };
    if (req.body != null) {
      let done = false;
      if (req.bodyMode === 'json') { try { out.body = JSON.stringify(subDeep(JSON.parse(req.body), vars, missing)); done = true; } catch {} }
      if (!done) out.body = sub(req.body, vars, missing);
    }
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(out.method)) throw new Error(`Script đặt method "${out.method}" không hợp lệ`);
    if ((out.method === 'GET' || out.method === 'HEAD') && out.body != null) out.body = null;
    return { request: out, missing: [...missing] };
  }
  // Request của pm.sendRequest (cú pháp Postman) → request của tool
  function normSend(r) {
    const url = typeof r === 'string' ? r : typeof r.url === 'string' ? r.url : r.url?.raw;
    if (!url) throw new Error('pm.sendRequest cần url');
    const method = String(r.method || 'GET').toUpperCase();
    const headers = {};
    const hs = r.header || r.headers;
    if (Array.isArray(hs)) hs.filter(h => h && !h.disabled).forEach(h => { headers[h.key] = String(h.value ?? ''); });
    else if (hs && typeof hs === 'object') Object.entries(hs).forEach(([k, v]) => { headers[k] = String(v ?? ''); });
    let body = null;
    const b = r.body;
    if (typeof b === 'string') body = b;
    else if (b?.mode === 'raw') body = String(b.raw ?? '');
    else if (b?.mode === 'urlencoded') body = new URLSearchParams((b.urlencoded || []).filter(x => !x.disabled).map(x => [x.key, String(x.value ?? '')])).toString();
    else if (b?.mode) throw new Error(`pm.sendRequest chưa hỗ trợ body mode "${b.mode}" (dùng raw hoặc urlencoded)`);
    if (body != null && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = b?.mode === 'urlencoded' ? 'application/x-www-form-urlencoded' : (() => { try { JSON.parse(body); return 'application/json'; } catch { return 'text/plain;charset=UTF-8'; } })();
    }
    return { method, url, headers, body: method === 'GET' || method === 'HEAD' ? null : body };
  }
  const caseInfo = k => ({ id: k.id, name: k.name, group: k.group || '', priority: k.priority, description: k.description || '', note: k.note || '' });

  // ---------- Chạy một case ----------
  // ctx: { runId, base, env: { headers, secretNames: Set, allowHosts }, vars (object dùng chung giữa các case),
  //        secretValues (mảng dùng chung: giá trị cần che, kể cả token script / extract vừa lấy), settings: { timeout },
  //        send(request, { timeout, signal, allowHosts }), signal, scripts: { pre, post }, runScript(kind, payload, { onSend }),
  //        requestExtract: [{ name, source, path }], evidenceId(i), meta (gắn nguyên vào result: request / folder / collection) }
  // execute(kase, i, { vars, isolated }):
  //   kase.expect = null → chỉ gửi (nút Send): PASS khi có response và mọi pm.test đạt, không chấm status.
  //   isolated = true → chạy song song: vars là bản sao riêng, biến script đặt không được giữ cho case khác.
  function executor(ctx) {
    const { runId, base, env, settings, send, signal } = ctx;
    const scripts = { pre: (ctx.scripts?.pre || '').trim(), post: (ctx.scripts?.post || '').trim() };
    const secretValues = ctx.secretValues || [];
    const isSecretVar = k => env.secretNames.has(k) || ApiRedact.isSecretName(k);
    const evidenceId = ctx.evidenceId || (i => `EV-${runId.replace(/^RUN-/, '')}-${pad(i + 1, 3)}`);

    async function execute(kase, i, { vars = ctx.vars, isolated = false } = {}) {
      const r = {
        runId, index: i, caseId: kase.id, evidenceId: evidenceId(i), status: 'ERROR', reason: '', errorKind: null,
        startedAt: Date.now(), durationMs: null, request: null, response: null,
        statusCheck: kase.expect ? { expected: kase.expect.statusCodes, actual: null, pass: false } : null,
        assertions: [], warnings: [], extracted: {}, scriptLogs: [], redacted: false, ...(ctx.meta || {}),
      };
      let varChanges = 0;
      // Biến do script đặt / xoá: áp vào biến của lần chạy; giá trị có tên giống bí mật được che trong báo cáo
      const applyVars = next => {
        for (const k of Object.keys(vars)) if (!(k in next)) { delete vars[k]; varChanges++; }
        for (const [k, v] of Object.entries(next)) {
          if (vars[k] === v) continue;
          if (v != null && isSecretVar(k)) secretValues.push(String(v));
          vars[k] = v;
          varChanges++;
        }
      };
      const fail = (kind, reason) => { r.errorKind = kind; r.reason = reason; return seal(); };
      const seal = () => { // chỉ giữ bản đã che trong kết quả (tạo bộ che lúc này để gồm cả token script vừa lấy)
        if (isolated && varChanges) r.warnings.push(`Chạy song song: ${varChanges} thay đổi biến của script chỉ có hiệu lực trong case này`);
        const red = ApiRedact.create(secretValues);
        if (r.request) r.request = { ...r.request, url: red.url(r.request.url), headers: red.headers(r.request.headers), body: red.body(r.request.body) };
        if (r.response) r.response = { ...r.response, url: red.url(r.response.url), headers: red.headers(r.response.headers), body: red.body(r.response.body) };
        r.reason = red.text(r.reason);
        r.transportError = r.transportError ? red.text(r.transportError) : r.transportError;
        r.assertions = r.assertions.map(a => ({ ...a, path: red.text(a.path), actual: red.text(a.actual), reason: red.text(a.reason) }));
        r.extracted = Object.fromEntries(Object.entries(r.extracted).map(([k, v]) => [k, isSecretVar(k) ? ApiRedact.MASK : red.text(v)]));
        r.scriptLogs = r.scriptLogs.map(l => red.text(l));
        r.warnings = r.warnings.map(w => red.text(w));
        r.redacted = red.any();
        return r;
      };
      // pm.sendRequest trong script: tool gửi hộ, vẫn chặn host ngoài danh sách
      const scriptSend = async raw => {
        const q = normSend(raw);
        const blocked = ApiPolicy.check(q.url, env.allowHosts);
        if (blocked) { r.scriptLogs.push(`pm.sendRequest ${q.method} ${q.url} bị chặn: ${blocked}`); throw new Error(blocked); }
        const res = await send(q, { timeout: settings.timeout, signal, allowHosts: env.allowHosts });
        r.scriptLogs.push(`pm.sendRequest ${q.method} ${q.url} → ${res.status} (${res.timeMs} ms)`);
        return { status: res.status, statusText: res.statusText, headers: res.headers, body: res.body, timeMs: res.timeMs, size: res.size };
      };
      const runScript = async (kind, payload) => {
        const out = await ctx.runScript(kind, { ...payload, code: scripts[kind], case: caseInfo(kase) }, { onSend: scriptSend });
        r.scriptLogs.push(...(out.logs || []).map(l => `[${kind === 'pre' ? 'pre-request' : 'post-response'}] ${l}`));
        if (out.missingVars?.length) r.warnings.push(`${kind === 'pre' ? 'Pre-request' : 'Post-response'} script đọc variable chưa có trong environment (trả về undefined): ${out.missingVars.join(', ')}`);
        if (out.vars) applyVars(out.vars);
        return out;
      };

      let built;
      try { built = build(base, env, kase, vars); } catch (e) { return fail('build', 'Không ghép được request: ' + e.message); }
      r.warnings.push(...built.warnings);
      if (scripts.pre) {
        const out = await runScript('pre', { request: built.request, vars });
        if (out.error) { r.request = built.request; return fail('script', `Pre-request script lỗi (request chưa được gửi): ${out.error}`); }
        // Luôn đi tiếp từ chính request script đã thấy (kể cả khi script không sửa gì): chỉ thay nốt {{biến}} còn lại.
        // Không ghép lại từ đầu, vì như vậy {{$timestamp}}, {{$randomPhone}}… sinh giá trị mới và chữ ký / dữ liệu
        // script vừa tính theo request cũ sẽ không còn khớp request gửi đi.
        try { built = { ...built, ...resubstitute(out.request || built.request, vars) }; }
        catch (e) { r.request = built.request; return fail('build', 'Không ghép được request sau Pre-request script: ' + e.message); }
      }
      r.request = built.request;
      if (built.missing.length) {
        r.missingVars = built.missing;
        return fail('variable', `Chưa có giá trị cho biến ${built.missing.map(v => `{{${v}}}`).join(', ')} (request chưa được gửi)`);
      }
      const blocked = ApiPolicy.check(built.request.url, env.allowHosts);
      if (blocked) return fail('policy', `Bị chặn bởi Allowed hosts, request chưa được gửi: ${blocked}`);

      const t0 = performance.now();
      try {
        r.response = await send(built.request, { timeout: settings.timeout, signal, allowHosts: env.allowHosts });
      } catch (e) {
        r.durationMs = Math.round(performance.now() - t0);
        r.transportError = e.message;
        if (signal?.aborted || e.code === 'cancelled') { // dừng chủ động: không phải lỗi nghiệp vụ của API
          r.status = 'SKIPPED';
          return fail('cancelled', 'Đã dừng khi request đang chạy, không có kết quả (request có thể đã tới máy chủ)');
        }
        return fail(e.code === 'permission' ? 'permission' : e.code === 'redirect' || e.code === 'policy' ? 'policy' : 'network', e.message);
      }
      r.durationMs = r.response.timeMs ?? Math.round(performance.now() - t0);
      r.warnings.push(...(r.response.warnings || []));
      delete r.response.warnings;
      if (r.response.truncated) r.warnings.push('Response vượt giới hạn đọc nên chỉ chấm trên phần đã nhận');

      let statusPass = true;
      if (kase.expect) {
        try {
          const ev = evaluate(kase.expect, r.response);
          statusPass = ev.statusPass;
          r.statusCheck = { expected: kase.expect.statusCodes, actual: r.response.status, pass: ev.statusPass };
          r.assertions = ev.assertions;
        } catch (e) {
          r.status = 'ERROR';
          return fail('evaluate', 'Lỗi khi chấm kết quả: ' + e.message);
        }
      }
      const save = (name, v, from) => {
        if (v === MISSING) { r.warnings.push(`Không lấy được ${from} để lưu vào {{${name}}}`); return; }
        vars[name] = v;
        varChanges++;
        r.extracted[name] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (isSecretVar(name) && v != null) secretValues.push(r.extracted[name]);
      };
      for (const [name, path] of Object.entries(kase.extract || {})) save(name, extract(path, r.response), path);
      for (const x of ctx.requestExtract || []) if (x.name) save(x.name, extractRule(x, r.response), x.source === 'header' ? `header ${x.path}` : x.source === 'status' ? 'status' : x.path || '$');
      let scriptError = '';
      if (scripts.post) {
        const out = await runScript('post', { request: built.request, response: { ...r.response, timeMs: r.durationMs }, vars });
        for (const t of out.tests || []) {
          r.assertions.push({ source: 'script', path: t.name, operator: 'pm.test', expected: '', actual: t.pass ? 'đạt' : t.error || '', pass: t.pass, reason: t.pass ? '' : t.error || '' });
        }
        scriptError = out.error || '';
      }
      const failed = r.assertions.filter(a => !a.pass);
      if (scriptError) {
        r.status = 'ERROR';
        return fail('script', `Post-response script lỗi: ${scriptError}`);
      }
      r.status = statusPass && !failed.length ? 'PASS' : 'FAIL';
      r.reason = [
        statusPass ? '' : `HTTP ${r.response.status} không thuộc ${kase.expect.statusCodes.join(', ')}`,
        ...failed.map(a => (a.source === 'script' ? `pm.test "${a.path}": ${a.reason}` : a.source === 'time' ? `Thời gian phản hồi ${a.actual} > ${a.expected}`
          : `${a.source === 'header' ? 'header ' : ''}${a.path} ${a.operator}${a.expected ? ' ' + a.expected : ''}: ${a.reason}`)),
      ].filter(Boolean).join('; ');
      return seal();
    }
    return { execute, isSecretVar, secretValues };
  }

  const skipped = (runId, kase, i, reason, evidenceId, extra = {}) => ({
    runId, index: i, caseId: kase.id, evidenceId, status: 'SKIPPED', reason, errorKind: null,
    startedAt: Date.now(), durationMs: null, request: null, response: null, statusCheck: null, assertions: [], warnings: [], extracted: {}, scriptLogs: [], redacted: false, ...extra,
  });

  // ---------- Chạy một suite (giữ nguyên API cũ) ----------
  // opts: { runId, suite, selected: Set<id>, base, env: { headers, vars: {k: v}, secretNames: Set, allowHosts }, settings: { timeout, concurrency, delay },
  //         send(request, { timeout, signal, allowHosts }), signal, onResult,
  //         scripts: { pre, post } (chữ), runScript(kind, payload, { onSend }) → kết quả từ sandbox }
  async function run(opts) {
    const { runId, suite, selected, env, settings, signal, onResult } = opts;
    const vars = { ...env.vars };
    const secretValues = Object.entries(env.vars).filter(([k]) => env.secretNames.has(k) || ApiRedact.isSecretName(k)).map(([, v]) => v);
    const ex = executor({ ...opts, vars, secretValues });
    const results = new Array(suite.cases.length);
    const evidenceId = i => `EV-${runId.replace(/^RUN-/, '')}-${pad(i + 1, 3)}`;
    const finish = (i, r) => { results[i] = r; onResult?.(r); };

    const queue = [];
    suite.cases.forEach((c, i) => {
      if (!selected.has(c.id)) finish(i, skipped(runId, c, i, 'Tester bỏ chọn case này', evidenceId(i)));
      else if (c.enabled === false) finish(i, skipped(runId, c, i, 'enabled=false' + (c.note ? ` — ${c.note}` : ''), evidenceId(i)));
      else queue.push(i);
    });

    // Song song chỉ an toàn khi không case nào truyền biến cho case khác
    const shares = suite.cases.some(c => c.extract) || /\.(set|unset)\(/.test(`${opts.scripts?.pre || ''}\n${opts.scripts?.post || ''}`);
    const n = shares ? 1 : Math.max(1, Math.min(settings.concurrency || 1, queue.length || 1));
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const i = queue[next++];
        const kase = suite.cases[i];
        if (signal.aborted) { finish(i, skipped(runId, kase, i, 'Đã dừng trước khi chạy tới case này', evidenceId(i))); continue; }
        finish(i, await ex.execute(kase, i, n > 1 ? { vars: { ...vars }, isolated: true } : {}));
        if (settings.delay && next < queue.length && !signal.aborted) await new Promise(r => setTimeout(r, settings.delay));
      }
    };
    await Promise.all(Array.from({ length: n }, worker));
    return results;
  }

  window.ApiRunner = { newRunId, build, evaluate, executor, run, skipped, resubstitute, normSend, caseInfo, extractRule, MUTATING, MISSING };
})();
