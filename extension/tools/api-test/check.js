// Đọc cột "Mong muốn" / "Lưu biến", thay biến {{...}} và chấm điểm response.
// Mong muốn viết được 2 kiểu (xem phần Hướng dẫn trong index.html):
//   JSON:      {"status": 201, "body": {"data": {"lead_type": "individual", "id": "@exists"}}, "time": 2000}
//   Từng dòng: status = 201
//              data.lead_type = "individual"
//              data.id exists
(() => {
  // ---------- Biến ----------
  const rand = n => Math.floor(Math.random() * n);
  const DYNAMIC = {
    $timestamp: () => String(Date.now()),
    $isoTimestamp: () => new Date().toISOString(),
    $randomInt: () => String(rand(1_000_000)),
    $uuid: () => crypto.randomUUID(),
    $guid: () => crypto.randomUUID(), // tên biến động của Postman
    $randomUUID: () => crypto.randomUUID(),
    $randomPhone: () => '09' + String(rand(1e8)).padStart(8, '0'),
    $randomEmail: () => `qa${Date.now()}${rand(1000)}@yopmail.com`,
  };
  // Thay {{ten}} bằng giá trị. Biến chưa có giữ nguyên và ghi vào `missing`.
  function substitute(text, vars, missing) {
    if (!text) return text ?? '';
    return String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, name) => {
      if (DYNAMIC[name]) return DYNAMIC[name]();
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        const v = vars[name];
        return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      }
      missing?.add(name);
      return m;
    });
  }

  // "Key: Value" mỗi dòng hoặc JSON object → { key: value }. Giá trị null / để trống = bỏ header đó.
  function parseHeaders(text) {
    text = String(text ?? '').trim();
    if (!text) return {};
    if (text.startsWith('{')) {
      const o = JSON.parse(text);
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : String(v)]));
    }
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith('#') || l.startsWith('//')) continue;
      const i = l.indexOf(':');
      if (i < 1) throw new Error(`Dòng header "${l}" thiếu dấu ":" (viết dạng Tên: Giá trị)`);
      const v = l.slice(i + 1).trim();
      out[l.slice(0, i).trim()] = v === '' ? null : v;
    }
    return out;
  }

  // "a=1" mỗi dòng, "a=1&b=2" hoặc JSON object → [[k, v]]
  function parsePairs(text) {
    text = String(text ?? '').trim();
    if (!text) return [];
    if (text.startsWith('{')) return Object.entries(JSON.parse(text)).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')]);
    return text.split(/\r?\n|&/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(s => {
      const i = s.indexOf('=');
      return i < 0 ? [s, ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    });
  }

  // ---------- Đường dẫn trong JSON: data.items[0].id, data.items.0.id, data.items.length ----------
  const MISSING = Symbol('missing');
  function getPath(obj, path) {
    path = String(path ?? '').trim().replace(/^\$\.?/, '');
    if (!path) return obj;
    const keys = path.replace(/\[(\d+|"[^"]*"|'[^']*')\]/g, (_, k) => '.' + k.replace(/^["']|["']$/g, '')).split('.').filter(Boolean);
    let cur = obj;
    for (const k of keys) {
      if (cur == null) return MISSING;
      if (k === 'length' && (Array.isArray(cur) || typeof cur === 'string')) { cur = cur.length; continue; }
      if (typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return MISSING;
      cur = cur[k];
    }
    return cur;
  }

  // ---------- Đích kiểm tra ----------
  // "status" · "time" · "body" · "body.data.id" · "header.content-type" · còn lại coi là đường dẫn trong body
  function target(lhs) {
    const s = lhs.trim();
    const low = s.toLowerCase();
    if (['status', 'status_code', 'statuscode', 'http', 'code_http'].includes(low)) return { target: 'status' };
    if (['time', 'thoi_gian', 'responsetime', 'response_time', 'duration'].includes(low)) return { target: 'time' };
    if (['body', 'response', '$'].includes(low)) return { target: 'body', path: '' };
    const h = s.match(/^headers?\.(.+)$/i) || s.match(/^headers?\[["']?(.+?)["']?\]$/i);
    if (h) return { target: 'header', path: h[1] };
    const b = s.match(/^(?:body|response|\$)\.(.+)$/i);
    if (b) return { target: 'body', path: b[1] };
    return { target: 'body', path: s };
  }
  const labelOf = c => c.target === 'status' ? 'status' : c.target === 'time' ? 'time' : c.target === 'header' ? `header.${c.path}` : c.path ? c.path : 'body';

  // ---------- Đọc mong muốn ----------
  const OP_WORDS = [
    ['not contains', 'notContains'], ['không chứa', 'notContains'], ['contains', 'contains'], ['chứa', 'contains'],
    ['not exists', 'notExists'], ['không tồn tại', 'notExists'], ['exists', 'exists'], ['tồn tại', 'exists'],
    ['is empty', 'empty'], ['not empty', 'notEmpty'],
    ['matches', 'matches'], ['type', 'type'], ['length', 'len'], ['in', 'oneOf'],
    ['==', 'eq'], ['!=', 'ne'], ['>=', 'gte'], ['<=', 'lte'], ['=', 'eq'], ['>', 'gt'], ['<', 'lt'],
  ];
  const NO_VALUE = new Set(['exists', 'notExists', 'empty', 'notEmpty', 'any']);
  const parseValue = s => {
    s = s.trim();
    if (s === '') return '';
    try { return JSON.parse(s); } catch {}
    if (/^'.*'$|^".*"$/.test(s)) return s.slice(1, -1); // vd "^0\d{9}$" không phải JSON hợp lệ vì \d
    return s;
  };

  // "@exists", "@contains:abc", "@gt:5", "@type:string"… → { op, value }
  function matcher(str) {
    const m = String(str).match(/^@(\w+)(?::([\s\S]*))?$/);
    if (!m) return null;
    const alias = { exist: 'exists', notexists: 'notExists', notexist: 'notExists', notcontains: 'notContains', regex: 'matches', match: 'matches',
      notempty: 'notEmpty', length: 'len', oneof: 'oneOf', in: 'oneOf' };
    const op = alias[m[1].toLowerCase()] || m[1];
    if (!['exists', 'notExists', 'contains', 'notContains', 'matches', 'type', 'gt', 'gte', 'lt', 'lte', 'ne', 'eq', 'len', 'empty', 'notEmpty', 'oneOf', 'any'].includes(op)) return null;
    return { op, value: m[2] == null ? undefined : parseValue(m[2]) };
  }

  function parseExpect(text) {
    text = String(text ?? '').trim();
    if (!text) return [];
    if (text.startsWith('{')) {
      let o;
      try { o = JSON.parse(text); } catch (e) { throw new Error('Mong muốn bắt đầu bằng "{" nhưng không phải JSON hợp lệ: ' + e.message, { cause: e }); }
      return fromJson(o);
    }
    const checks = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim().replace(/[;,]$/, '');
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      if (/^\d{3}$|^\dxx$/i.test(line)) { checks.push({ target: 'status', op: 'eq', value: /^\d+$/.test(line) ? Number(line) : line }); continue; }
      const sp = line.search(/\s|[=!<>]/);
      if (sp < 1) throw new Error(`Không hiểu dòng "${line}". Viết dạng: <đích> <phép so> <giá trị>, vd status = 201`);
      const lhs = line.slice(0, sp), rest = line.slice(sp).trim();
      const hit = OP_WORDS.find(([w]) => rest.toLowerCase().startsWith(w) && (/^[=!<>]/.test(w) || rest.length === w.length || /\s/.test(rest[w.length])));
      if (!hit) throw new Error(`Dòng "${line}": không rõ phép so. Dùng =, !=, >, <, >=, <=, contains, not contains, exists, not exists, matches, type, length, in`);
      const [word, op] = hit;
      const value = NO_VALUE.has(op) ? undefined : parseValue(rest.slice(word.length));
      if (!NO_VALUE.has(op) && rest.slice(word.length).trim() === '') throw new Error(`Dòng "${line}": thiếu giá trị sau "${word}"`);
      checks.push({ ...target(lhs), op, value });
    }
    return checks;
  }

  function fromJson(o) {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error('Mong muốn dạng JSON phải là object, vd {"status": 200}');
    const checks = [];
    for (const [k, v] of Object.entries(o)) {
      const key = k.toLowerCase();
      if (key === 'status' || key === 'status_code' || key === 'statuscode') {
        const m = typeof v === 'string' && matcher(v);
        checks.push(m ? { target: 'status', ...m } : Array.isArray(v) ? { target: 'status', op: 'oneOf', value: v } : { target: 'status', op: 'eq', value: v });
      } else if (key === 'time' || key === 'maxtime' || key === 'max_time') {
        const m = typeof v === 'string' && matcher(v);
        checks.push(m ? { target: 'time', ...m } : { target: 'time', op: 'lte', value: Number(v) });
      } else if (key === 'headers' || key === 'header') {
        for (const [h, hv] of Object.entries(v || {})) {
          const m = typeof hv === 'string' && matcher(hv);
          checks.push({ target: 'header', path: h, ...(m || { op: hv == null ? 'notExists' : 'eq', value: hv == null ? undefined : String(hv) }) });
        }
      } else if (key === 'body' || key === 'response') flatten(v, '', checks);
      else if (key === 'bodycontains' || key === 'contains') checks.push({ target: 'body', path: '', op: 'contains', value: v });
      else flatten(v, k.replace(/^(body|response)\./i, ''), checks); // khoá lạ → đường dẫn trong body, vd "data.id": "@exists"
    }
    return checks;
  }

  // Object mong muốn chỉ cần là "tập con" của response: mỗi giá trị lá thành một điều kiện
  function flatten(v, path, out) {
    if (typeof v === 'string' && v.startsWith('@')) {
      const m = matcher(v);
      if (m) return out.push({ target: 'body', path, ...m });
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
      for (const [k, x] of Object.entries(v)) flatten(x, path ? `${path}.${k}` : k, out);
      return;
    }
    if (Array.isArray(v) && v.length) {
      v.forEach((x, i) => flatten(x, path ? `${path}[${i}]` : `[${i}]`, out));
      return;
    }
    out.push({ target: 'body', path, op: 'eq', value: v });
  }

  // ---------- Chấm ----------
  const show = v => v === MISSING ? '(không có)' : v === undefined ? '' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
  const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
  }
  const asText = v => typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  const OP_TEXT = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: 'chứa', notContains: 'không chứa', exists: 'tồn tại', notExists: 'không tồn tại',
    matches: 'khớp', type: 'kiểu', len: 'độ dài =', empty: 'rỗng', notEmpty: 'không rỗng', oneOf: 'thuộc', any: 'bất kỳ' };

  function compare(op, actual, expected, isStatus) {
    const has = actual !== MISSING && actual !== undefined;
    switch (op) {
      case 'any': return true;
      case 'exists': return has && actual !== null;
      case 'notExists': return !has || actual === null;
      case 'empty': return has && (actual === '' || actual === null || (Array.isArray(actual) && !actual.length) || (typeof actual === 'object' && actual && !Object.keys(actual).length));
      case 'notEmpty': return has && !compare('empty', actual);
    }
    if (!has) return op === 'ne' || op === 'notContains';
    switch (op) {
      case 'eq':
        if (isStatus && typeof expected === 'string' && /^\dxx$/i.test(expected)) return Math.floor(actual / 100) === Number(expected[0]);
        if (isStatus) return Number(actual) === Number(expected);
        return deepEqual(actual, expected);
      case 'ne': return !compare('eq', actual, expected, isStatus);
      case 'gt': return Number(actual) > Number(expected);
      case 'gte': return Number(actual) >= Number(expected);
      case 'lt': return Number(actual) < Number(expected);
      case 'lte': return Number(actual) <= Number(expected);
      case 'contains':
        if (Array.isArray(actual)) return actual.some(x => deepEqual(x, expected) || (typeof expected === 'object' && expected && typeof x === 'object' && x && Object.entries(expected).every(([k, v]) => deepEqual(x[k], v))));
        return asText(actual).toLowerCase().includes(asText(expected).toLowerCase());
      case 'notContains': return !compare('contains', actual, expected);
      case 'matches': {
        const m = String(expected).match(/^\/(.*)\/([a-z]*)$/s);
        return (m ? new RegExp(m[1], m[2]) : new RegExp(String(expected))).test(asText(actual));
      }
      case 'type': return typeOf(actual) === String(expected).toLowerCase();
      case 'len': return actual != null && actual.length === Number(expected);
      case 'oneOf': return Array.isArray(expected) && expected.some(e => compare('eq', actual, e, isStatus));
    }
    return false;
  }

  // res: { status, headers, bodyText, timeMs }  → [{ label, op, expected, actual, pass, note }]
  function evaluate(checks, res) {
    let json = MISSING;
    try { json = JSON.parse(res.bodyText); } catch {}
    const headers = Object.fromEntries(Object.entries(res.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return checks.map(c => {
      let actual;
      let note = '';
      if (c.target === 'status') actual = res.status;
      else if (c.target === 'time') actual = res.timeMs;
      else if (c.target === 'header') actual = headers[c.path.toLowerCase()] ?? MISSING;
      else if (!c.path) actual = json === MISSING ? res.bodyText : json;
      else if (json === MISSING) { actual = MISSING; note = 'Response không phải JSON'; }
      else actual = getPath(json, c.path);
      let pass;
      try { pass = compare(c.op, actual, c.value, c.target === 'status'); } catch (e) { pass = false; note = e.message; }
      if (!pass && !note && c.op === 'eq' && actual !== MISSING && typeOf(actual) !== typeOf(c.value) && c.target === 'body') note = `Khác kiểu: mong ${typeOf(c.value)}, thực tế ${typeOf(actual)}`;
      return {
        label: labelOf(c),
        op: OP_TEXT[c.op] || c.op,
        expected: NO_VALUE.has(c.op) ? '' : c.target === 'time' ? `${c.value} ms` : show(c.value),
        actual: c.target === 'time' ? `${actual} ms` : c.target === 'status' ? String(actual) : shorten(show(actual)),
        pass,
        note,
      };
    });
  }
  const shorten = s => (s.length > 300 ? s.slice(0, 300) + '…' : s);

  // ---------- Lưu biến từ response: "leadId = data.id" hoặc {"leadId": "data.id"} ----------
  function parseSaves(text) {
    text = String(text ?? '').trim();
    if (!text) return [];
    if (text.startsWith('{')) return Object.entries(JSON.parse(text)).map(([name, from]) => ({ name, from: String(from) }));
    return text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(s => {
      const i = s.indexOf('=');
      if (i < 1) throw new Error(`Dòng lưu biến "${s}" phải có dạng ten_bien = data.id`);
      return { name: s.slice(0, i).trim(), from: s.slice(i + 1).trim() };
    });
  }
  function extract(from, res) {
    const t = target(from);
    if (t.target === 'status') return res.status;
    if (t.target === 'time') return res.timeMs;
    if (t.target === 'header') return Object.entries(res.headers || {}).find(([k]) => k.toLowerCase() === t.path.toLowerCase())?.[1];
    let json;
    try { json = JSON.parse(res.bodyText); } catch { return t.path ? undefined : res.bodyText; }
    const v = getPath(json, t.path);
    return v === MISSING ? undefined : v;
  }

  // ---------- Gợi ý điều kiện từ mong muốn viết bằng lời ----------
  // "Trả về 201, message “Tạo thành công”" → status = 201 + message contains "Tạo thành công".
  // Chỉ là gợi ý: tester phải bấm áp dụng và được đánh dấu rõ trong bằng chứng.
  const KEYWORD_STATUS = [
    [/unauthori[sz]ed|unauthenticated|chưa đăng nhập|chua dang nhap|token (không|khong) hợp lệ|token sai|thiếu token|không gửi (token|authorization)/i, 'status = 401'],
    [/forbidden|không có quyền|khong co quyen|access denied/i, 'status = 403'],
    [/not found|không tìm thấy|khong tim thay/i, 'status = 404'],
    [/duplicate|conflict|đã tồn tại|da ton tai|bị trùng|bi trung|trùng (số|email|phone|sđt)/i, 'status in [400, 409, 422]'],
    [/validat|bắt buộc|bat buoc|required|không hợp lệ|khong hop le|invalid|sai định dạng|sai dinh dang|vượt quá|tối đa|tối thiểu|max length|min length|bad request/i, 'status in [400, 422]'],
    [/server error|lỗi hệ thống|loi he thong|internal error/i, 'status = 500'],
    [/tạo thành công|tao thanh cong|created/i, 'status in [200, 201]'],
    [/thành công|thanh cong|success|\bok\b|hợp lệ|hop le/i, 'status = 2xx'],
  ];
  function suggestExpect(text) {
    text = String(text ?? '').trim();
    if (!text) return null;
    const lines = [];
    const reasons = [];
    const code = text.match(/(?:status|code|http|mã|ma|trả về|tra ve|response|return)\D{0,12}\b([1-5]\d{2})\b/i) || text.match(/\b([2-5]\d{2})\b(?!\d)/);
    if (code) { lines.push(`status = ${code[1]}`); reasons.push(`thấy mã ${code[1]} trong mô tả`); }
    else {
      const hit = KEYWORD_STATUS.find(([re]) => re.test(text));
      if (hit) { lines.push(hit[1]); reasons.push(`đoán từ chữ "${text.match(hit[0])[0]}"`); }
    }
    // JSON response mẫu trong mô tả → so dạng tập con
    const j = text.match(/\{[\s\S]*\}/);
    if (j) {
      try {
        const checks = fromJson(JSON.parse(j[0]));
        for (const c of checks) {
          if (c.target === 'status' && lines.some(l => l.startsWith('status'))) continue;
          lines.push(`${c.target === 'status' ? 'status' : c.target === 'header' ? 'header.' + c.path : c.path || 'body'} ${{ eq: '=', exists: 'exists', notExists: 'not exists', contains: 'contains' }[c.op] || '='}${NO_VALUE.has(c.op) ? '' : ' ' + JSON.stringify(c.value)}`);
        }
        reasons.push('lấy các trường từ JSON mẫu trong mô tả');
      } catch {}
    }
    // Câu thông báo trong ngoặc kép → body chứa câu đó
    for (const m of text.matchAll(/[“"']([^“”"']{3,120})[”"']/g)) {
      if (j && j[0].includes(m[0])) continue;
      lines.push(`body contains ${JSON.stringify(m[1].trim())}`);
      reasons.push(`câu thông báo "${m[1].trim()}"`);
    }
    if (!lines.length) return null;
    return { expect: [...new Set(lines)].join('\n'), reasons };
  }

  // Biến {{ten}} dùng trong một đoạn chữ (bỏ biến có sẵn $...)
  const varsIn = text => [...String(text ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m => m[1]).filter(n => !DYNAMIC[n]);

  window.ApiCheck = { substitute, parseHeaders, parsePairs, parseExpect, evaluate, parseSaves, extract, getPath, suggestExpect, varsIn, MISSING };
})();
