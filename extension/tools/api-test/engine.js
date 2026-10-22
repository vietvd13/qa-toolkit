// Domain: pipeline thực thi dùng chung cho nút Send (một request) và Runner (nhiều request / folder / collection / preset).
// Không có "HTTP engine" thứ hai: mọi lần gửi đều qua ApiRunner.executor → ApiTransport.send.
//   ApiEngine.compose(W, requestId, { envId, runtime })  → request mẫu của runner (collection headers → auth → request headers),
//                                                          biến đã gộp theo thứ tự ưu tiên, scripts (collection + request), allowed hosts
//   ApiEngine.send(W, requestId, { envId, timeout, signal }) → { result, changed: [tên biến runtime vừa đổi] }
//   ApiEngine.plan(W, opts)                              → kế hoạch chạy + lỗi chặn / cảnh báo (phân tích tĩnh, không gửi gì)
//   ApiEngine.run(plan, ctx)                             → { results, runtime } ; gọi ctx.onResult sau mỗi case
// Phụ thuộc: request dùng {{X}} mà request khác trong lần chạy sinh ra X (extract / pm.*.set) thì chạy sau request đó
// (sắp xếp topo, giữ thứ tự cây khi không có ràng buộc). Không chứng minh được an toàn → chạy tuần tự.
// Request chưa có test case → một case mặc định "gửi được và HTTP 2xx" (ghi rõ trong báo cáo là kỳ vọng mặc định).
(() => {
  const MUTATING = ApiRunner.MUTATING;
  const RANGE_2XX = Array.from({ length: 100 }, (_, i) => 200 + i);
  const pad = (n, w = 3) => String(n).padStart(w, '0');
  const joinScripts = (...parts) => {
    const list = parts.map(s => String(s || '').trim()).filter(Boolean);
    if (list.length < 2) return list[0] || '';
    // Mỗi phần trong một block riêng để const / let trùng tên không đụng nhau (giống Postman chạy lần lượt)
    return list.map((s, i) => `// ---- ${i === 0 ? 'collection' : 'request'} script ----\n{\n${s}\n}`).join('\n');
  };
  const methodOf = (node, kase) => String(kase?.requestOverride?.method || node.method || 'GET').toUpperCase();

  function authLayer(auth, vars, query) {
    if (auth.type === 'bearer' && auth.token) return { key: 'Authorization', value: `Bearer ${auth.token}` };
    if (auth.type === 'basic' && (auth.username || auth.password)) {
      const miss = new Set();
      const u = ApiCheck.substitute(auth.username, vars, miss), p = ApiCheck.substitute(auth.password, vars, miss);
      // Thiếu biến: để nguyên {{X}} để runner báo "chưa có giá trị", không mã hoá chuỗi sai
      if (miss.size) return { key: 'Authorization', value: `Basic ${[...miss].map(v => `{{${v}}}`).join('')}` };
      return { key: 'Authorization', value: 'Basic ' + btoa(unescape(encodeURIComponent(`${u}:${p}`))) };
    }
    if (auth.type === 'apikey' && auth.key) {
      if (auth.in === 'query') { if (!query.some(q => q.enabled !== false && q.key === auth.key)) query.push({ key: auth.key, value: auth.value, enabled: true }); return null; }
      return { key: auth.key, value: auth.value };
    }
    return null;
  }

  function compose(W, requestId, { envId = W.meta.activeEnvId, runtime } = {}) {
    const node = W.get(requestId);
    const chain = W.path(requestId);
    const col = chain[0]?.type === 'collection' ? chain[0] : null;
    const env = W.envs[envId] || null;
    const ls = W.layers(requestId, { envId, runtime });
    const { vars, from, secretNames } = W.resolveVars(ls);
    const { auth, from: authFrom } = W.effectiveAuth(requestId);
    const warnings = [];
    const on = rows => (rows || []).filter(r => r.enabled !== false && r.key).map(r => ({ key: r.key, value: r.value, enabled: true }));
    const query = on(node.query);
    const headers = on(col?.headers);
    // Auth kế thừa (vd Bearer {{TOKEN}} của collection) mà biến của nó do chính request này tạo ra (request Login):
    // không gửi Authorization thay vì báo thiếu biến
    const authVars = [auth.token, auth.username, auth.password, auth.value].flatMap(t => ApiCheck.varsIn(t)).filter(v => !(v in vars));
    const inherited = authFrom && authFrom.id !== node.id;
    const selfMade = inherited && authVars.length && authVars.every(v => W.varFlow(requestId, { envId }).makes.has(v));
    if (selfMade) warnings.push(`Không gửi Authorization kế thừa từ ${authFrom.name}: ${authVars.map(v => `{{${v}}}`).join(', ')} do chính request này tạo ra`);
    const ah = selfMade ? null : authLayer(auth, vars, query);
    if (ah && !node.headers.some(h => h.enabled !== false && h.key.toLowerCase() === ah.key.toLowerCase())) headers.push({ ...ah, enabled: true });
    headers.push(...on(node.headers));
    const hasCt = headers.some(h => h.key.toLowerCase() === 'content-type');
    let body = null, baseError = null;
    const b = node.body;
    if (b.mode === 'json' && b.text.trim()) {
      try { body = { mode: 'json', value: JSON.parse(b.text) }; } catch (e) {
        // {{biến}} viết ngoài dấu nháy (vd "id": {{ID}}) làm JSON "sai" trước khi thay biến → gửi nguyên văn
        if (/\{\{/.test(b.text)) {
          body = { mode: 'raw', value: b.text };
          if (!hasCt) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
          warnings.push('Body JSON chỉ hợp lệ sau khi thay biến nên được gửi nguyên văn (raw)');
        } else baseError = 'JSON body không hợp lệ: ' + e.message;
      }
    } else if (['text', 'xml', 'raw'].includes(b.mode) && b.text !== '') {
      body = { mode: 'raw', value: b.text };
      if (!hasCt) headers.push({ key: 'Content-Type', value: b.mode === 'xml' ? 'application/xml' : 'text/plain;charset=UTF-8', enabled: true });
    } else if (b.mode === 'form-urlencoded' && b.text !== '') body = { mode: 'form-urlencoded', value: b.text };
    if (!node.url) baseError = baseError || 'Request chưa có URL';
    // Giá trị cần che: biến secret / tên giống bí mật, token / password / API key ghi thẳng
    const secretValues = [
      ...Object.entries(vars).filter(([k]) => secretNames.has(k) || ApiRedact.isSecretName(k)).map(([, v]) => v),
      ...[auth.token, auth.password, auth.type === 'apikey' ? auth.value : ''].filter(v => v && !/\{\{/.test(v)),
      ...[...node.headers, ...(col?.headers || []), ...(env?.headers || [])].filter(h => ApiWorkspace.isLiteralSecret(h.key, h.value)).map(h => h.value.replace(/^(Bearer|Basic|Token)\s+/i, '')),
    ].filter(v => v != null && String(v).length >= 4).map(String);
    return {
      node, chain, collection: col, env, warnings, baseError, vars, from, secretNames, secretValues, auth, authFrom, authSkipped: selfMade ? authVars : [],
      base: { method: node.method, url: node.url, query, headers, body },
      envLayer: { headers: on(env?.headers) },
      allowHosts: W.allowHosts(envId),
      scripts: { pre: joinScripts(col?.scripts.pre, node.scripts.pre), post: joinScripts(col?.scripts.post, node.scripts.post) },
      meta: {
        requestId, requestName: node.name, method: node.method,
        collectionName: col?.name || '', folderPath: chain.slice(1, -1).map(x => x.name).join(' / '),
      },
    };
  }
  // URL đích sau khi thay biến (null nếu còn thiếu biến)
  function targetUrl(c) {
    const miss = new Set();
    const u = ApiCheck.substitute(c.base.url, c.vars, miss);
    return miss.size ? null : u;
  }

  function makeExecutor(c, { runId, vars, secretValues, timeout, signal, evidenceId }) {
    return ApiRunner.executor({
      runId, base: c.base, env: { headers: c.envLayer.headers, secretNames: c.secretNames, allowHosts: c.allowHosts },
      vars, secretValues, settings: { timeout }, send: ApiTransport.send, signal, scripts: c.scripts, runScript: ApiScript.run,
      requestExtract: c.node.extract, evidenceId, meta: c.meta,
    });
  }
  // Biến runtime: những gì khác với lúc bắt đầu request (extract, script set) → mang sang request sau
  function carryRuntime(runtime, before, after) {
    const changed = [];
    for (const [k, v] of Object.entries(after)) if (before[k] !== v) { runtime[k] = v; changed.push(k); }
    for (const k of Object.keys(before)) if (!(k in after) && k in runtime) { delete runtime[k]; changed.push(k); }
    return changed;
  }

  // ---------- Send ----------
  async function send(W, requestId, { envId = W.meta.activeEnvId, timeout = 30000, signal } = {}) {
    const runtime = { ...W.runtime() };
    const c = compose(W, requestId, { envId, runtime });
    const runId = ApiRunner.newRunId();
    if (c.baseError) {
      const r = ApiRunner.skipped(runId, { id: 'SEND' }, 0, '', 'SEND', { ...c.meta, status: 'ERROR', errorKind: 'build', reason: c.baseError + ' (request chưa được gửi)' });
      return { result: r, changed: [], compose: c };
    }
    const vars = { ...c.vars }, before = { ...vars };
    const ex = makeExecutor(c, { runId, vars, secretValues: [...c.secretValues], timeout, signal, evidenceId: () => 'SEND' });
    const result = await ex.execute({ id: 'SEND', name: c.node.name, priority: 'P2', enabled: true, expect: null }, 0);
    result.warnings.unshift(...c.warnings);
    const changed = carryRuntime(runtime, before, vars);
    if (changed.length) W.setRuntime(runtime);
    return { result, changed, compose: c };
  }

  // ---------- Kế hoạch ----------
  const defaultCase = n => ({ id: 'DEFAULT', name: `${n.name} (kiểm tra mặc định)`, group: '', priority: 'P2', enabled: true, synthetic: true, expect: { statusCodes: RANGE_2XX, assertions: [] } });
  const needsReview = c => /^\s*NEEDS_REVIEW/i.test(c.note || '');

  // Request theo đúng thứ tự cây của collection; targets rỗng = cả collection
  function requestsFor(W, collectionId, targets = []) {
    const all = W.requestsUnder(collectionId);
    if (!targets.length) return all.map(n => n.id);
    const set = new Set(targets);
    return all.filter(n => W.path(n.id).some(x => set.has(x.id))).map(n => n.id);
  }

  // opts: { requestIds, envId, priorities: [], only: Set<"reqId::caseId"> (chạy lại), mode: 'sequential'|'parallel', runtime (biến runtime ban đầu) }
  function plan(W, opts) {
    const envId = opts.envId ?? W.meta.activeEnvId;
    const env = W.envs[envId] || null;
    const runtime = { ...(opts.runtime || {}) };
    const errors = [], warnings = [];
    const prio = new Set(opts.priorities || []);
    const items = [];
    for (const id of opts.requestIds) {
      const node = W.get(id);
      if (node?.type !== 'request') continue;
      const s = W.suite(id);
      const list = s ? s.cases : [defaultCase(node)];
      const cases = list.map(kase => {
        let skip = '';
        if (opts.only && !opts.only.has(`${id}::${kase.id}`)) skip = 'Không nằm trong lần chạy lại';
        else if (kase.enabled === false) skip = 'enabled=false' + (kase.note ? ` — ${kase.note}` : '');
        else if (prio.size && !kase.synthetic && !prio.has(kase.priority)) skip = `Priority ${kase.priority} không nằm trong bộ lọc`;
        return { kase, skip };
      });
      if (opts.only && !cases.some(x => !x.skip)) continue;
      const flow = W.varFlow(id, { envId });
      items.push({ requestId: id, node, synthetic: !s, cases, uses: flow.uses, scriptUses: flow.scriptUses, caseUses: flow.caseUses, makes: flow.makes, deps: new Set(), needs: new Map() });
    }
    if (!items.length) errors.push({ msg: 'Chưa có request nào để chạy', fix: { kind: 'scope' } });

    // Phụ thuộc giữa các request trong lần chạy
    const byId = new Map(items.map(x => [x.requestId, x]));
    for (const x of items) {
      for (const v of new Set([...x.uses, ...x.caseUses, ...x.scriptUses])) {
        if (x.makes.has(v)) continue;
        for (const y of items) {
          if (y === x || !y.makes.has(v)) continue;
          x.deps.add(y.requestId);
          // Chỉ biến dùng trong request (URL / header / body / auth) mới bắt buộc phải có trước khi gửi
          if (x.uses.has(v) && !x.needs.has(v)) x.needs.set(v, y.requestId);
        }
      }
    }
    // Sắp xếp topo, ưu tiên thứ tự cây
    const index = new Map(items.map((x, i) => [x.requestId, i]));
    const done = new Set(), ordered = [];
    while (ordered.length < items.length) {
      const next = items.filter(x => !done.has(x.requestId) && [...x.deps].every(d => done.has(d))).sort((a, b) => index.get(a.requestId) - index.get(b.requestId))[0];
      if (!next) {
        const rest = items.filter(x => !done.has(x.requestId));
        errors.push({ msg: `Phụ thuộc vòng tròn giữa: ${rest.map(x => `"${x.node.name}"`).join(', ')} (request này cần biến do request kia sinh ra và ngược lại)`, fix: { kind: 'request', requestId: rest[0].requestId } });
        ordered.push(...rest);
        break;
      }
      done.add(next.requestId);
      ordered.push(next);
    }
    const reordered = ordered.some((x, i) => items[i] !== x);
    if (reordered) {
      const moved = ordered.filter(x => [...x.deps].some(d => index.get(d) > index.get(x.requestId)));
      warnings.push({ msg: `Đã xếp lại thứ tự theo phụ thuộc: ${moved.map(x => `"${x.node.name}" chạy sau ${[...x.deps].map(d => `"${byId.get(d).node.name}"`).join(', ')}`).join('; ')}` });
    }

    // Kiểm tra từng request (biến, host, body)
    const missingByVar = new Map();
    const hostsBlocked = new Map();
    const madeBefore = new Set();
    let mut = 0, runnable = 0, review = 0;
    for (const x of ordered) {
      const c = compose(W, x.requestId, { envId, runtime });
      x.compose = c;
      const sel = x.cases.filter(k => !k.skip);
      runnable += sel.length;
      mut += sel.filter(k => MUTATING.includes(methodOf(x.node, k.kase))).length;
      review += sel.filter(k => needsReview(k.kase)).length;
      if (c.baseError) errors.push({ msg: `"${x.node.name}": ${c.baseError}`, fix: { kind: 'body', requestId: x.requestId } });
      for (const v of x.uses) {
        if (v in c.vars || x.makes.has(v) || madeBefore.has(v)) continue;
        if (!missingByVar.has(v)) missingByVar.set(v, { requests: [], kind: 'request' });
        missingByVar.get(v).kind = 'request'; // dùng trong request ở bất kỳ đâu → lỗi chặn
        missingByVar.get(v).requests.push(x.node.name);
      }
      for (const [list, kind] of [[x.caseUses, 'case'], [x.scriptUses, 'script']]) {
        for (const v of list) {
          if (v in c.vars || x.makes.has(v) || madeBefore.has(v) || x.uses.has(v)) continue;
          if (!missingByVar.has(v)) missingByVar.set(v, { requests: [], kind });
          missingByVar.get(v).requests.push(x.node.name);
        }
      }
      for (const v of x.makes) madeBefore.add(v);
      const url = targetUrl(c);
      if (url) {
        const blocked = ApiPolicy.check(url, c.allowHosts);
        if (blocked) {
          let host = '';
          try { host = new URL(url).host.toLowerCase(); } catch {}
          if (!hostsBlocked.has(host)) hostsBlocked.set(host, { reason: blocked, requests: [], url });
          hostsBlocked.get(host).requests.push(x.node.name);
        }
      }
    }
    for (const [v, info] of missingByVar) {
      const prod = W.producers(v).filter(p => !byId.has(p.id));
      const hint = prod.length ? ` Request "${prod[0].name}" sinh ra biến này: thêm nó vào lần chạy, hoặc nhập giá trị.` : ' Nhập giá trị trong Environment.';
      const item = { msg: `Chưa có giá trị cho biến {{${v}}} (dùng ở ${info.requests.slice(0, 3).map(n => `"${n}"`).join(', ')}${info.requests.length > 3 ? '…' : ''}).${hint}`, fix: { kind: 'var', name: v, envId } };
      if (info.kind === 'case') warnings.push({ ...item, msg: item.msg.replace('Chưa có giá trị', 'Một số case dùng biến chưa có giá trị') + ' Case đó sẽ ERROR.' });
      else if (info.kind === 'script') warnings.push({ ...item, msg: item.msg.replace('Chưa có giá trị cho biến', 'Script đọc biến chưa có giá trị') + ' Script sẽ nhận undefined.' });
      else errors.push(item);
    }
    for (const [host, info] of hostsBlocked) {
      errors.push({ msg: `${info.reason} (${info.requests.slice(0, 3).map(n => `"${n}"`).join(', ')}${info.requests.length > 3 ? '…' : ''})`, fix: host && !/metadata|giao thức|user:password|URL không hợp lệ/i.test(info.reason) ? { kind: 'host', host, envId } : { kind: 'env', envId } });
    }
    if (items.length && !runnable && !opts.only) errors.push({ msg: 'Không có case nào sẽ chạy (đều đang tắt hoặc bị lọc)', fix: { kind: 'scope' } });
    if (!env) warnings.push({ msg: 'Chưa chọn environment: chỉ dùng biến Collection / Globals.', fix: { kind: 'env' } });
    else if (W.isProdEnv(env)) warnings.push({ msg: `Đang chạy trên PRODUCTION (${env.name})${mut ? ` · ${mut} case ghi dữ liệu (POST/PUT/PATCH/DELETE)` : ''}. Tool sẽ hỏi xác nhận.`, kind: 'prod', fix: { kind: 'env' } });
    else if (mut) warnings.push({ msg: `${mut} case ghi dữ liệu (POST/PUT/PATCH/DELETE) trên ${env.name}. Tool hỏi xác nhận trước khi gửi.` });
    if (review) warnings.push({ msg: `${review} case NEEDS_REVIEW đang được bật: Expected có thể chưa chính xác.`, fix: { kind: 'review' } });
    const synth = items.filter(x => x.synthetic).length;
    if (synth) warnings.push({ msg: `${synth} request chưa có test case: chạy một lần với kỳ vọng mặc định "HTTP 2xx".`, kind: 'info' });
    // Song song chỉ khi request không truyền biến cho ai và không cần biến của ai
    for (const x of ordered) x.parallelSafe = opts.mode === 'parallel' && !x.makes.size && !x.deps.size && !items.some(y => y !== x && y.deps.has(x.requestId));
    if (opts.mode === 'parallel' && ordered.some(x => !x.parallelSafe)) warnings.push({ msg: 'Các request có truyền biến (extract / script set) vẫn chạy tuần tự để đảm bảo thứ tự.', kind: 'info' });

    return {
      envId, envName: env?.name || '(không có)', isProd: W.isProdEnv(env), items: ordered, errors, warnings,
      counts: { requests: ordered.length, cases: runnable, mutating: mut, total: ordered.reduce((s, x) => s + x.cases.length, 0) },
      mutatingMethods: [...new Set(ordered.flatMap(x => x.cases.filter(k => !k.skip).map(k => methodOf(x.node, k.kase)).filter(m => MUTATING.includes(m))))],
      hosts: [...new Set(ordered.map(x => { try { return new URL(targetUrl(x.compose)).host; } catch { return null; } }).filter(Boolean))],
      runtime,
    };
  }

  // ---------- Chạy ----------
  // ctx: { W, runId, settings: { timeout, delay, concurrency, stopOnCritical, retryErrors }, signal, onResult(r), onItem(item) }
  async function run(p, ctx) {
    const { W, runId, settings, signal } = ctx;
    const runtime = { ...p.runtime };
    const secretValues = [];
    let seq = 0;
    const evidenceId = () => `EV-${runId.replace(/^RUN-/, '')}-${pad(++seq)}`;
    const results = [];
    const emit = r => { r.index = results.length; results.push(r); ctx.onResult?.(r); };
    let stopReason = '';
    for (const x of p.items) {
      ctx.onItem?.(x);
      const c = compose(W, x.requestId, { envId: p.envId, runtime });
      secretValues.push(...c.secretValues);
      const kaseOf = k => ({ ...JSON.parse(JSON.stringify(k)), ...(k.synthetic ? { synthetic: true } : {}) });
      const skip = (k, reason, extra = {}) => emit(ApiRunner.skipped(runId, k, 0, reason, evidenceId(), { ...c.meta, kase: kaseOf(k), method: methodOf(x.node, k), ...extra }));
      const errorAll = (kind, reason) => {
        for (const { kase, skip: why } of x.cases) {
          if (why) skip(kase, why);
          else skip(kase, reason, { status: 'ERROR', errorKind: kind, statusCheck: { expected: kase.expect.statusCodes, actual: null, pass: false } });
        }
      };
      if (signal.aborted) { for (const { kase } of x.cases) skip(kase, 'Đã dừng trước khi chạy tới case này', { errorKind: 'cancelled' }); continue; }
      if (stopReason) { for (const { kase } of x.cases) skip(kase, stopReason); continue; }
      if (c.baseError) { errorAll('build', `${c.baseError} (request chưa được gửi)`); continue; }
      // Request phụ thuộc chưa lấy được biến → không gửi (tránh gửi request thiếu token / id)
      const unmet = [...x.needs].filter(([v]) => !(v in c.vars));
      if (unmet.length) {
        errorAll('dependency', unmet.map(([v, from]) => `Chưa có giá trị cho {{${v}}}: request "${W.get(from)?.name || from}" chạy trước không lấy được giá trị`).join('; ') + '. Request này chưa được gửi.');
        continue;
      }
      const vars = { ...c.vars }, before = { ...vars };
      const ex = makeExecutor(c, { runId, vars, secretValues, timeout: settings.timeout, signal, evidenceId });
      const queue = x.cases.filter(k => !k.skip);
      const parallel = x.parallelSafe && (settings.concurrency || 1) > 1 && queue.length > 1;
      const once = async ({ kase }) => {
        if (signal.aborted) { skip(kase, 'Đã dừng trước khi chạy tới case này', { errorKind: 'cancelled' }); return; }
        if (stopReason) { skip(kase, stopReason); return; }
        const opt = parallel ? { vars: { ...vars }, isolated: true } : {};
        let r = await ex.execute(kase, 0, opt);
        // Thử lại lỗi mạng / timeout cho method không ghi dữ liệu (theo preset)
        const m = methodOf(x.node, kase);
        for (let n = 1; n <= (settings.retryErrors || 0) && r.status === 'ERROR' && r.errorKind === 'network' && !MUTATING.includes(m) && !signal.aborted; n++) {
          const prev = r.reason;
          r = await ex.execute(kase, 0, opt);
          r.warnings.unshift(`Thử lại lần ${n} sau lỗi: ${prev}`);
        }
        r.kase = kaseOf(kase);
        r.method = m;
        if (c.warnings.length) r.warnings.unshift(...c.warnings);
        emit(r);
        if (settings.stopOnCritical && kase.priority === 'P0' && (r.status === 'FAIL' || r.status === 'ERROR')) {
          stopReason = `Dừng sớm: case P0 ${kase.id} của "${x.node.name}" ${r.status}`;
        }
      };
      if (parallel) {
        for (const k of x.cases) if (k.skip) skip(k.kase, k.skip);
        let next = 0;
        const worker = async () => { while (next < queue.length) await once(queue[next++]); };
        await Promise.all(Array.from({ length: Math.min(settings.concurrency, queue.length) }, worker));
      } else {
        let sent = 0;
        for (const k of x.cases) { // giữ đúng thứ tự case trong suite
          if (k.skip) { skip(k.kase, k.skip); continue; }
          if (sent++ && settings.delay && !signal.aborted) await new Promise(res => setTimeout(res, settings.delay));
          await once(k);
        }
      }
      carryRuntime(runtime, before, vars);
      if (settings.delay && !signal.aborted) await new Promise(res => setTimeout(res, settings.delay));
    }
    return { results, runtime };
  }

  window.ApiEngine = { compose, targetUrl, send, plan, run, requestsFor, defaultCase, methodOf, MUTATING };
})();
