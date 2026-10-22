// Domain: workspace của Kiểm thử API — Collection › Folder › Request (+ Test Suite, Scripts), Environment, Run Preset.
// Mọi thực thể có id ổn định (không dùng vị trí trong mảng làm định danh). Test Suite JSON v1.0 (schema.js) vẫn là một
// hợp đồng riêng: workspace chỉ GẮN một suite vào một request, không đổi cấu trúc suite.
//   ApiWorkspace.load(records, session, { put, remove, setSession }) → W (model + thao tác, tự gọi put/remove để lưu)
//   ApiWorkspace.fresh()                       → records của workspace mới (DEV / STAGING / PROD, chưa có collection)
//   ApiWorkspace.fromLegacy(v2, suiteText)     → dữ liệu export từ bản cũ (localStorage "api-test-v2") để import
//   ApiWorkspace.validateImport(obj)           → { data, errors, warnings, summary }
// Bản ghi lưu (store.js thêm tiền tố): meta · n.<id> (collection / folder / request) · e.<id> (environment) ·
// p.<id> (preset) · s.<requestId> (suite) · run.last (kết quả gần nhất, đã che).
// Secret KHÔNG ghi vào bộ nhớ bền: biến secret, header / query có tên bí mật ghi thẳng giá trị, token / password / API key
// trong Authorization được tách sang session (ApiStore.setSession) — đóng trình duyệt là mất, phải nhập lại.
// Thứ tự ưu tiên biến (cao → thấp): Runtime (extract, script trong lần chạy / phiên) › Environment › Collection › Globals.
(() => {
  const FORMAT = 'qa-api-workspace';
  const VERSION = 1;
  const BODY_MODES = ['none', 'json', 'text', 'xml', 'raw', 'form-urlencoded'];
  const AUTH_TYPES = ['inherit', 'none', 'bearer', 'basic', 'apikey'];
  const ENV_COLORS = ['green', 'blue', 'yellow', 'red', 'gray'];
  const RUN_STORE_LIMIT = 2_500_000; // ký tự JSON tối đa của kết quả gần nhất lưu trên máy

  const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
  const isLiteralSecret = (k, v) => ApiRedact.isSecretName(k) && !!v && !/\{\{/.test(v);

  // ---------- Chuẩn hoá (dữ liệu hỏng một phần vẫn đọc được phần còn lại) ----------
  const kvRows = rows => (Array.isArray(rows) ? rows : []).filter(isObj).map(r => {
    const o = { key: str(r.key).trim(), value: str(r.value), enabled: r.enabled !== false };
    if (r.secret) o.secret = true;
    if (r.description) o.description = str(r.description);
    return o;
  });
  function normAuth(a, allowInherit) {
    const t = isObj(a) && AUTH_TYPES.includes(a.type) ? a.type : allowInherit ? 'inherit' : 'none';
    if (t === 'inherit' && !allowInherit) return { type: 'none' };
    if (t === 'bearer') return { type: t, token: str(a.token) };
    if (t === 'basic') return { type: t, username: str(a.username), password: str(a.password) };
    if (t === 'apikey') return { type: t, key: str(a.key, 'X-API-Key') || 'X-API-Key', value: str(a.value), in: a.in === 'query' ? 'query' : 'header' };
    return { type: t };
  }
  const normScripts = s => ({ pre: str(s?.pre), post: str(s?.post) });
  const normExtract = list => (Array.isArray(list) ? list : []).filter(isObj).map(x => ({
    name: str(x.name).trim(), source: ['body', 'header', 'status'].includes(x.source) ? x.source : 'body', path: str(x.path, '$'),
  })).filter(x => x.name);
  function normNode(n) {
    if (!isObj(n) || typeof n.id !== 'string' || !['collection', 'folder', 'request'].includes(n.type)) return null;
    const base = {
      id: n.id, type: n.type, name: str(n.name).trim() || (n.type === 'request' ? 'Request mới' : n.type === 'folder' ? 'Folder mới' : 'Collection mới'),
      parentId: n.type === 'collection' ? null : typeof n.parentId === 'string' ? n.parentId : null,
      enabled: n.enabled !== false, description: str(n.description), createdAt: Number(n.createdAt) || Date.now(), updatedAt: Number(n.updatedAt) || Date.now(),
    };
    if (n.type === 'collection') return { ...base, children: Array.isArray(n.children) ? n.children.filter(x => typeof x === 'string') : [], vars: kvRows(n.vars), headers: kvRows(n.headers), auth: normAuth(n.auth, false), scripts: normScripts(n.scripts) };
    if (n.type === 'folder') return { ...base, children: Array.isArray(n.children) ? n.children.filter(x => typeof x === 'string') : [], auth: normAuth(n.auth, true) };
    const body = isObj(n.body) ? { mode: BODY_MODES.includes(n.body.mode) ? n.body.mode : 'none', text: str(n.body.text) } : { mode: 'none', text: '' };
    return {
      ...base, method: ApiSchema.METHODS.includes(str(n.method).toUpperCase()) ? str(n.method).toUpperCase() : 'GET', url: str(n.url).trim(),
      query: kvRows(n.query), headers: kvRows(n.headers), body, auth: normAuth(n.auth, true), scripts: normScripts(n.scripts),
      extract: normExtract(n.extract), meta: isObj(n.meta) ? clone(n.meta) : {},
    };
  }
  function normEnv(e) {
    if (!isObj(e) || typeof e.id !== 'string') return null;
    return {
      id: e.id, name: str(e.name).trim() || 'Environment', color: ENV_COLORS.includes(e.color) ? e.color : 'gray', isProd: !!e.isProd,
      vars: kvRows(e.vars), headers: kvRows(e.headers), allowHosts: str(e.allowHosts), createdAt: Number(e.createdAt) || Date.now(), updatedAt: Number(e.updatedAt) || Date.now(),
    };
  }
  function normPreset(p) {
    if (!isObj(p) || typeof p.id !== 'string') return null;
    const n = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
    return {
      id: p.id, name: str(p.name).trim() || 'Preset', collectionId: typeof p.collectionId === 'string' ? p.collectionId : null,
      targets: Array.isArray(p.targets) ? p.targets.filter(x => typeof x === 'string') : [], envId: typeof p.envId === 'string' ? p.envId : null,
      mode: p.mode === 'parallel' ? 'parallel' : 'sequential', concurrency: n(p.concurrency, 1, 5, 3), timeout: n(p.timeout, 1000, 120000, 30000), delay: n(p.delay, 0, 60000, 0),
      priorities: Array.isArray(p.priorities) ? p.priorities.filter(x => ApiSchema.PRIORITIES.includes(x)) : [],
      stopOnCritical: !!p.stopOnCritical, retryErrors: n(p.retryErrors, 0, 2, 0), useSessionVars: !!p.useSessionVars,
      createdAt: Number(p.createdAt) || Date.now(), updatedAt: Number(p.updatedAt) || Date.now(),
    };
  }
  function normMeta(m) {
    m = isObj(m) ? m : {};
    return {
      version: VERSION, activeEnvId: typeof m.activeEnvId === 'string' ? m.activeEnvId : null,
      order: Array.isArray(m.order) ? m.order.filter(x => typeof x === 'string') : [],
      envOrder: Array.isArray(m.envOrder) ? m.envOrder.filter(x => typeof x === 'string') : [],
      globals: { vars: kvRows(m.globals?.vars), allowHosts: str(m.globals?.allowHosts) },
      settings: { timeout: Number(m.settings?.timeout) || 30000 },
      ui: isObj(m.ui) ? m.ui : {}, legacyMigrated: !!m.legacyMigrated, createdAt: Number(m.createdAt) || Date.now(),
    };
  }

  // ---------- Secret: tách ra / ghép lại ----------
  const AUTH_SECRET = { bearer: ['token'], basic: ['password'], apikey: ['value'] };
  function splitSecrets(obj) {
    const out = clone(obj), sec = {};
    for (const [list, p] of [[out.headers, 'h'], [out.query, 'q']]) for (const r of list || []) if (isLiteralSecret(r.key, r.value)) { sec[`${p}:${r.key.toLowerCase()}`] = r.value; r.value = ''; }
    for (const v of out.vars || []) if (v.secret && v.value) { sec[`v:${v.key}`] = v.value; v.value = ''; }
    for (const f of AUTH_SECRET[out.auth?.type] || []) if (out.auth[f] && !/\{\{/.test(out.auth[f])) { sec[`a:${f}`] = out.auth[f]; out.auth[f] = ''; }
    return { out, sec };
  }
  function mergeSecrets(obj, sec) {
    if (!sec) return;
    for (const [list, p] of [[obj.headers, 'h'], [obj.query, 'q']]) for (const r of list || []) { const v = sec[`${p}:${r.key.toLowerCase()}`]; if (v != null && !r.value) r.value = v; }
    for (const v of obj.vars || []) { const s = sec[`v:${v.key}`]; if (s != null && !v.value) v.value = s; }
    for (const f of AUTH_SECRET[obj.auth?.type] || []) { const s = sec[`a:${f}`]; if (s != null && !obj.auth[f]) obj.auth[f] = s; }
  }

  // ---------- Biến dùng trong chữ / script ----------
  const varsIn = text => ApiCheck.varsIn(text);
  const scriptSets = code => [...String(code || '').matchAll(/\.set\(\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1]);
  const scriptGets = code => [...new Set([...[...String(code || '').matchAll(/pm\.(?:environment|variables|collectionVariables|globals)\.get\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map(m => m[1]), ...varsIn(code)])].filter(v => !v.startsWith('$'));

  function fresh() {
    const t = Date.now();
    const envs = [['DEV', 'green', false], ['STAGING', 'yellow', false], ['PROD', 'red', true]].map(([name, color, isProd], i) => ({
      id: `env_default_${i}`, name, color, isProd, vars: [{ key: 'baseUrl', value: '', enabled: true }], headers: [], allowHosts: '', createdAt: t, updatedAt: t,
    }));
    const records = { meta: { ...normMeta({}), activeEnvId: envs[0].id, envOrder: envs.map(e => e.id) } };
    for (const e of envs) records['e.' + e.id] = e;
    return records;
  }

  function load(records, session, io) {
    const ws = { meta: normMeta(records.meta), nodes: {}, envs: {}, presets: {}, suites: {}, lastRun: null };
    const problems = [];
    session = isObj(session) ? session : {};
    session.secrets = isObj(session.secrets) ? session.secrets : {};
    session.runtime = isObj(session.runtime) ? session.runtime : {};
    for (const [k, v] of Object.entries(records)) {
      if (k === 'meta') continue;
      if (v?.__corrupt) { problems.push(`Bản ghi ${k} hỏng, đã bỏ qua`); continue; }
      if (k.startsWith('n.')) { const n = normNode(v); if (n) ws.nodes[n.id] = n; else problems.push(`Bỏ qua mục không hợp lệ ${k}`); }
      else if (k.startsWith('e.')) { const e = normEnv(v); if (e) ws.envs[e.id] = e; else problems.push(`Bỏ qua environment không hợp lệ ${k}`); }
      else if (k.startsWith('p.')) { const p = normPreset(v); if (p) ws.presets[p.id] = p; }
      else if (k.startsWith('s.')) {
        const { suite } = ApiSchema.validate(v);
        if (suite) ws.suites[k.slice(2)] = suite; else problems.push(`Test suite của request ${k.slice(2)} không hợp lệ, đã bỏ qua`);
      } else if (k === 'run.last' && isObj(v) && Array.isArray(v.results)) ws.lastRun = v;
    }
    const W = model(ws, session, io);
    W.repair(problems);
    for (const n of Object.values(ws.nodes)) mergeSecrets(n, session.secrets['n.' + n.id]);
    for (const e of Object.values(ws.envs)) mergeSecrets(e, session.secrets['e.' + e.id]);
    mergeSecrets(ws.meta.globals, session.secrets.g);
    W.problems = problems;
    return W;
  }

  function model(ws, session, io) {
    const put = io?.put || (() => {}), del = io?.remove || (() => {});
    const saveSession = () => io?.setSession?.(session);

    // ----- Lưu -----
    function saveNode(id) {
      const n = ws.nodes[id];
      if (!n) return;
      const { out, sec } = splitSecrets(n);
      put('n.' + id, out);
      if (Object.keys(sec).length) session.secrets['n.' + id] = sec; else delete session.secrets['n.' + id];
      saveSession();
    }
    function saveEnv(id) {
      const e = ws.envs[id];
      if (!e) return;
      const { out, sec } = splitSecrets(e);
      put('e.' + id, out);
      if (Object.keys(sec).length) session.secrets['e.' + id] = sec; else delete session.secrets['e.' + id];
      saveSession();
    }
    function saveMeta() {
      const { out, sec } = splitSecrets(ws.meta.globals);
      put('meta', { ...ws.meta, globals: out });
      if (Object.keys(sec).length) session.secrets.g = sec; else delete session.secrets.g;
      saveSession();
    }
    const savePreset = id => ws.presets[id] && put('p.' + id, ws.presets[id]);
    const now = () => Date.now();

    // ----- Cây -----
    const get = id => ws.nodes[id] || null;
    const children = id => (get(id)?.children || []).map(get).filter(Boolean);
    const collections = () => ws.meta.order.map(get).filter(n => n?.type === 'collection');
    const drafts = () => Object.values(ws.nodes).filter(n => n.type === 'request' && !n.parentId).sort((a, b) => a.createdAt - b.createdAt);
    const parentOf = id => (get(id)?.parentId ? get(get(id).parentId) : null);
    function path(id) {
      const out = [];
      for (let n = get(id), guard = 0; n && guard < 64; n = n.parentId ? get(n.parentId) : null, guard++) out.unshift(n);
      return out;
    }
    const collectionOf = id => { const p = path(id); return p[0]?.type === 'collection' ? p[0] : null; };
    function descendants(id) {
      const out = [];
      const walk = n => { for (const c of children(n.id)) { out.push(c); walk(c); } };
      const n = get(id);
      if (n) walk(n);
      return out;
    }
    // Request dưới một node theo đúng thứ tự cây; bỏ nhánh đang tắt (enabled=false) trừ khi includeDisabled
    function requestsUnder(id, { includeDisabled = false } = {}) {
      const n = get(id);
      if (!n) return [];
      if (n.type === 'request') return [n];
      const out = [];
      const walk = x => {
        for (const c of children(x.id)) {
          if (!includeDisabled && c.enabled === false) continue;
          if (c.type === 'request') out.push(c); else walk(c);
        }
      };
      walk(n);
      return out;
    }
    const siblings = id => { const n = get(id); if (!n) return null; if (n.type === 'collection') return ws.meta.order; return n.parentId ? get(n.parentId)?.children || null : null; };

    function repair(problems) {
      // Collection thiếu trong thứ tự → thêm vào cuối; id trong thứ tự không còn → bỏ
      for (const n of Object.values(ws.nodes)) if (n.type === 'collection' && !ws.meta.order.includes(n.id)) ws.meta.order.push(n.id);
      ws.meta.order = ws.meta.order.filter((id, i, a) => get(id)?.type === 'collection' && a.indexOf(id) === i);
      // Cha mất → đưa request về "Chưa lưu", folder mồ côi bị bỏ (lặp vì bỏ folder làm con của nó mồ côi theo)
      for (let changed = true, guard = 0; changed && guard < 50; guard++) {
        changed = false;
        for (const n of Object.values(ws.nodes)) {
          if (n.type === 'collection') continue;
          const p = n.parentId ? get(n.parentId) : null;
          if (p && (p.type === 'collection' || p.type === 'folder')) continue;
          if (n.type === 'request') {
            if (n.parentId) { problems.push(`Request "${n.name}" mất thư mục cha, đã chuyển vào Chưa lưu`); n.parentId = null; changed = true; }
          } else {
            delete ws.nodes[n.id];
            problems.push(`Folder "${n.name}" mất collection, đã bỏ (request bên trong chuyển vào Chưa lưu)`);
            changed = true;
          }
        }
      }
      // children khớp với parentId (parentId là chuẩn về quan hệ, children giữ thứ tự)
      for (const p of Object.values(ws.nodes)) {
        if (!p.children) continue;
        const kids = p.children.filter((id, i, a) => get(id)?.parentId === p.id && a.indexOf(id) === i);
        for (const n of Object.values(ws.nodes)) if (n.parentId === p.id && !kids.includes(n.id)) kids.push(n.id);
        p.children = kids;
      }
      for (const id of Object.keys(ws.suites)) if (get(id)?.type !== 'request') delete ws.suites[id];
      for (const e of Object.values(ws.envs)) if (!ws.meta.envOrder.includes(e.id)) ws.meta.envOrder.push(e.id);
      ws.meta.envOrder = ws.meta.envOrder.filter((id, i, a) => ws.envs[id] && a.indexOf(id) === i);
      if (ws.meta.activeEnvId && !ws.envs[ws.meta.activeEnvId]) ws.meta.activeEnvId = ws.meta.envOrder[0] || null;
      for (const p of Object.values(ws.presets)) {
        if (p.collectionId && !get(p.collectionId)) p.collectionId = null;
        p.targets = p.targets.filter(id => get(id));
        if (p.envId && !ws.envs[p.envId]) p.envId = null;
      }
    }

    function newNode(type, parentId, data = {}) {
      const n = normNode({ ...clone(data), id: uid(type === 'collection' ? 'col' : type === 'folder' ? 'fld' : 'req'), type, parentId, createdAt: now(), updatedAt: now() });
      ws.nodes[n.id] = n;
      return n;
    }
    function createCollection(data = {}) {
      const n = newNode('collection', null, data);
      ws.meta.order.push(n.id);
      saveNode(n.id);
      saveMeta();
      return n;
    }
    function insertChild(parentId, id, index) {
      const p = get(parentId);
      if (!p?.children) return;
      p.children = p.children.filter(x => x !== id);
      p.children.splice(index == null ? p.children.length : Math.max(0, Math.min(index, p.children.length)), 0, id);
      p.updatedAt = now();
      saveNode(parentId);
    }
    function createFolder(parentId, data = {}) {
      if (!['collection', 'folder'].includes(get(parentId)?.type)) throw new Error('Folder phải nằm trong collection hoặc folder');
      const n = newNode('folder', parentId, data);
      insertChild(parentId, n.id);
      saveNode(n.id);
      return n;
    }
    function createRequest(parentId, data = {}) {
      if (parentId && !['collection', 'folder'].includes(get(parentId)?.type)) throw new Error('Request phải nằm trong collection hoặc folder');
      const n = newNode('request', parentId || null, data);
      if (parentId) insertChild(parentId, n.id);
      saveNode(n.id);
      return n;
    }
    function update(id, patch) {
      const n = get(id);
      if (!n) return null;
      Object.assign(n, patch, { updatedAt: now() });
      saveNode(id);
      return n;
    }
    const touch = id => { const n = get(id); if (n) { n.updatedAt = now(); saveNode(id); } };
    function rename(id, name) { name = str(name).trim(); if (!name) throw new Error('Tên không được để trống'); return update(id, { name }); }
    const setEnabled = (id, on) => update(id, { enabled: !!on });

    function canMove(id, parentId) {
      const n = get(id);
      if (!n || n.type === 'collection') return false;
      if (!parentId) return n.type === 'request';
      const p = get(parentId);
      if (!p || !['collection', 'folder'].includes(p.type)) return false;
      return parentId !== id && !descendants(id).some(d => d.id === parentId);
    }
    function move(id, parentId, index) {
      if (!canMove(id, parentId)) throw new Error('Không di chuyển được tới đây');
      const n = get(id);
      const old = n.parentId;
      if (old && get(old)) { get(old).children = get(old).children.filter(x => x !== id); saveNode(old); }
      n.parentId = parentId || null;
      n.updatedAt = now();
      if (parentId) insertChild(parentId, id, index);
      saveNode(id);
      return n;
    }
    function reorder(id, delta) {
      const list = siblings(id);
      if (!list) return false;
      const i = list.indexOf(id), j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return false;
      [list[i], list[j]] = [list[j], list[i]];
      const n = get(id);
      if (n.type === 'collection') saveMeta(); else saveNode(n.parentId);
      return true;
    }
    function duplicate(id) {
      const src = get(id);
      if (!src) return null;
      const map = new Map();
      const copyOne = (n, parentId) => {
        const c = clone(n);
        c.id = uid(n.type === 'collection' ? 'col' : n.type === 'folder' ? 'fld' : 'req');
        c.parentId = parentId;
        c.createdAt = c.updatedAt = now();
        map.set(n.id, c.id);
        ws.nodes[c.id] = c;
        if (n.children) c.children = n.children.map(k => get(k)).filter(Boolean).map(k => copyOne(k, c.id).id);
        if (ws.suites[n.id]) { ws.suites[c.id] = clone(ws.suites[n.id]); put('s.' + c.id, ws.suites[c.id]); }
        saveNode(c.id);
        return c;
      };
      const copy = copyOne(src, src.parentId || null);
      copy.name = `${src.name} (bản sao)`;
      saveNode(copy.id);
      if (src.type === 'collection') { ws.meta.order.splice(ws.meta.order.indexOf(src.id) + 1, 0, copy.id); saveMeta(); }
      else if (src.parentId) insertChild(src.parentId, copy.id, get(src.parentId).children.indexOf(src.id) + 1);
      return copy;
    }
    // Xoá node và mọi thứ bên trong; trả về bản chụp để hoàn tác
    function remove(id) {
      const n = get(id);
      if (!n) return null;
      const all = [n, ...descendants(id)];
      const snap = {
        nodes: all.map(clone), suites: Object.fromEntries(all.filter(x => ws.suites[x.id]).map(x => [x.id, clone(ws.suites[x.id])])),
        parentId: n.parentId, index: siblings(id)?.indexOf(id) ?? -1, presets: Object.values(ws.presets).map(clone),
      };
      if (n.type === 'collection') { ws.meta.order = ws.meta.order.filter(x => x !== id); saveMeta(); }
      else if (n.parentId && get(n.parentId)) { get(n.parentId).children = get(n.parentId).children.filter(x => x !== id); saveNode(n.parentId); }
      for (const x of all) {
        delete ws.nodes[x.id];
        del('n.' + x.id);
        delete session.secrets['n.' + x.id];
        if (ws.suites[x.id]) { delete ws.suites[x.id]; del('s.' + x.id); }
      }
      saveSession();
      const gone = new Set(all.map(x => x.id));
      for (const p of Object.values(ws.presets)) {
        const before = JSON.stringify(p);
        if (gone.has(p.collectionId)) p.collectionId = null;
        p.targets = p.targets.filter(t => !gone.has(t));
        if (JSON.stringify(p) !== before) savePreset(p.id);
      }
      return snap;
    }
    function restore(snap) {
      for (const n of snap.nodes) { ws.nodes[n.id] = n; saveNode(n.id); }
      for (const [k, s] of Object.entries(snap.suites)) { ws.suites[k] = s; put('s.' + k, s); }
      const top = snap.nodes[0];
      if (top.type === 'collection') { ws.meta.order.splice(Math.max(0, snap.index), 0, top.id); saveMeta(); }
      else if (snap.parentId && get(snap.parentId)) insertChild(snap.parentId, top.id, snap.index);
      for (const p of snap.presets) { ws.presets[p.id] = p; savePreset(p.id); }
    }

    function search(q) {
      const words = String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
      if (!words.length) return null;
      const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const hits = new Set(), show = new Set();
      for (const n of Object.values(ws.nodes)) {
        const hay = norm([n.name, n.type === 'request' ? `${n.method} ${n.url}` : '', n.description].join(' '));
        if (!words.every(w => hay.includes(w))) continue;
        hits.add(n.id);
        for (const a of path(n.id)) show.add(a.id);
        for (const d of descendants(n.id)) show.add(d.id);
      }
      return { hits, show };
    }

    // ----- Environment -----
    const envList = () => ws.meta.envOrder.map(id => ws.envs[id]).filter(Boolean);
    const activeEnv = () => ws.envs[ws.meta.activeEnvId] || null;
    function setActiveEnv(id) { ws.meta.activeEnvId = ws.envs[id] ? id : null; saveMeta(); }
    function createEnv(data = {}, { copyFrom } = {}) {
      const src = copyFrom ? ws.envs[copyFrom] : null;
      const e = normEnv({ ...(src ? clone(src) : { vars: [{ key: 'baseUrl', value: '' }], color: 'blue' }), ...data, id: uid('env'), createdAt: now(), updatedAt: now() });
      if (src && !data.name) e.name = `${src.name} (bản sao)`;
      ws.envs[e.id] = e;
      ws.meta.envOrder.push(e.id);
      saveEnv(e.id);
      saveMeta();
      return e;
    }
    function updateEnv(id, patch) { const e = ws.envs[id]; if (!e) return null; Object.assign(e, patch, { updatedAt: now() }); saveEnv(id); return e; }
    const touchEnv = id => { if (ws.envs[id]) { ws.envs[id].updatedAt = now(); saveEnv(id); } };
    function removeEnv(id) {
      const e = ws.envs[id];
      if (!e) return null;
      delete ws.envs[id];
      ws.meta.envOrder = ws.meta.envOrder.filter(x => x !== id);
      if (ws.meta.activeEnvId === id) ws.meta.activeEnvId = ws.meta.envOrder[0] || null;
      del('e.' + id);
      delete session.secrets['e.' + id];
      saveSession();
      saveMeta();
      for (const p of Object.values(ws.presets)) if (p.envId === id) { p.envId = null; savePreset(p.id); }
      return clone(e);
    }
    function restoreEnv(e) { ws.envs[e.id] = e; ws.meta.envOrder.push(e.id); saveEnv(e.id); saveMeta(); }
    const isProdEnv = e => !!e && (e.isProd || /\bprod(uction)?\b/i.test(e.name));

    // ----- Preset -----
    const presetList = () => Object.values(ws.presets).sort((a, b) => a.createdAt - b.createdAt);
    function createPreset(data) { const p = normPreset({ ...clone(data), id: uid('pre'), createdAt: now(), updatedAt: now() }); ws.presets[p.id] = p; savePreset(p.id); return p; }
    function updatePreset(id, patch) { const p = ws.presets[id]; if (!p) return null; Object.assign(p, normPreset({ ...p, ...clone(patch) }), { updatedAt: now() }); savePreset(id); return p; }
    function removePreset(id) { const p = ws.presets[id]; delete ws.presets[id]; del('p.' + id); return p ? clone(p) : null; }
    function restorePreset(p) { ws.presets[p.id] = p; savePreset(p.id); }

    // ----- Suite -----
    const suite = id => ws.suites[id] || null;
    function setSuite(id, s) {
      if (s) { s.schemaVersion = ApiSchema.versionFor(s); ws.suites[id] = s; put('s.' + id, s); } else { delete ws.suites[id]; del('s.' + id); }
      touch(id);
    }

    // ----- Biến -----
    const kvObj = rows => Object.fromEntries((rows || []).filter(v => v.key && v.enabled !== false).map(v => [v.key, v.value]));
    const runtime = () => session.runtime;
    function setRuntime(obj) { session.runtime = obj; saveSession(); }
    // Các lớp biến cho một request (cao → thấp). runtime: biến của lần chạy (mặc định: runtime của phiên)
    function layers(requestId, { envId = ws.meta.activeEnvId, runtime: rt } = {}) {
      const env = ws.envs[envId] || null;
      const col = requestId ? collectionOf(requestId) : null;
      return [
        { scope: 'runtime', label: 'Runtime', vars: rt ?? session.runtime, secret: new Set() },
        { scope: 'environment', label: env ? env.name : 'Environment', id: env?.id, vars: env ? kvObj(env.vars) : {}, secret: new Set((env?.vars || []).filter(v => v.secret).map(v => v.key)) },
        { scope: 'collection', label: col ? col.name : 'Collection', id: col?.id, vars: col ? kvObj(col.vars) : {}, secret: new Set((col?.vars || []).filter(v => v.secret).map(v => v.key)) },
        { scope: 'global', label: 'Globals', vars: kvObj(ws.meta.globals.vars), secret: new Set(ws.meta.globals.vars.filter(v => v.secret).map(v => v.key)) },
      ];
    }
    // Gộp theo thứ tự ưu tiên. Ô trống ở Environment / Collection / Globals coi như chưa có giá trị
    function resolveVars(ls) {
      const merged = {}, from = {};
      for (const l of [...ls].reverse()) for (const [k, v] of Object.entries(l.vars)) {
        if (l.scope !== 'runtime' && (v === '' || v == null)) continue;
        merged[k] = v;
        from[k] = l.scope;
      }
      const secretNames = new Set(ls.flatMap(l => [...l.secret]));
      return { vars: merged, from, secretNames };
    }
    // Request nào trong workspace sinh ra biến này (extract / script .set)
    function producers(name) {
      const out = [];
      for (const n of Object.values(ws.nodes)) {
        if (n.type !== 'request') continue;
        const s = ws.suites[n.id];
        const col = collectionOf(n.id);
        if (n.extract.some(x => x.name === name) || s?.cases.some(c => c.extract && name in c.extract)
          || [n.scripts.pre, n.scripts.post, col?.scripts.pre, col?.scripts.post].some(code => scriptSets(code).includes(name))) out.push(n);
      }
      return out;
    }
    // Biến request dùng / sinh ra (phân tích tĩnh; dùng để xếp thứ tự chạy và báo thiếu biến)
    function varFlow(requestId, { envId = ws.meta.activeEnvId } = {}) {
      const n = get(requestId);
      if (!n) return { uses: new Set(), scriptUses: new Set(), caseUses: new Set(), makes: new Set() };
      const env = ws.envs[envId];
      const chain = path(requestId);
      const col = chain[0]?.type === 'collection' ? chain[0] : null;
      const auth = effectiveAuth(requestId).auth;
      const texts = [n.url, ...n.query.filter(q => q.enabled !== false).map(q => q.key + ' ' + q.value), ...n.headers.filter(h => h.enabled !== false).map(h => h.value),
        n.body.mode === 'none' ? '' : n.body.text, ...(col?.headers || []).filter(h => h.enabled !== false).map(h => h.value), ...(env?.headers || []).filter(h => h.enabled !== false).map(h => h.value),
        auth.token, auth.username, auth.password, auth.value];
      // uses: biến trong URL / params / headers / body / auth (thiếu là request sai) · scriptUses: script đọc (thiếu chỉ ra undefined)
      const uses = new Set(texts.flatMap(t => varsIn(t)));
      const scriptUses = new Set([n.scripts.pre, n.scripts.post, col?.scripts.pre, col?.scripts.post].flatMap(scriptGets));
      const s = ws.suites[n.id];
      const caseUses = new Set(s ? varsIn(JSON.stringify(s.cases.map(c => c.requestOverride || {}))) : []);
      const makes = new Set([...n.extract.map(x => x.name), ...(s?.cases.flatMap(c => Object.keys(c.extract || {})) || []),
        ...[n.scripts.pre, n.scripts.post, col?.scripts.pre, col?.scripts.post].flatMap(scriptSets)]);
      return { uses, scriptUses, caseUses, makes };
    }
    // Authorization thực tế (đi ngược lên folder / collection khi "inherit")
    function effectiveAuth(requestId) {
      const chain = path(requestId).reverse();
      for (const x of chain) if (x.auth && x.auth.type !== 'inherit') return { auth: x.auth, from: x };
      return { auth: { type: 'none' }, from: null };
    }
    const allowHosts = envId => [ws.envs[envId]?.allowHosts || '', ws.meta.globals.allowHosts || ''].join('\n').trim();

    // ----- Kết quả gần nhất (đã che); quá lớn thì rút gọn body trước khi lưu -----
    function saveLastRun(run) {
      if (!run) { ws.lastRun = null; del('run.last'); return; }
      let data = clone(run);
      if (JSON.stringify(data).length > RUN_STORE_LIMIT) {
        const cut = s => (typeof s === 'string' && s.length > 2000 ? s.slice(0, 2000) + '\n… [đã rút gọn khi lưu trên máy]' : s);
        data.results = data.results.map(r => ({ ...r, storageTrimmed: true, request: r.request && { ...r.request, body: cut(r.request.body) }, response: r.response && { ...r.response, body: cut(r.response.body) } }));
        if (JSON.stringify(data).length > RUN_STORE_LIMIT) data = { ...data, results: data.results.map(r => ({ ...r, request: null, response: null, scriptLogs: [] })), trimmed: 'summary' };
      }
      ws.lastRun = data;
      put('run.last', data);
    }

    // ----- Export / Import -----
    function exportData({ includeSecrets = false } = {}) {
      const pick = o => (includeSecrets ? clone(o) : splitSecrets(o).out);
      return {
        format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), includesSecrets: !!includeSecrets,
        globals: pick(ws.meta.globals), order: [...ws.meta.order], envOrder: [...ws.meta.envOrder], activeEnvId: ws.meta.activeEnvId,
        nodes: Object.values(ws.nodes).map(pick), environments: envList().map(pick), presets: presetList().map(clone), suites: clone(ws.suites),
      };
    }
    // mode 'merge': cấp id mới cho mọi thứ (không đè dữ liệu đang có); 'replace': xoá workspace hiện tại rồi nạp
    function importData(data, mode = 'merge') {
      const ids = new Map();
      const nid = (old, p) => { if (mode === 'replace') return old; if (!ids.has(old)) ids.set(old, uid(p)); return ids.get(old); };
      if (mode === 'replace') {
        for (const id of Object.keys(ws.nodes)) del('n.' + id);
        for (const id of Object.keys(ws.envs)) del('e.' + id);
        for (const id of Object.keys(ws.presets)) del('p.' + id);
        for (const id of Object.keys(ws.suites)) del('s.' + id);
        ws.nodes = {}; ws.envs = {}; ws.presets = {}; ws.suites = {};
        ws.meta.order = []; ws.meta.envOrder = [];
        session.secrets = {};
        ws.meta.globals = clone(data.globals || { vars: [], allowHosts: '' });
      } else if (data.globals) {
        // Gộp globals: thêm biến chưa có, nối allowed hosts
        for (const v of data.globals.vars || []) if (!ws.meta.globals.vars.some(x => x.key === v.key)) ws.meta.globals.vars.push(clone(v));
        ws.meta.globals.allowHosts = [...new Set([...ApiPolicy.parseList(ws.meta.globals.allowHosts), ...ApiPolicy.parseList(data.globals.allowHosts)])].join('\n');
      }
      const pre = t => (t === 'collection' ? 'col' : t === 'folder' ? 'fld' : 'req');
      for (const n of data.nodes) nid(n.id, pre(n.type)); // cấp id trước để tham chiếu cha / con đổi theo đúng một id
      const ref = old => (mode === 'replace' ? old : ids.get(old) || null);
      for (const n of data.nodes) {
        const c = clone(n);
        c.id = ref(n.id);
        if (c.parentId) c.parentId = ref(c.parentId);
        if (c.children) c.children = c.children.map(ref).filter(Boolean);
        ws.nodes[c.id] = c;
      }
      for (const id of data.order || []) { const k = ref(id); if (k && !ws.meta.order.includes(k)) ws.meta.order.push(k); }
      const envMap = new Map();
      for (const e of data.environments) {
        const c = clone(e);
        c.id = nid(e.id, 'env');
        envMap.set(e.id, c.id);
        if (mode === 'merge' && Object.values(ws.envs).some(x => x.name === c.name)) c.name = `${c.name} (nhập)`;
        ws.envs[c.id] = c;
        ws.meta.envOrder.push(c.id);
      }
      for (const p of data.presets) {
        const c = clone(p);
        c.id = nid(p.id, 'pre');
        if (c.collectionId) c.collectionId = ref(c.collectionId);
        c.targets = c.targets.map(ref).filter(Boolean);
        if (c.envId) c.envId = envMap.get(c.envId) || null;
        ws.presets[c.id] = c;
      }
      for (const [rid, s] of Object.entries(data.suites || {})) { const k = ref(rid); if (k) ws.suites[k] = clone(s); }
      if (mode === 'replace') ws.meta.activeEnvId = data.activeEnvId && ws.envs[data.activeEnvId] ? data.activeEnvId : ws.meta.envOrder[0] || null;
      else if (!ws.meta.activeEnvId) ws.meta.activeEnvId = ws.meta.envOrder[0] || null;
      const problems = [];
      repair(problems);
      // Ghi lại toàn bộ (merge: chỉ phần mới)
      const touched = mode === 'replace' ? null : new Set([...ids.values(), ...envMap.values()]);
      for (const id of Object.keys(ws.nodes)) if (!touched || touched.has(id)) saveNode(id);
      for (const id of Object.keys(ws.envs)) if (!touched || touched.has(id)) saveEnv(id);
      for (const id of Object.keys(ws.presets)) if (!touched || touched.has(id)) savePreset(id);
      for (const [id, s] of Object.entries(ws.suites)) if (!touched || touched.has(id)) put('s.' + id, s);
      saveMeta();
      return { problems, collections: data.nodes.filter(n => n.type === 'collection').length };
    }

    return {
      ws, get meta() { return ws.meta; }, get nodes() { return ws.nodes; }, get envs() { return ws.envs; }, get lastRun() { return ws.lastRun; },
      get, children, collections, drafts, parentOf, path, collectionOf, descendants, requestsUnder, siblings, repair, search,
      createCollection, createFolder, createRequest, update, touch, rename, setEnabled, canMove, move, reorder, duplicate, remove, restore,
      envList, activeEnv, setActiveEnv, createEnv, updateEnv, touchEnv, removeEnv, restoreEnv, isProdEnv,
      presetList, preset: id => ws.presets[id] || null, createPreset, updatePreset, removePreset, restorePreset,
      suite, setSuite, layers, resolveVars, producers, varFlow, effectiveAuth, allowHosts, runtime, setRuntime,
      saveMeta, saveNode, saveEnv, saveLastRun, exportData, importData,
      isEmpty: () => !Object.keys(ws.nodes).length,
    };
  }

  // ---------- Kiểm tra file import ----------
  function validateImport(obj) {
    const errors = [], warnings = [];
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj.replace(/^\uFEFF/, '')); } catch (e) { return { data: null, errors: ['File không phải JSON hợp lệ: ' + e.message], warnings, summary: null }; }
    }
    if (!isObj(obj)) return { data: null, errors: ['File không đúng định dạng workspace'], warnings, summary: null };
    if (obj.schemaVersion && Array.isArray(obj.cases)) return { data: null, errors: ['Đây là file Test Suite JSON (test case), không phải workspace. Hãy mở một request → tab Tests → Import JSON.'], warnings, summary: null };
    if (obj.format !== FORMAT) return { data: null, errors: [`File không phải workspace của tool (thiếu "format": "${FORMAT}")`], warnings, summary: null };
    if (!Number.isInteger(obj.version) || obj.version > VERSION) return { data: null, errors: [`Phiên bản workspace ${obj.version} mới hơn tool đang dùng (${VERSION}). Hãy cập nhật extension.`], warnings, summary: null };
    const nodes = [], seen = new Set();
    for (const [i, raw] of (Array.isArray(obj.nodes) ? obj.nodes : []).entries()) {
      const n = normNode(raw);
      if (!n) { warnings.push(`nodes[${i}] không hợp lệ, đã bỏ qua`); continue; }
      if (seen.has(n.id)) { warnings.push(`id trùng ${n.id}, đã bỏ bản sau`); continue; }
      seen.add(n.id);
      nodes.push(n);
    }
    // Quan hệ cha / con hỏng: request → Chưa lưu, folder mất collection → bỏ (lặp vì bỏ folder làm con mồ côi theo)
    let keep = nodes;
    for (let changed = true; changed;) {
      changed = false;
      const byId = new Map(keep.map(n => [n.id, n]));
      for (const n of keep) {
        if (n.type === 'collection') continue;
        const p = n.parentId ? byId.get(n.parentId) : null;
        if (p && p.type !== 'request') continue;
        if (n.type === 'request') { if (n.parentId) { warnings.push(`Request "${n.name}" trỏ tới thư mục không có trong file → chuyển vào Chưa lưu`); n.parentId = null; } }
        else { warnings.push(`Folder "${n.name}" mất collection → bỏ`); n.drop = true; changed = true; }
      }
      keep = keep.filter(n => !n.drop);
    }
    const keepIds = new Set(keep.map(n => n.id));
    for (const n of keep) if (n.children) n.children = n.children.filter(id => keepIds.has(id));
    const environments = (Array.isArray(obj.environments) ? obj.environments : []).map(normEnv).filter(Boolean);
    const presets = (Array.isArray(obj.presets) ? obj.presets : []).map(normPreset).filter(Boolean);
    const suites = {};
    let cases = 0;
    for (const [rid, s] of Object.entries(isObj(obj.suites) ? obj.suites : {})) {
      if (!keep.some(n => n.id === rid && n.type === 'request')) { warnings.push(`Suite của request ${rid} không có request tương ứng, đã bỏ`); continue; }
      const v = ApiSchema.validate(s);
      if (!v.suite) { warnings.push(`Suite của request ${keep.find(n => n.id === rid).name} không hợp lệ (${v.errors[0]?.path}: ${v.errors[0]?.msg}), đã bỏ`); continue; }
      suites[rid] = v.suite;
      cases += v.suite.cases.length;
    }
    if (obj.includesSecrets) warnings.push('File có chứa giá trị bí mật (token, password…). Chỉ nhập file từ nguồn tin cậy.');
    const data = {
      globals: { vars: kvRows(obj.globals?.vars), allowHosts: str(obj.globals?.allowHosts) },
      order: Array.isArray(obj.order) ? obj.order : keep.filter(n => n.type === 'collection').map(n => n.id),
      envOrder: Array.isArray(obj.envOrder) ? obj.envOrder : environments.map(e => e.id), activeEnvId: obj.activeEnvId,
      nodes: keep, environments, presets, suites,
    };
    if (!keep.length && !environments.length) errors.push('File không có collection, request hay environment nào');
    const summary = {
      collections: keep.filter(n => n.type === 'collection').length, folders: keep.filter(n => n.type === 'folder').length,
      requests: keep.filter(n => n.type === 'request').length, environments: environments.length, presets: presets.length, suites: Object.keys(suites).length, cases,
    };
    return { data: errors.length ? null : data, errors, warnings, summary };
  }

  // ---------- Chuyển dữ liệu bản trước (một request + một suite + DEV/STAGING/PROD trong localStorage) ----------
  function fromLegacy(v2, suiteText) {
    if (!isObj(v2) && !suiteText) return null;
    v2 = isObj(v2) ? v2 : {};
    const t = Date.now();
    const environments = ['DEV', 'STAGING', 'PROD'].map((name, i) => {
      const e = v2.envs?.[name] || {};
      return { id: `env_legacy_${i}`, name, color: ['green', 'yellow', 'red'][i], isProd: name === 'PROD', vars: kvRows(e.vars), headers: kvRows(e.headers), allowHosts: str(e.allowHosts), createdAt: t, updatedAt: t };
    });
    const nodes = [];
    const suites = {};
    let suite = null;
    if (suiteText) { const v = ApiSchema.validate(suiteText); if (v.suite) suite = v.suite; }
    const b = isObj(v2.base) ? v2.base : null;
    if (b?.url || suite) {
      const colId = 'col_legacy', reqId = 'req_legacy';
      let name = suite?.suite.name || 'Request';
      if (!suite && b?.url) { try { name = `${b.method || 'GET'} ${new URL(b.url.replace(/\{\{[^}]+\}\}/, 'https://x')).pathname}`; } catch { name = b.url; } }
      nodes.push(normNode({ id: colId, type: 'collection', name: 'Chuyển từ phiên bản trước', children: [reqId], scripts: v2.scripts, createdAt: t, updatedAt: t }));
      nodes.push(normNode({
        id: reqId, type: 'request', parentId: colId, name, method: b?.method, url: b?.url, query: b?.query, headers: b?.headers,
        body: b?.body ? { mode: b.body.mode, text: b.body.text } : undefined, auth: { type: 'inherit' }, meta: b?.meta, createdAt: t, updatedAt: t,
      }));
      if (suite) suites[reqId] = suite;
    }
    const active = environments.find(e => e.name === v2.envName) || environments[0];
    return {
      globals: { vars: [], allowHosts: '' }, order: nodes.length ? ['col_legacy'] : [], envOrder: environments.map(e => e.id), activeEnvId: active.id,
      nodes, environments, presets: [], suites,
    };
  }

  window.ApiWorkspace = { FORMAT, VERSION, BODY_MODES, AUTH_TYPES, ENV_COLORS, load, fresh, fromLegacy, validateImport, normNode, scriptSets, scriptGets, isLiteralSecret, uid };
})();
