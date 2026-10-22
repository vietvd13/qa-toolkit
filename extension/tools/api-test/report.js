// Service: xuất báo cáo.
//   ApiReport.excel(run)  → Promise<Blob>  qa-api-report-<runId>.xlsx gồm Summary, Results, Evidence (liên kết bằng Evidence ID)
//   ApiReport.zip(run)    → Promise<Blob>  .zip gồm file Excel + evidence/<evidence-id>.json đầy đủ (đã che) + suite / scripts
// run = { runId, results, envName, mode, startedAt, finishedAt, redactSuite(text), scopeLabel?, presetName?,
//         items?: [{ requestName, path, method, url, suite, scripts: { pre, post } }]   ← lần chạy nhiều request
//         suite?, baseRequest?, scripts? }                                               ← định dạng cũ (một suite)
// Mỗi result có kase (case đã chạy) hoặc lấy theo vị trí run.suite.cases[i]; requestName / folderPath / collectionName nếu có.
// Mọi dữ liệu trong results đã được runner che (token, cookie, API key…) trước khi tới đây.
(() => {
  const CELL_LIMIT = 30000; // chừa chỗ cho dòng nhãn TRUNCATED (Excel tối đa 32.767 ký tự/ô)
  const STATUS_STYLE = { PASS: 'pass', FAIL: 'fail', ERROR: 'warn', SKIPPED: 'skip' };
  const ERROR_KIND = {
    build: 'Lỗi ghép request', script: 'Lỗi script', variable: 'Thiếu biến', policy: 'Bị chính sách bảo mật chặn', permission: 'Chưa có quyền Chrome',
    network: 'Lỗi mạng / timeout', evaluate: 'Lỗi khi chấm', cancelled: 'Đã dừng', dependency: 'Request phụ thuộc chưa lấy được biến',
  };

  const pretty = text => {
    if (text == null || text === '') return '';
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return String(text); }
  };
  const headerText = h => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  function fmtCodes(codes) {
    if (!codes?.length) return '';
    const set = new Set(codes);
    const groups = [];
    for (const c of [...set].sort((a, b) => a - b)) {
      const x = Math.floor(c / 100);
      if (!groups.includes(`${x}xx`) && Array.from({ length: 100 }, (_, i) => x * 100 + i).every(n => set.has(n))) groups.push(`${x}xx`);
    }
    return [...groups, ...[...set].sort((a, b) => a - b).filter(c => !groups.includes(`${Math.floor(c / 100)}xx`))].join(', ');
  }
  const passCount = r => r.assertions.filter(a => a.pass).length;
  function assertionSummary(r) {
    if (r.status === 'SKIPPED') return 'Không chạy';
    if (!r.statusCheck) {
      if (!r.response) return 'Không có response để chấm';
      return r.assertions.length ? `${passCount(r)}/${r.assertions.length} kiểm tra đạt` : 'Đã gửi, không có kiểm tra';
    }
    if (!r.statusCheck.actual && r.status === 'ERROR') return 'Không có response để chấm';
    const st = r.statusCheck.pass ? `Status ✓ ${r.statusCheck.actual}` : `Status ✗ ${r.statusCheck.actual} (mong ${fmtCodes(r.statusCheck.expected)})`;
    return r.assertions.length ? `${st} · ${passCount(r)}/${r.assertions.length} assertion đạt` : `${st} · không có assertion`;
  }
  function assertionLines(r) {
    if (r.status === 'SKIPPED') return `SKIPPED — lý do: ${r.reason}`;
    const lines = [];
    if (r.statusCheck) {
      lines.push(r.statusCheck.actual == null
        ? `[—] status in [${fmtCodes(r.statusCheck.expected)}] → không có response`
        : `[${r.statusCheck.pass ? 'PASS' : 'FAIL'}] status in [${fmtCodes(r.statusCheck.expected)}] → actual ${r.statusCheck.actual}`);
    }
    for (const a of r.assertions) {
      lines.push(a.source === 'script'
        ? `[${a.pass ? 'PASS' : 'FAIL'}] pm.test "${a.path}"${a.pass ? '' : ' — ' + a.reason}`
        : `[${a.pass ? 'PASS' : 'FAIL'}] ${a.source} ${a.path} ${a.operator}${a.expected !== '' ? ' ' + a.expected : ''} → actual ${a.actual}${a.reason ? ' — ' + a.reason : ''}`);
    }
    return lines.join('\n');
  }

  function counts(results) {
    const c = { total: results.length, PASS: 0, FAIL: 0, ERROR: 0, SKIPPED: 0 };
    for (const r of results) if (r && r.status in c) c[r.status]++;
    const executed = c.total - c.SKIPPED;
    c.executed = executed;
    c.passRate = executed > 0 ? c.PASS / executed : null; // không chia cho 0: chưa case nào chạy → "—"
    return c;
  }
  const pct = x => (x == null ? '—' : (x * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%');
  const caseOf = (run, r, i) => r.kase || run.suite?.cases[r.index ?? i] || { id: r.caseId, name: r.caseId, priority: '', expect: { statusCodes: [], assertions: [] } };
  const expectedText = k => (k.synthetic ? `${fmtCodes(k.expect.statusCodes)} (mặc định, request chưa có test case)` : fmtCodes(k.expect?.statusCodes)) + (k.expect?.maxTimeMs ? ` · ≤ ${k.expect.maxTimeMs} ms` : '');

  // Ô quá dài: ghi rõ TRUNCATED + nơi có bản đầy đủ, không cắt âm thầm
  function cell(text, evidenceId, label, flag) {
    const s = String(text ?? '');
    if (s.length <= CELL_LIMIT) return s;
    flag.truncated = true;
    return `TRUNCATED: ${label} dài ${s.length.toLocaleString('vi-VN')} ký tự, chỉ hiện ${CELL_LIMIT.toLocaleString('vi-VN')} ký tự đầu. Bản đầy đủ: evidence/${evidenceId}.json trong file ZIP.\n${s.slice(0, CELL_LIMIT)}`;
  }

  async function excel(run) {
    const { results } = run;
    const flag = { truncated: false };
    const c = counts(results);
    const H = v => ({ v, s: 'head' });
    const W = v => ({ v: v ?? '', s: 'wrap' });
    const M = v => ({ v: v ?? '', s: 'mono' });
    const T = ms => (ms ? { v: ms, s: 'datetime' } : W(''));
    const ST = st => ({ v: st, s: STATUS_STYLE[st] });

    const resultRows = [[
      'Run ID', 'Collection', 'Folder', 'Request', 'TC ID', 'Group', 'Test Case', 'Priority', 'Method', 'URL (masked)', 'Expected Status', 'Actual Status', 'Status',
      'Duration (ms)', 'Assertion Summary', 'Error Type', 'Error/Reason', 'Evidence ID', 'Note',
    ].map(H)];
    const evidenceRows = [[
      'Evidence ID', 'Request', 'TC ID', 'Run At', 'Request Method', 'Request URL (masked)', 'Request Headers (masked)', 'Request Body (masked)',
      'Response Status', 'Response Headers (masked)', 'Response Body (masked)', 'Assertion Details', 'Duration (ms)', 'Transport Error',
    ].map(H)];

    results.forEach((r, i) => {
      const k = caseOf(run, r, i);
      const req = r.request, res = r.response;
      resultRows.push([
        W(run.runId), W(r.collectionName || ''), W(r.folderPath || ''), W(r.requestName || ''), M(k.id), W(k.group), W(k.name), W(k.priority),
        W(req?.method || r.method || k.requestOverride?.method?.toUpperCase() || run.baseRequest?.method || ''),
        M(cell(req?.url || '', r.evidenceId, 'URL', flag)),
        W(expectedText(k)), res ? W(res.status) : W(''), ST(r.status),
        r.durationMs != null ? W(r.durationMs) : W(''), W(assertionSummary(r)), W(ERROR_KIND[r.errorKind] || ''),
        W(cell(r.reason, r.evidenceId, 'Lý do', flag)), M(r.evidenceId), W(k.note),
      ]);
      evidenceRows.push([
        M(r.evidenceId), W(r.requestName || ''), M(k.id), T(r.startedAt), W(req?.method || ''),
        M(cell(req?.url || '', r.evidenceId, 'Request URL', flag)),
        M(cell(headerText(req?.headers), r.evidenceId, 'Request Headers', flag)),
        M(cell(pretty(req?.body), r.evidenceId, 'Request Body', flag)),
        res ? W(`${res.status} ${res.statusText || ''}`.trim()) : W(''),
        M(cell(headerText(res?.headers), r.evidenceId, 'Response Headers', flag)),
        M(cell(res ? (res.truncated ? '[Response bị cắt ở giới hạn đọc của tool]\n' : '') + (r.storageTrimmed ? '[Bản lưu trên máy đã rút gọn body]\n' : '') + pretty(res.body) : '', r.evidenceId, 'Response Body', flag)),
        M(cell(assertionLines(r) + (r.warnings?.length ? '\n\nCảnh báo:\n' + r.warnings.join('\n') : '') + (r.scriptLogs?.length ? '\n\nConsole:\n' + r.scriptLogs.join('\n') : ''), r.evidenceId, 'Assertion Details', flag)),
        r.durationMs != null ? W(r.durationMs) : W(''),
        W(r.transportError || (r.status === 'ERROR' ? r.reason : '')),
      ]);
    });

    const items = run.items || [];
    const hasPre = items.some(x => x.scripts?.pre?.trim()) || !!run.scripts?.pre?.trim();
    const hasPost = items.some(x => x.scripts?.post?.trim()) || !!run.scripts?.post?.trim();
    const summary = [
      [H('Field'), H('Giá trị')],
      ['Run ID', run.runId],
      ...(run.presetName ? [['Preset', run.presetName]] : []),
      ...(items.length ? [['Phạm vi', run.scopeLabel || ''], ['Số request', items.length], ['Requests', items.map(x => `${x.method} ${x.path}`).join('\n')]]
        : [['Suite', run.suite?.suite.name || ''], ['Mô tả suite', run.suite?.suite.description || ''], ['Base Request', run.baseRequest ? `${run.baseRequest.method} ${run.baseRequest.url}` : '']]),
      ['Environment', run.envName], ['Runner', run.mode === 'web' ? 'Bản web (máy chủ Node gọi API)' : 'Chrome extension'],
      ['Started At', T(run.startedAt)], ['Finished At', T(run.finishedAt)],
      ['Total', c.total], [ST('PASS'), c.PASS], [ST('FAIL'), c.FAIL], [ST('ERROR'), c.ERROR], [ST('SKIPPED'), c.SKIPPED],
      ['Pass Rate', `${pct(c.passRate)} (${c.PASS} PASS / ${c.executed} case đã chạy; SKIPPED không tính vào mẫu số)`],
      ['Pre-request script', hasPre ? 'Có (xem scripts/ trong file ZIP)' : 'Không'],
      ['Post-response script', hasPost ? 'Có (mỗi pm.test là một assertion)' : 'Không'],
      ['Dữ liệu nhạy cảm', 'Token, cookie, Authorization, API key, mật khẩu đã được che bằng **** trong mọi sheet'],
      ['Nội dung bị cắt', flag.truncated ? 'CÓ: một số ô ghi TRUNCATED, xuất ZIP để có evidence đầy đủ' : 'Không'],
      ...(results.some(r => r.storageTrimmed) ? [['Bản lưu', 'Kết quả mở lại từ bộ nhớ máy: body dài đã được rút gọn khi lưu']] : []),
      [H('Chú giải trạng thái'), H('')],
      [ST('PASS'), 'Có response, HTTP status thuộc Expected Status và mọi assertion đạt'],
      [ST('FAIL'), 'Có response nhưng status code, ít nhất một assertion hoặc một pm.test sai so với Expected'],
      [ST('ERROR'), 'Không kiểm thử được: timeout, lỗi kết nối, thiếu variable, host không có trong Allowed hosts, script lỗi, request phụ thuộc thất bại'],
      [ST('SKIPPED'), 'Case enabled=false, không được chọn, hoặc tester bấm Dừng (trước khi tới case hoặc khi case đang chạy)'],
    ].map(row => row.map(x => (x && typeof x === 'object' ? x : W(x))));

    const blob = await Xlsx.write([
      { name: 'Summary', rows: summary, cols: [24, 90] },
      { name: 'Results', rows: resultRows, freeze: true, cols: [20, 18, 18, 26, 12, 16, 36, 9, 9, 50, 14, 12, 11, 12, 34, 20, 50, 24, 30] },
      { name: 'Evidence', rows: evidenceRows, freeze: true, cols: [24, 24, 12, 20, 10, 50, 44, 56, 14, 44, 70, 70, 12, 36] },
    ]);
    blob.truncated = flag.truncated; // giao diện báo cho tester khi có ô TRUNCATED
    return blob;
  }

  const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'request';

  async function zip(run) {
    const xlsx = new Uint8Array(await (await excel(run)).arrayBuffer());
    const entries = [[`qa-api-report-${run.runId}.xlsx`, xlsx]];
    run.results.forEach((r, i) => {
      const k = caseOf(run, r, i);
      entries.push([`evidence/${r.evidenceId}.json`, JSON.stringify({
        evidenceId: r.evidenceId, runId: r.runId, collection: r.collectionName || null, folder: r.folderPath || null, requestName: r.requestName || null,
        caseId: k.id, name: k.name, group: k.group || '', priority: k.priority,
        status: r.status, errorType: r.errorKind || null, reason: r.reason, runAt: r.startedAt ? new Date(r.startedAt).toISOString() : null, durationMs: r.durationMs,
        expect: k.expect, defaultExpectation: !!k.synthetic, statusCheck: r.statusCheck, assertions: r.assertions,
        request: r.request, response: r.response, transportError: r.transportError || null,
        warnings: r.warnings, extracted: r.extracted, scriptLogs: r.scriptLogs || [], redacted: true,
      }, null, 2)]);
    });
    const files = [];
    if (run.items?.length) {
      run.items.forEach((x, n) => {
        const dir = `${String(n + 1).padStart(2, '0')}-${slug(x.requestName)}`;
        if (x.suite) entries.push([`suites/${dir}.json`, run.redactSuite(JSON.stringify(x.suite, null, 2))]);
        if (x.scripts?.pre?.trim()) entries.push([`scripts/${dir}/pre-request.js`, run.redactSuite(x.scripts.pre)]);
        if (x.scripts?.post?.trim()) entries.push([`scripts/${dir}/post-response.js`, run.redactSuite(x.scripts.post)]);
      });
      files.push('suites/<nn>-<request>.json: bộ test case của từng request (nếu có).', 'scripts/<nn>-<request>/: script trước / sau request (nếu có).');
    } else {
      entries.push(['suite.json', run.redactSuite(JSON.stringify(run.suite, null, 2))]);
      if (run.scripts?.pre?.trim()) entries.push(['scripts/pre-request.js', run.redactSuite(run.scripts.pre)]);
      if (run.scripts?.post?.trim()) entries.push(['scripts/post-response.js', run.redactSuite(run.scripts.post)]);
      files.push('suite.json: bộ test case đã chạy. scripts/: script trước / sau request (nếu có).');
    }
    entries.push(['README.txt', [
      `QA API Toolkit — Run ${run.runId}`,
      `${run.items?.length ? `Phạm vi: ${run.scopeLabel || ''}` : `Suite: ${run.suite?.suite.name || ''}`} · Environment: ${run.envName}`,
      '',
      `qa-api-report-${run.runId}.xlsx: Summary, Results, Evidence.`,
      'evidence/<Evidence ID>.json: request, response, assertion đầy đủ của từng case (không bị cắt).',
      ...files,
      'Mọi token, cookie, Authorization, API key, mật khẩu đã được che bằng ****.',
    ].join('\r\n')]);
    return Xlsx.zip(entries);
  }

  window.ApiReport = { excel, zip, counts, pct, pretty, headerText, fmtCodes, assertionSummary, assertionLines, expectedText, ERROR_KIND };
})();
