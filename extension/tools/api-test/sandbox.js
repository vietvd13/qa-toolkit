// Chạy script trước / sau request của tester trong trang sandbox (không có API chrome.*, CSP chặn mạng).
// Mỗi lần chạy tạo một Worker riêng để trang chính dừng được script chạy quá lâu; nếu trình duyệt không cho
// tạo Worker trong sandbox thì chạy ngay trong trang (vẫn cách ly, nhưng không ngắt được vòng lặp vô hạn).
// Giao tiếp với trang chính:
//   nhận  { type: 'run', id, kind: 'pre'|'post'|'check', payload: { code, request, response, vars, case } }
//         { type: 'cancel', id } · { type: 'sendResult', id, reqId, ok, response | error }
//   gửi   { type: 'result', id, result: { error, logs, tests, vars, request, requestChanged } }
//         { type: 'send', id, reqId, request }   ← pm.sendRequest, trang chính gửi hộ (có kiểm host được phép)

// Toàn bộ runtime nằm trong một hàm tự đủ để chép nguyên văn vào Worker
function createRuntime(post) {
  const waiting = new Map();
  let reqSeq = 0;
  const fmt = a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  };
  const same = (a, b) => {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  };
  const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

  // ---------- CryptoJS rút gọn (tương thích require('crypto-js') của Postman) ----------
  // Hash đồng bộ viết bằng JS thuần; hằng số tính từ số nguyên tố (căn bậc 2, bậc 3) và sin, không chép tay.
  const CryptoJS = (() => {
    const te = new TextEncoder(), td = new TextDecoder();
    const M64 = (1n << 64n) - 1n;
    const iroot = (n, k) => { // phần nguyên căn bậc k của BigInt n (Newton, bắt đầu từ trên xuống)
      if (n < 2n) return n;
      const K = BigInt(k);
      let x = 1n << BigInt(Math.ceil(n.toString(2).length / k) + 1);
      for (;;) { const y = ((K - 1n) * x + n / x ** (K - 1n)) / K; if (y >= x) return x; x = y; }
    };
    const primes = [];
    for (let n = 2; primes.length < 80; n++) if (primes.every(p => n % p)) primes.push(n);
    const K512 = primes.map(p => iroot(BigInt(p) << 192n, 3) & M64);
    const H512 = primes.slice(0, 8).map(p => iroot(BigInt(p) << 128n, 2) & M64);
    const K256 = K512.slice(0, 64).map(x => Number(x >> 32n));
    const H256 = H512.map(x => Number(x >> 32n));
    const MD5K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
    const MD5S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const rotl = (x, n) => (x << n) | (x >>> (32 - n));
    const rotr64 = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;

    // Thêm padding: 0x80, các byte 0, độ dài (bit) ở cuối; blockSize 64 hoặc 128, lenBytes 8 hoặc 16
    function pad(bytes, blockSize, lenBytes, littleEndian) {
      const total = Math.ceil((bytes.length + 1 + lenBytes) / blockSize) * blockSize;
      const m = new Uint8Array(total);
      m.set(bytes);
      m[bytes.length] = 0x80;
      const dv = new DataView(m.buffer);
      const bits = bytes.length * 8;
      if (littleEndian) { dv.setUint32(total - 8, bits >>> 0, true); dv.setUint32(total - 4, Math.floor(bits / 2 ** 32), true); }
      else { dv.setUint32(total - 4, bits >>> 0); dv.setUint32(total - 8, Math.floor(bits / 2 ** 32)); }
      return dv;
    }
    function sha256(bytes) {
      const dv = pad(bytes, 64, 8, false), h = H256.slice(), w = new Uint32Array(64);
      for (let o = 0; o < dv.byteLength; o += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
          const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
          const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
          hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        [a, b, c, d, e, f, g, hh].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
      }
      const out = new DataView(new ArrayBuffer(32));
      h.forEach((x, i) => out.setUint32(i * 4, x));
      return new Uint8Array(out.buffer);
    }
    function sha512(bytes) {
      const dv = pad(bytes, 128, 16, false), h = H512.slice(), w = new Array(80);
      for (let o = 0; o < dv.byteLength; o += 128) {
        for (let i = 0; i < 16; i++) w[i] = dv.getBigUint64(o + i * 8);
        for (let i = 16; i < 80; i++) {
          const s0 = rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7n);
          const s1 = rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6n);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M64;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 80; i++) {
          const t1 = (hh + (rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41)) + ((e & f) ^ (~e & M64 & g)) + K512[i] + w[i]) & M64;
          const t2 = ((rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39)) + ((a & b) ^ (a & c) ^ (b & c))) & M64;
          hh = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
        }
        [a, b, c, d, e, f, g, hh].forEach((x, i) => { h[i] = (h[i] + x) & M64; });
      }
      const out = new DataView(new ArrayBuffer(64));
      h.forEach((x, i) => out.setBigUint64(i * 8, x));
      return new Uint8Array(out.buffer);
    }
    function sha1(bytes) {
      const dv = pad(bytes, 64, 8, false), h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0], w = new Uint32Array(80);
      for (let o = 0; o < dv.byteLength; o += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
        for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) >>> 0;
        let [a, b, c, d, e] = h;
        for (let i = 0; i < 80; i++) {
          const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
          const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
          e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = t;
        }
        [a, b, c, d, e].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
      }
      const out = new DataView(new ArrayBuffer(20));
      h.forEach((x, i) => out.setUint32(i * 4, x));
      return new Uint8Array(out.buffer);
    }
    function md5(bytes) {
      const dv = pad(bytes, 64, 8, true), h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
      for (let o = 0; o < dv.byteLength; o += 64) {
        const m = Array.from({ length: 16 }, (_, i) => dv.getUint32(o + i * 4, true));
        let [a, b, c, d] = h;
        for (let i = 0; i < 64; i++) {
          let f, g;
          if (i < 16) { f = (b & c) | (~b & d); g = i; }
          else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
          else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
          else { f = c ^ (b | ~d); g = (7 * i) % 16; }
          const t = d; d = c; c = b;
          b = (b + rotl((a + f + MD5K[i] + m[g]) >>> 0, MD5S[(i >> 4) * 4 + (i % 4)])) >>> 0;
          a = t;
        }
        [a, b, c, d].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
      }
      const out = new DataView(new ArrayBuffer(16));
      h.forEach((x, i) => out.setUint32(i * 4, x, true));
      return new Uint8Array(out.buffer);
    }

    // WordArray rút gọn: giữ mảng byte, toString() mặc định ra hex như CryptoJS
    const Hex = { stringify: w => Array.from(w.bytes, b => b.toString(16).padStart(2, '0')).join(''), parse: s => wa(Uint8Array.from(String(s).match(/../g) || [], x => parseInt(x, 16))) };
    const Base64 = { stringify: w => { let s = ''; w.bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }, parse: s => wa(Uint8Array.from(atob(String(s)), c => c.charCodeAt(0))) };
    const Utf8 = { stringify: w => td.decode(w.bytes), parse: s => wa(te.encode(String(s))) };
    const Latin1 = { stringify: w => String.fromCharCode(...w.bytes), parse: s => wa(Uint8Array.from(String(s), c => c.charCodeAt(0) & 0xff)) };
    function wa(bytes) {
      return { bytes, sigBytes: bytes.length, toString(enc) { return (enc || Hex).stringify(this); },
        concat(o) { const n = new Uint8Array(this.bytes.length + o.bytes.length); n.set(this.bytes); n.set(o.bytes, this.bytes.length); this.bytes = n; this.sigBytes = n.length; return this; } };
    }
    const toBytes = m => (m && m.bytes instanceof Uint8Array ? m.bytes : te.encode(String(m ?? '')));
    const hmac = (fn, blockSize) => (msg, key) => {
      let k = toBytes(key);
      if (k.length > blockSize) k = fn(k);
      const kp = new Uint8Array(blockSize); kp.set(k);
      const ipad = kp.map(b => b ^ 0x36), opad = kp.map(b => b ^ 0x5c);
      const m = toBytes(msg);
      const inner = new Uint8Array(blockSize + m.length); inner.set(ipad); inner.set(m, blockSize);
      const ih = fn(inner);
      const outer = new Uint8Array(blockSize + ih.length); outer.set(opad); outer.set(ih, blockSize);
      return wa(fn(outer));
    };
    const hash = fn => m => wa(fn(toBytes(m)));
    const unsupported = name => () => { throw new Error(`CryptoJS.${name} chưa được hỗ trợ trong sandbox (hỗ trợ: SHA256, SHA1, SHA512, MD5, HmacSHA256, HmacSHA1, HmacSHA512, HmacMD5, enc.Hex/Base64/Utf8/Latin1)`); };
    return {
      SHA256: hash(sha256), SHA1: hash(sha1), SHA512: hash(sha512), MD5: hash(md5),
      HmacSHA256: hmac(sha256, 64), HmacSHA1: hmac(sha1, 64), HmacSHA512: hmac(sha512, 128), HmacMD5: hmac(md5, 64),
      enc: { Hex, Base64, Utf8, Latin1 },
      lib: { WordArray: { create: b => wa(b instanceof Uint8Array ? b : new Uint8Array(b || [])) } },
      AES: { encrypt: unsupported('AES.encrypt'), decrypt: unsupported('AES.decrypt') }, SHA3: unsupported('SHA3'), RIPEMD160: unsupported('RIPEMD160'),
    };
  })();
  const require = name => {
    if (/^crypto-js(\/.*)?$/.test(name)) return CryptoJS;
    throw new Error(`require('${name}') chưa được hỗ trợ trong sandbox. Hiện có: require('crypto-js')`);
  };
  // Biến động của Postman dùng trong replaceIn / {{...}}
  const uuid = () => {
    if (crypto.randomUUID) { try { return crypto.randomUUID(); } catch {} }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const DYNAMIC = {
    $guid: uuid, $uuid: uuid, $randomUUID: uuid,
    $timestamp: () => String(Date.now()),
    $isoTimestamp: () => new Date().toISOString(),
    $randomInt: () => String(Math.floor(Math.random() * 1000000)),
    $randomPhone: () => '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
    $randomEmail: () => `qa${Date.now()}${Math.floor(Math.random() * 1000)}@yopmail.com`,
  };

  // Header dạng object, tên không phân biệt hoa thường
  function headerApi(h, onChange) {
    const find = k => Object.keys(h).find(x => x.toLowerCase() === String(k).toLowerCase());
    const api = {
      get: k => { const e = find(k); return e === undefined ? undefined : h[e]; },
      has: k => find(k) !== undefined,
      upsert: x => { api.remove(x.key); h[x.key] = String(x.value); onChange?.(); },
      add: x => api.upsert(x),
      remove: k => { for (const x of Object.keys(h)) if (x.toLowerCase() === String(k).toLowerCase()) { delete h[x]; onChange?.(); } },
      toObject: () => ({ ...h }),
      each: fn => Object.entries(h).forEach(([key, value]) => fn({ key, value })),
    };
    if (!onChange) { api.upsert = api.add = api.remove = () => { throw new Error('Header của response chỉ đọc'); }; }
    return api;
  }

  // Bản rút gọn của pm.expect (cú pháp chai)
  function expect(actual) {
    let neg = false;
    const ch = {};
    const ok = (cond, msg) => {
      if (neg ? cond : !cond) throw new Error(`expected ${neg ? 'NOT ' : ''}${msg}`);
      return ch;
    };
    for (const w of ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'deep', 'still']) Object.defineProperty(ch, w, { get: () => ch });
    Object.defineProperty(ch, 'not', { get: () => { neg = !neg; return ch; } });
    const getter = (name, test, msg) => Object.defineProperty(ch, name, { get: () => ok(test(), msg) });
    getter('ok', () => !!actual, `${fmt(actual)} to be truthy`);
    getter('true', () => actual === true, `${fmt(actual)} to be true`);
    getter('false', () => actual === false, `${fmt(actual)} to be false`);
    getter('null', () => actual === null, `${fmt(actual)} to be null`);
    getter('undefined', () => actual === undefined, `${fmt(actual)} to be undefined`);
    getter('exist', () => actual != null, `${fmt(actual)} to exist`);
    getter('empty', () => (typeof actual === 'string' || Array.isArray(actual) ? actual.length === 0 : actual && typeof actual === 'object' ? Object.keys(actual).length === 0 : false), `${fmt(actual)} to be empty`);
    ch.equal = ch.equals = ch.eq = v => ok(actual === v, `${fmt(actual)} to equal ${fmt(v)}`);
    ch.eql = v => ok(same(actual, v), `${fmt(actual)} to deeply equal ${fmt(v)}`);
    ch.above = ch.gt = ch.greaterThan = v => ok(actual > v, `${fmt(actual)} to be above ${fmt(v)}`);
    ch.below = ch.lt = ch.lessThan = v => ok(actual < v, `${fmt(actual)} to be below ${fmt(v)}`);
    ch.least = ch.gte = v => ok(actual >= v, `${fmt(actual)} to be at least ${fmt(v)}`);
    ch.most = ch.lte = v => ok(actual <= v, `${fmt(actual)} to be at most ${fmt(v)}`);
    ch.within = (a, b) => ok(actual >= a && actual <= b, `${fmt(actual)} to be within ${a}..${b}`);
    ch.include = ch.includes = ch.contain = ch.contains = v => ok(
      typeof actual === 'string' ? actual.includes(v)
        : Array.isArray(actual) ? actual.some(x => same(x, v))
          : actual && typeof actual === 'object' && v && typeof v === 'object' ? Object.entries(v).every(([k, x]) => same(actual[k], x)) : false,
      `${fmt(actual)} to include ${fmt(v)}`);
    ch.a = ch.an = t => ok(typeOf(actual) === String(t).toLowerCase(), `${fmt(actual)} to be a ${t}`);
    ch.property = (k, ...v) => {
      const has = actual != null && Object.prototype.hasOwnProperty.call(Object(actual), k);
      return v.length ? ok(has && same(actual[k], v[0]), `${fmt(actual)} to have property ${k} = ${fmt(v[0])}`) : ok(has, `${fmt(actual)} to have property ${k}`);
    };
    ch.keys = (...ks) => ok(actual && typeof actual === 'object' && ks.flat().every(k => k in actual), `${fmt(actual)} to have keys ${ks.flat().join(', ')}`);
    ch.length = ch.lengthOf = n => ok(actual != null && actual.length === n, `length ${actual?.length} to be ${n}`);
    ch.match = re => ok((re instanceof RegExp ? re : new RegExp(re)).test(String(actual)), `${fmt(actual)} to match ${re}`);
    ch.oneOf = arr => ok(arr.some(x => same(x, actual)), `${fmt(actual)} to be one of ${fmt(arr)}`);
    ch.status = c => ok(actual && actual.code === c, `response status ${actual?.code} to be ${c}`);
    return ch;
  }

  function wrapResponse(x) {
    return {
      code: x.status, status: x.statusText, responseTime: x.timeMs, size: x.size,
      headers: headerApi({ ...(x.headers || {}) }),
      text: () => x.body ?? '',
      json: () => JSON.parse(x.body),
      to: {
        have: { status: c => { if (x.status !== c) throw new Error(`expected response to have status code ${c} but got ${x.status}`); } },
        be: { get ok() { if (x.status < 200 || x.status > 299) throw new Error(`expected response status 2xx but got ${x.status}`); return true; } },
      },
    };
  }

  return async function onMessage(m) {
    if (m.type === 'sendResult') {
      const w = waiting.get(m.reqId);
      waiting.delete(m.reqId);
      if (w) { if (m.ok) w.resolve(m.response); else w.reject(new Error(m.error)); }
      return;
    }
    if (m.type !== 'run') return;
    const { kind, payload } = m;
    const logs = [], tests = [], pending = [];
    const log = prefix => (...a) => logs.push(prefix + a.map(fmt).join(' '));
    const console = { log: log(''), info: log(''), debug: log(''), warn: log('[warn] '), error: log('[error] ') };
    const vars = { ...(payload.vars || {}) };
    const missingGets = new Set(); // variable script .get() mà không có
    const store = {
      get: k => { if (!Object.prototype.hasOwnProperty.call(vars, k)) missingGets.add(String(k)); return vars[k]; },
      set: (k, v) => { vars[k] = v == null ? v : typeof v === 'object' ? JSON.stringify(v) : String(v); },
      unset: k => { delete vars[k]; },
      has: k => Object.prototype.hasOwnProperty.call(vars, k),
      toObject: () => ({ ...vars }),
      replaceIn: s => String(s).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (x, n) => (DYNAMIC[n] ? DYNAMIC[n]() : Object.prototype.hasOwnProperty.call(vars, n) ? String(vars[n]) : x)),
    };
    const req = payload.request ? JSON.parse(JSON.stringify(payload.request)) : null;
    let changed = false;
    const mark = () => { changed = true; };
    const pmRequest = req && {
      get url() { return req.url; }, set url(v) { req.url = String(v); mark(); },
      get method() { return req.method; }, set method(v) { req.method = String(v).toUpperCase(); mark(); },
      headers: headerApi(req.headers, mark),
      body: {
        get raw() { return req.body ?? ''; }, set raw(v) { req.body = v == null ? null : String(v); mark(); },
        get mode() { return req.bodyMode || 'none'; },
        json: () => JSON.parse(req.body),
      },
    };
    const pm = {
      variables: store, environment: store, collectionVariables: store, globals: store,
      request: pmRequest, response: payload.response ? wrapResponse(payload.response) : undefined,
      case: payload.case || {}, info: { eventName: kind === 'pre' ? 'prerequest' : 'test', requestName: payload.case?.name || '' },
      expect,
      test(name, fn) {
        try {
          const r = fn();
          if (r && typeof r.then === 'function') pending.push(r.then(() => tests.push({ name, pass: true }), e => tests.push({ name, pass: false, error: fmt(e) })));
          else tests.push({ name, pass: true });
        } catch (e) { tests.push({ name, pass: false, error: fmt(e) }); }
      },
      sendRequest(r, cb) {
        const p = new Promise((resolve, reject) => {
          const id = ++reqSeq;
          waiting.set(id, { resolve, reject });
          post({ type: 'send', reqId: id, request: typeof r === 'string' ? { url: r } : JSON.parse(JSON.stringify(r)) });
        }).then(wrapResponse);
        if (cb) pending.push(p.then(x => cb(null, x), e => cb(e)));
        return p;
      },
    };
    let error = null, evalBlocked = false;
    try {
      const fn = new Function('pm', 'console', 'expect', 'require', 'CryptoJS', `"use strict";\nreturn (async () => {\n${payload.code}\n})();`);
      if (kind !== 'check') {
        await fn(pm, console, expect, require, CryptoJS);
        while (pending.length) await pending.shift();
      }
    } catch (e) {
      error = (e && e.name && e.name !== 'Error' ? e.name + ': ' : '') + fmt(e);
      evalBlocked = e instanceof EvalError;
    }
    post({ type: 'result', result: { error, evalBlocked, logs, tests, vars, request: req, requestChanged: changed, missingVars: [...missingGets] } });
  };
}

