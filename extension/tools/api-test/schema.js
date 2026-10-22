// Canonical Test Suite JSON v1.0 — nguồn sự thật duy nhất cho: màn Import, bộ chuyển Excel, runner, prompt AI.
//   ApiSchema.validate(input)  → { suite, errors: [{ path, msg }], warnings: [{ path, msg }] }
//                                 input là chuỗi JSON hoặc object. Có lỗi thì suite = null.
//   ApiSchema.parsePath(path)  → ['data', 'items', 0, 'id'] hoặc ném lỗi (chỉ nhận $, $.a, $.a.b, $.items[0].id)
// Mở rộng ngoài tài liệu gốc (tuỳ chọn, chỉ bộ chuyển Excel sinh ra): case.extract = { "TEN_BIEN": "$.data.id" }
// để case sau dùng {{TEN_BIEN}}.
// schemaVersion "1.1" = 1.0 + expect.maxTimeMs (ngưỡng thời gian phản hồi). Suite 1.0 vẫn hợp lệ nguyên vẹn;
// tool chỉ ghi "1.1" khi suite có dùng maxTimeMs (ApiSchema.versionFor).
(() => {
  const VERSION = '1.0';
  const VERSIONS = ['1.0', '1.1'];
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
  const BODY_MODES = ['json', 'raw', 'form-urlencoded'];
  const SOURCES = ['body', 'header'];
  const OPERATORS = ['exists', 'notExists', 'eq', 'ne', 'contains', 'notContains', 'type', 'in', 'gt', 'gte', 'lt', 'lte'];
  const NO_VALUE = ['exists', 'notExists'];
  const TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null'];
  const MAX_CASES = 1000;
  const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

  const KEYS = {
    root: ['schemaVersion', 'suite', 'cases'],
    suite: ['name', 'description'],
    case: ['id', 'group', 'name', 'description', 'priority', 'enabled', 'requestOverride', 'expect', 'note', 'extract'],
    override: ['method', 'url', 'queryParams', 'headers', 'body'],
    body: ['mode', 'value'],
    expect: ['statusCodes', 'assertions', 'maxTimeMs'],
    assertion: ['source', 'path', 'operator', 'value'],
  };

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isScalar = v => ['string', 'number', 'boolean'].includes(typeof v);

  function parsePath(path) {
    if (typeof path !== 'string' || !path.startsWith('$')) throw new Error('path phải bắt đầu bằng $');
    const out = [];
    const re = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]/y;
    let i = 1;
    while (i < path.length) {
      re.lastIndex = i;
      const m = re.exec(path);
      if (!m) throw new Error(`path "${path}" không thuộc dạng hỗ trợ ($, $.field, $.a.b, $.items[0].id)`);
      out.push(m[1] != null ? m[1] : Number(m[2]));
      i = re.lastIndex;
    }
    return out;
  }

  // URL override hợp lệ: link http(s) đầy đủ, bắt đầu bằng biến {{BASE_URL}}…, hoặc đường dẫn "/…" (nối vào origin của Base Request)
  const validUrl = u => /^https?:\/\/[^\s]+$/i.test(u) || /^\{\{\s*[A-Za-z_][\w.-]*\s*\}\}\S*$/.test(u) || /^\/\S*$/.test(u);

  function stripFence(text) {
    const t = String(text).replace(/^\uFEFF/, '').trim();
    const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
    return m ? m[1] : t;
  }

  function validate(input) {
    const errors = [], warnings = [];
    const err = (path, msg) => errors.push({ path, msg });
    const warn = (path, msg) => warnings.push({ path, msg });
    let data = input;
    if (typeof input === 'string') {
      const text = stripFence(input);
      if (!text) return { suite: null, errors: [{ path: '(JSON)', msg: 'Chưa có nội dung JSON' }], warnings };
      try { data = JSON.parse(text); } catch (e) {
        return { suite: null, errors: [{ path: '(JSON)', msg: 'JSON không hợp lệ: ' + e.message }], warnings };
      }
    }
    const unknown = (obj, allowed, path) => {
      for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${path}.${k}`, `field "${k}" không thuộc schema ${VERSION}`);
    };
    const optText = (obj, k, path) => { if (obj[k] != null && typeof obj[k] !== 'string') err(`${path}.${k}`, 'phải là chuỗi'); };

    if (!isObj(data)) return { suite: null, errors: [{ path: '$', msg: 'Gốc phải là object có schemaVersion, suite, cases' }], warnings };
    unknown(data, KEYS.root, '$');
    if (!VERSIONS.includes(data.schemaVersion)) err('schemaVersion', `bắt buộc là "${VERSION}" (hoặc "1.1" nếu dùng expect.maxTimeMs)`);
    if (!isObj(data.suite)) err('suite', 'bắt buộc là object có name');
    else {
      unknown(data.suite, KEYS.suite, 'suite');
      if (typeof data.suite.name !== 'string' || !data.suite.name.trim()) err('suite.name', 'bắt buộc, không rỗng');
      optText(data.suite, 'description', 'suite');
    }
    if (!Array.isArray(data.cases) || !data.cases.length) err('cases', 'bắt buộc là mảng có ít nhất 1 case');
    else if (data.cases.length > MAX_CASES) err('cases', `tối đa ${MAX_CASES} case mỗi lần chạy`);

    const ids = new Map();
    (Array.isArray(data.cases) ? data.cases : []).forEach((c, i) => {
      const p = `cases[${i}]`;
      if (!isObj(c)) return err(p, 'phải là object');
      unknown(c, KEYS.case, p);
      if (typeof c.id !== 'string' || !c.id.trim()) err(`${p}.id`, 'bắt buộc, là chuỗi không rỗng');
      else if (ids.has(c.id)) err(`${p}.id`, `trùng với cases[${ids.get(c.id)}].id ("${c.id}")`);
      else ids.set(c.id, i);
      if (typeof c.name !== 'string' || !c.name.trim()) err(`${p}.name`, 'bắt buộc, không rỗng');
      if (!PRIORITIES.includes(c.priority)) err(`${p}.priority`, `phải là một trong ${PRIORITIES.join(', ')}`);
      if (typeof c.enabled !== 'boolean') err(`${p}.enabled`, 'bắt buộc là true hoặc false');
      ['group', 'description', 'note'].forEach(k => optText(c, k, p));
      if (typeof c.note === 'string' && /^NEEDS_REVIEW/i.test(c.note.trim()) && c.enabled === true) {
        warn(`${p}.note`, 'case đánh dấu NEEDS_REVIEW nhưng đang enabled=true, hãy xác nhận trước khi chạy');
      }

      const o = c.requestOverride;
      if (o != null) {
        if (!isObj(o)) err(`${p}.requestOverride`, 'phải là object');
        else {
          unknown(o, KEYS.override, `${p}.requestOverride`);
          const op = `${p}.requestOverride`;
          if (o.method != null && (typeof o.method !== 'string' || !METHODS.includes(o.method.toUpperCase()))) err(`${op}.method`, `phải là một trong ${METHODS.join(', ')}`);
          if (o.url != null && (typeof o.url !== 'string' || !validUrl(o.url.trim()))) err(`${op}.url`, 'phải là link http(s) đầy đủ, template bắt đầu bằng {{BIEN}}, hoặc đường dẫn bắt đầu bằng /');
          if (o.queryParams != null) {
            if (!isObj(o.queryParams)) err(`${op}.queryParams`, 'phải là object');
            else for (const [k, v] of Object.entries(o.queryParams)) {
              if (!(v === null || isScalar(v) || (Array.isArray(v) && v.every(isScalar)))) err(`${op}.queryParams.${k}`, 'giá trị phải là chuỗi/số/boolean, mảng các giá trị đó, hoặc null để xoá');
            }
          }
          if (o.headers != null) {
            if (!isObj(o.headers)) err(`${op}.headers`, 'phải là object');
            else for (const [k, v] of Object.entries(o.headers)) {
              if (!HEADER_NAME.test(k)) err(`${op}.headers.${k}`, 'tên header không hợp lệ');
              if (!(v === null || isScalar(v))) err(`${op}.headers.${k}`, 'giá trị phải là chuỗi/số/boolean, hoặc null để xoá');
            }
          }
          if (o.body != null) {
            const bp = `${op}.body`;
            if (!isObj(o.body)) err(bp, 'phải là object { mode, value }');
            else {
              unknown(o.body, KEYS.body, bp);
              if (!BODY_MODES.includes(o.body.mode)) err(`${bp}.mode`, `phải là một trong ${BODY_MODES.join(', ')}`);
              if (!('value' in o.body)) err(`${bp}.value`, 'bắt buộc');
              else if (o.body.mode === 'raw' && typeof o.body.value !== 'string') err(`${bp}.value`, 'mode "raw" cần value là chuỗi');
              else if (o.body.mode === 'form-urlencoded' && !(typeof o.body.value === 'string' || (isObj(o.body.value) && Object.values(o.body.value).every(v => v === null || isScalar(v))))) {
                err(`${bp}.value`, 'mode "form-urlencoded" cần value là object các giá trị đơn, hoặc chuỗi a=1&b=2');
              }
            }
          }
        }
      }

      const e = c.expect;
      if (!isObj(e)) err(`${p}.expect`, 'bắt buộc là object có statusCodes và assertions');
      else {
        unknown(e, KEYS.expect, `${p}.expect`);
        if (e.maxTimeMs != null) {
          if (data.schemaVersion !== '1.1') err(`${p}.expect.maxTimeMs`, 'cần schemaVersion "1.1"');
          else if (!Number.isInteger(e.maxTimeMs) || e.maxTimeMs < 1 || e.maxTimeMs > 600000) err(`${p}.expect.maxTimeMs`, 'phải là số nguyên mili giây 1–600000');
        }
        if (!Array.isArray(e.statusCodes) || !e.statusCodes.length) err(`${p}.expect.statusCodes`, 'bắt buộc là mảng mã HTTP không rỗng');
        else {
          e.statusCodes.forEach((s, j) => { if (!Number.isInteger(s) || s < 100 || s > 599) err(`${p}.expect.statusCodes[${j}]`, 'phải là số nguyên 100–599'); });
          if (new Set(e.statusCodes).size !== e.statusCodes.length) warn(`${p}.expect.statusCodes`, 'có mã bị lặp');
        }
        if (!Array.isArray(e.assertions)) err(`${p}.expect.assertions`, 'bắt buộc là mảng (có thể rỗng)');
        else e.assertions.forEach((a, j) => {
          const ap = `${p}.expect.assertions[${j}]`;
          if (!isObj(a)) return err(ap, 'phải là object');
          unknown(a, KEYS.assertion, ap);
          if (!SOURCES.includes(a.source)) err(`${ap}.source`, 'phải là "body" hoặc "header"');
          if (a.source === 'header') {
            if (typeof a.path !== 'string' || !HEADER_NAME.test(a.path)) err(`${ap}.path`, 'với source "header", path là tên header, vd content-type');
          } else if (a.source === 'body') {
            try { parsePath(a.path); } catch (x) { err(`${ap}.path`, x.message); }
          }
          if (!OPERATORS.includes(a.operator)) return err(`${ap}.operator`, `phải là một trong ${OPERATORS.join(', ')}`);
          if (NO_VALUE.includes(a.operator)) return;
          if (!('value' in a)) return err(`${ap}.value`, `operator "${a.operator}" cần value`);
          if (a.operator === 'type' && !TYPES.includes(a.value)) err(`${ap}.value`, `với "type", value thuộc ${TYPES.join(', ')}`);
          if (a.operator === 'in' && !Array.isArray(a.value)) err(`${ap}.value`, 'với "in", value phải là mảng');
          if (['gt', 'gte', 'lt', 'lte'].includes(a.operator) && typeof a.value !== 'number') err(`${ap}.value`, `với "${a.operator}", value phải là số`);
        });
      }

      if (c.extract != null) {
        if (!isObj(c.extract)) err(`${p}.extract`, 'phải là object { "TEN_BIEN": "$.path" }');
        else for (const [k, v] of Object.entries(c.extract)) {
          if (!VAR_NAME.test(k)) err(`${p}.extract.${k}`, 'tên biến chỉ gồm chữ, số, _ . - và không bắt đầu bằng số');
          try { parsePath(v); } catch (x) { err(`${p}.extract.${k}`, x.message); }
        }
      }
    });

    if (Array.isArray(data.cases)) {
      const off = data.cases.filter(c => isObj(c) && c.enabled === false).length;
      if (off) warn('cases', `${off} case enabled=false sẽ được ghi SKIPPED`);
    }
    return { suite: errors.length ? null : data, errors, warnings };
  }

  // Ví dụ trong tài liệu (mục 2.4) — dùng cho nút "Tải JSON mẫu"
  const EXAMPLE = {
    schemaVersion: '1.0',
    suite: { name: 'User API', description: 'Kiểm thử tạo người dùng' },
    cases: [
      {
        id: 'TC-001', group: 'Positive', name: 'Tạo người dùng hợp lệ', description: 'Body đầy đủ và đúng định dạng', priority: 'P1', enabled: true,
        requestOverride: { body: { mode: 'json', value: { name: 'Nguyen Van A', email: 'valid@example.test' } } },
        expect: { statusCodes: [200, 201], assertions: [{ source: 'body', path: '$.data.id', operator: 'exists' }, { source: 'body', path: '$.success', operator: 'eq', value: true }] },
        note: '',
      },
      {
        id: 'TC-002', group: 'Negative', name: 'Email sai định dạng', description: 'Trả về lỗi validate email', priority: 'P1', enabled: true,
        requestOverride: { body: { mode: 'json', value: { name: 'Nguyen Van A', email: 'invalid-email' } } },
        expect: { statusCodes: [400, 422], assertions: [{ source: 'body', path: '$.message', operator: 'exists' }] },
        note: 'Không mặc định 4xx là FAIL',
      },
    ],
  };

  // Phiên bản nhỏ nhất đủ cho nội dung suite: chỉ lên "1.1" khi có case dùng maxTimeMs
  const versionFor = suite => ((suite?.cases || []).some(c => c?.expect?.maxTimeMs != null) ? '1.1' : VERSION);

  window.ApiSchema = { VERSION, VERSIONS, versionFor, METHODS, PRIORITIES, BODY_MODES, SOURCES, OPERATORS, NO_VALUE, TYPES, MAX_CASES, HEADER_NAME, validate, parsePath, stripFence, EXAMPLE };
})();
