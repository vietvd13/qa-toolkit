// Nhập Excel trực tiếp (không qua AI): các dòng đã nhận cột → Test Suite JSON v1.0, dùng chung runner.
// Cùng nguyên tắc với Prompt A: không đoán status. Case thiếu status rõ ràng, mong muốn viết bằng lời, hoặc có điều kiện
// ngoài schema → enabled=false, note bắt đầu bằng NEEDS_REVIEW (kèm gợi ý nếu tool đoán được) để tester sửa trước khi chạy.
//   ApiLegacy.toSuite(rows, { name }) với rows = [{ id, group, desc, priority, cells: { method, url, headers, query, body, expect, save } }]
(() => {
  const OP = { eq: 'eq', ne: 'ne', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', contains: 'contains', notContains: 'notContains', exists: 'exists', notExists: 'notExists', type: 'type', oneOf: 'in' };
  const OP_WORD = { matches: 'matches', len: 'length', empty: 'is empty', notEmpty: 'not empty', any: 'bất kỳ' };

  // data.items[0].id | data.items.0.id | body.data.id → $.data.items[0].id
  function toJsonPath(p) {
    p = String(p || '').trim().replace(/^\$\.?/, '');
    if (!p) return '$';
    const parts = p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    if (parts.at(-1) === 'length') return null;
    const path = '$' + parts.map(k => (/^\d+$/.test(k) ? `[${k}]` : `.${k}`)).join('');
    try { ApiSchema.parsePath(path); return path; } catch { return null; }
  }
  const statusList = v => {
    if (typeof v === 'number') return [v];
    const m = String(v).match(/^([1-5])xx$/i);
    if (m) return Array.from({ length: 100 }, (_, i) => Number(m[1]) * 100 + i);
    return /^\d{3}$/.test(String(v)) ? [Number(v)] : null;
  };

  function convertExpect(text, desc) {
    const review = [];
    let checks;
    try { checks = ApiCheck.parseExpect(text); } catch (e) {
      const s = ApiCheck.suggestExpect(text) || ApiCheck.suggestExpect(desc);
      return { expect: { statusCodes: [200], assertions: [] }, review: [`mong muốn chưa ở dạng máy đọc được (${e.message})${s ? `. Gợi ý: ${s.expect.replace(/\n/g, '; ')}` : ''}`], placeholder: true };
    }
    let statusCodes = null, maxTimeMs = null;
    const assertions = [];
    for (const c of checks) {
      const line = `${c.target === 'header' ? 'header.' + c.path : c.path || c.target} ${OP_WORD[c.op] || c.op}${c.value !== undefined ? ' ' + JSON.stringify(c.value) : ''}`;
      if (c.target === 'status') {
        const list = c.op === 'eq' ? statusList(c.value) : c.op === 'oneOf' && Array.isArray(c.value) ? c.value.flatMap(v => statusList(v) || []) : null;
        if (list?.length) statusCodes = [...new Set([...(statusCodes || []), ...list])];
        else review.push(`điều kiện status chưa hỗ trợ: ${line}`);
        continue;
      }
      if (c.target === 'time') { // schema 1.1: expect.maxTimeMs
        const n = Number(c.value);
        if ((c.op === 'lte' || c.op === 'lt') && Number.isFinite(n) && n >= 1) maxTimeMs = Math.round(c.op === 'lt' ? n - 1 : n);
        else review.push(`chỉ hỗ trợ kiểm tra thời gian dạng time <= N (ms): ${line}`);
        continue;
      }
      if (!OP[c.op]) { review.push(`phép so chưa có trong schema: ${line}`); continue; }
      const a = { source: c.target === 'header' ? 'header' : 'body', path: c.target === 'header' ? c.path : toJsonPath(c.path), operator: OP[c.op] };
      if (!a.path) { review.push(`đường dẫn chưa hỗ trợ: ${line}`); continue; }
      if (!ApiSchema.NO_VALUE.includes(a.operator)) a.value = c.value;
      if (a.operator === 'type' && !ApiSchema.TYPES.includes(a.value)) { review.push(`kiểu chưa hỗ trợ: ${line}`); continue; }
      if (['gt', 'gte', 'lt', 'lte'].includes(a.operator) && typeof a.value !== 'number') { review.push(`so sánh số cần giá trị là số: ${line}`); continue; }
      assertions.push(a);
    }
    const time = maxTimeMs ? { maxTimeMs } : {};
    if (!statusCodes) {
      const s = ApiCheck.suggestExpect(desc);
      review.unshift(`xác nhận expected HTTP status${s ? ` (gợi ý từ mô tả: ${s.expect.replace(/\n/g, '; ')})` : ''}`);
      return { expect: { statusCodes: [200], assertions, ...time }, review, placeholder: true };
    }
    return { expect: { statusCodes, assertions, ...time }, review };
  }

  function toSuite(rows, { name }) {
    const cases = [];
    const used = new Set();
    rows.forEach((r, n) => {
      const notes = [], review = [];
      let id = String(r.id || '').trim() || `TC-${String(n + 1).padStart(3, '0')}`;
      while (used.has(id)) { review.push(`TC ID "${id}" bị trùng trong file, đã đổi tên`); id = `${id}-${n + 1}`; }
      used.add(id);
      const c = r.cells;
      const o = {};
      if (c.method) o.method = c.method.toUpperCase();
      if (c.url) o.url = /^(https?:\/\/|\{\{|\/)/i.test(c.url) ? c.url : '/' + c.url;
      if (c.headers) { try { o.headers = ApiCheck.parseHeaders(c.headers); } catch (e) { review.push('cột Headers: ' + e.message); } }
      if (c.query) {
        try {
          const q = {};
          for (const [k, v] of ApiCheck.parsePairs(c.query)) q[k] = k in q ? [].concat(q[k], v) : v;
          o.queryParams = q;
        } catch (e) { review.push('cột Query: ' + e.message); }
      }
      if (c.body) {
        try { o.body = { mode: 'json', value: JSON.parse(c.body) }; }
        catch { o.body = { mode: 'raw', value: c.body }; if (/^\s*[[{]/.test(c.body) && !/\{\{/.test(c.body)) notes.push('Body không phải JSON hợp lệ nên gửi nguyên văn (raw)'); }
      }
      const ex = c.expect ? convertExpect(c.expect, r.desc) : { expect: { statusCodes: [200], assertions: [] }, review: ['chưa có Mong muốn, xác nhận expected HTTP status'], placeholder: true };
      review.push(...ex.review);

      let priority = 'P2';
      const pm = String(r.priority || '').trim().match(/^p?([0-3])$/i);
      if (pm) priority = 'P' + pm[1];
      else notes.push('Priority mặc định P2');

      const kase = {
        id, group: r.group || '', name: r.desc || id, description: r.desc || '', priority,
        enabled: review.length === 0,
        expect: ex.expect,
        note: [review.length ? 'NEEDS_REVIEW: ' + review.join('; ') : '', ...notes].filter(Boolean).join('. '),
      };
      if (Object.keys(o).length) kase.requestOverride = o;
      if (c.save) {
        try {
          const ext = {};
          for (const s of ApiCheck.parseSaves(c.save)) {
            const p = toJsonPath(s.from.replace(/^(body|response)\./i, ''));
            if (p) ext[s.name] = p;
          }
          if (Object.keys(ext).length) kase.extract = ext;
        } catch {}
      }
      cases.push(kase);
    });
    return { schemaVersion: ApiSchema.versionFor({ cases }), suite: { name: name || 'Test suite từ Excel', description: 'Chuyển trực tiếp từ file Excel trong QA API Toolkit' }, cases };
  }

  window.ApiLegacy = { toSuite, toJsonPath };
})();