// ---------- Cầu nối với trang chính ----------
const workers = new Map(); // id → Worker
const inline = new Map(); // id → handler (khi không dùng được Worker)
const toParent = msg => parent.postMessage(msg, '*'); // trang sandbox có origin riêng (null) nên phải dùng '*'

function runInline(d) {
  const h = createRuntime(m => {
    if (m.type === 'send') toParent({ type: 'send', id: d.id, reqId: m.reqId, request: m.request });
    else if (m.type === 'result') { inline.delete(d.id); toParent({ type: 'result', id: d.id, result: m.result }); }
  });
  inline.set(d.id, h);
  h(d);
}

function start(d) {
  let w;
  try {
    const src = `${createRuntime.toString()}\nconst handle = createRuntime(m => self.postMessage(m));\nself.onmessage = e => handle(e.data);`;
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch { runInline(d); return; }
  let heard = false;
  workers.set(d.id, w);
  const stop = () => { w.terminate(); workers.delete(d.id); };
  w.onmessage = ev => {
    heard = true;
    const m = ev.data;
    if (m.type === 'send') toParent({ type: 'send', id: d.id, reqId: m.reqId, request: m.request });
    else if (m.type === 'result') {
      stop();
      if (m.result.evalBlocked) runInline(d); // Worker không được phép eval → chạy trong trang
      else toParent({ type: 'result', id: d.id, result: m.result });
    }
  };
  w.onerror = ev => {
    ev.preventDefault();
    stop();
    if (!heard) runInline(d); // Worker không khởi động được (CSP) → chạy trong trang
    else toParent({ type: 'result', id: d.id, result: { error: ev.message || 'Lỗi script', logs: [], tests: [], vars: d.payload.vars || {}, request: d.payload.request || null, requestChanged: false } });
  };
  w.postMessage(d);
}

window.addEventListener('message', e => {
  if (e.source !== parent) return;
  const d = e.data || {};
  if (d.type === 'run') start(d);
  else if (d.type === 'cancel') { workers.get(d.id)?.terminate(); workers.delete(d.id); inline.delete(d.id); }
  else if (d.type === 'sendResult') { if (workers.has(d.id)) workers.get(d.id).postMessage(d); else inline.get(d.id)?.(d); }
});
toParent({ type: 'ready' });
