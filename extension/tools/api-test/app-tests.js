// UI · Kiểm thử API — Test case của một request: tab Tests (lưu biến từ response + danh sách case), Test Case Builder (form),
// nhập case từ AI / Excel / JSON. Mọi kiểm tra hợp lệ đều qua ApiSchema.validate (schema.js), không lặp lại luật ở đây.
(() => {
  const { $, $$, esc, toast, debounce } = Ui;
  const App = window.App;
  const S = App.state;
  const PAGE_SIZES = [25, 50, 100];
  const tv = { search: '', priority: '', status: '', page: 0, size: 25, sel: new Set(), reqId: null };
  const needsReview = c => /^\s*NEEDS_REVIEW/i.test(c.note || '');
  const PRIO_BADGE = { P0: 'badge-error', P1: 'badge-warning', P2: 'badge-secondary', P3: 'badge-skip' };
  const OP_LABEL = {
    exists: 'tồn tại', notExists: 'không tồn tại', eq: 'bằng', ne: 'khác', contains: 'chứa', notContains: 'không chứa',
    type: 'có kiểu', in: 'thuộc danh sách', gt: 'lớn hơn', gte: 'lớn hơn hoặc bằng', lt: 'nhỏ hơn', lte: 'nhỏ hơn hoặc bằng',
  };
  const TYPE_LABEL = { string: 'chuỗi (string)', number: 'số (number)', boolean: 'true / false', object: 'object', array: 'mảng (array)', null: 'null' };
  const reqNode = () => { const n = App.W?.get(S.sel); return n?.type === 'request' ? n : null; };
  const slugName = s => Ui.slug(s);

  App.initTests = () => {
    $('#promptText').value = ApiPrompt.TEXT;
  };

  // ================= TAB TESTS =================
  App.renderTests = () => {
    const n = reqNode();
    const box = $('#rqTests');
    if (!n) return;
    if (tv.reqId !== n.id) { tv.reqId = n.id; tv.sel.clear(); tv.search = ''; tv.priority = ''; tv.status = ''; tv.page = 0; }
    const s = App.W.suite(n.id);
    box.innerHTML = `
      <section class="tests-sec" id="tcSec"></section>
      <section class="tests-sec">
        <div class="sec-h"><h3><span class="ms sm" aria-hidden="true">bolt</span>Lưu biến từ response ${App.helpBtn?.('chain', 'Lấy giá trị từ response (vd TOKEN) cho request sau dùng. Bấm tên field trong Response để thêm nhanh.') || ''}</h3></div>
        <div id="exList"></div>
      </section>`;
    renderExtract(n);
    renderCases(n, s);
  };
  App.on('suite', id => { if (reqNode()?.id === id) { App.renderTests(); App.renderRequestCounts?.(); } });

  // ---------- Rule lưu biến (extract của request) ----------
  function renderExtract(n) {
    const lock = App.isBusy() ? ' disabled' : '';
    $('#exList').innerHTML = (n.extract.length ? `<div class="ex-table">${n.extract.map((x, i) => `<div class="ex-row" data-i="${i}">
        <input type="text" class="mono-in" data-ex="name" value="${esc(x.name)}" placeholder="TOKEN" aria-label="Tên biến ${i + 1}"${lock}>
        <span class="muted" aria-hidden="true">←</span>
        <select data-ex="source" aria-label="Lấy từ"${lock}><option value="body"${x.source === 'body' ? ' selected' : ''}>Body (JSON)</option><option value="header"${x.source === 'header' ? ' selected' : ''}>Header</option><option value="status"${x.source === 'status' ? ' selected' : ''}>Status code</option></select>
        <input type="text" class="mono-in" data-ex="path" value="${esc(x.path)}" placeholder="${x.source === 'header' ? 'x-request-id' : '$.data.access_token'}" aria-label="Đường dẫn ${i + 1}"${x.source === 'status' ? ' disabled' : lock}>
        <button type="button" class="icon-btn" data-ex-del="${i}" aria-label="Xoá rule ${esc(x.name)}"${lock}><span class="ms sm" aria-hidden="true">delete</span></button>
        <span class="ex-msg small err-t" data-ex-msg="${i}"></span>
      </div>`).join('')}</div>` : '<p class="kv-empty">Chưa lưu biến nào. Không bắt buộc.</p>')
      + `<div class="kv-foot"><button type="button" class="btn btn-ghost btn-sm" data-ex-add${lock}><span class="ms sm" aria-hidden="true">add</span>Thêm biến</button></div>`;
    n.extract.forEach((x, i) => validateExtract(x, i));
  }
  function validateExtract(x, i) {
    let msg = '';
    if (x.name && !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(x.name)) msg = 'Tên chỉ gồm chữ, số, _ . -';
    else if (x.source === 'body') { try { ApiSchema.parsePath(x.path || '$'); } catch (e) { msg = e.message; } }
    const el = $(`[data-ex-msg="${i}"]`);
    if (el) el.textContent = msg;
  }
  $('#rqTests').addEventListener('input', e => {
    const f = e.target.dataset.ex;
    if (!f) return;
    const n = reqNode(), i = Number(e.target.closest('.ex-row').dataset.i);
    n.extract[i][f] = e.target.value.trim();
    validateExtract(n.extract[i], i);
    App.W.touch(n.id);
  });
  $('#rqTests').addEventListener('change', e => {
    if (e.target.dataset.ex === 'source') { const n = reqNode(); const i = Number(e.target.closest('.ex-row').dataset.i); n.extract[i].source = e.target.value; App.W.touch(n.id); renderExtract(n); }
  });

  // ---------- Danh sách test case ----------
  const expectText = c => `${ApiReport.fmtCodes(c.expect.statusCodes)}${c.expect.assertions.length ? ` · ${c.expect.assertions.length} kiểm tra` : ''}${c.expect.maxTimeMs ? ` · ≤ ${c.expect.maxTimeMs} ms` : ''}`;
  function tvMatch(c) {
    if (tv.priority && c.priority !== tv.priority) return false;
    if (tv.status === 'enabled' && !c.enabled) return false;
    if (tv.status === 'disabled' && c.enabled) return false;
    if (tv.status === 'review' && !needsReview(c)) return false;
    if (!tv.search) return true;
    return [c.id, c.name, c.group, c.description, c.note].some(x => Ui.norm(x).includes(Ui.norm(tv.search)));
  }
  function renderCases(n, s) {
    const sec = $('#tcSec');
    const lock = App.isBusy() ? ' disabled' : '';
    if (!s) {
      sec.innerHTML = `<div class="sec-h"><h3><span class="ms sm" aria-hidden="true">checklist</span>Test cases ${App.helpBtn?.('tests', 'Hướng dẫn test case') || ''}</h3></div>
        <div class="empty-state small">
          <span class="ms lg" aria-hidden="true">checklist</span><h3>Chưa có test case</h3>
          <p class="muted">Không có test case, Runner vẫn chạy request này một lần với kiểm tra mặc định <b>HTTP 2xx</b>. Thêm case để kiểm tra status, field, kiểu dữ liệu… mà không cần viết code.</p>
          <div class="tc-start">
            <button type="button" class="welcome-act" data-tc="new"${lock}><span class="ms" aria-hidden="true">edit_note</span><b>Thêm thủ công</b><span>Form: status, field, giá trị mong đợi</span></button>
            <button type="button" class="welcome-act" data-tc="import-ai"${lock}><span class="ms" aria-hidden="true">auto_awesome</span><b>Excel → JSON bằng AI</b><span>Copy prompt, gửi kèm Excel cho AI</span></button>
            <button type="button" class="welcome-act" data-tc="import-excel"${lock}><span class="ms" aria-hidden="true">table_view</span><b>Upload Excel</b><span>Map cột, tool tự chuyển</span></button>
            <button type="button" class="welcome-act" data-tc="import-json"${lock}><span class="ms" aria-hidden="true">data_object</span><b>Import JSON</b><span>Test Suite JSON v1.0</span></button>
          </div>
          <p class="muted small">Chưa có file? <button type="button" class="link-btn" data-sample-xlsx>Tải file Excel mẫu</button> · <button type="button" class="link-btn" data-help="excel">Cách viết cột Expected</button></p>
        </div>`;
      return;
    }
    const cs = s.cases;
    const review = cs.filter(needsReview).length, disabled = cs.filter(c => !c.enabled).length, enabled = cs.length - disabled;
    const rows = cs.map((c, i) => ({ c, i })).filter(({ c }) => tvMatch(c));
    const pages = Math.max(1, Math.ceil(rows.length / tv.size));
    tv.page = Math.min(tv.page, pages - 1);
    const page = rows.slice(tv.page * tv.size, (tv.page + 1) * tv.size);
    for (const id of [...tv.sel]) if (!cs.some(c => c.id === id)) tv.sel.delete(id);
    const tile = (st, icon, label, num, kind = '') => `<button type="button" class="stat ${kind}${tv.status === st ? ' on' : ''}" data-stat="${st}" aria-pressed="${tv.status === st}"><span class="ms" aria-hidden="true">${icon}</span><span class="stat-n">${num}</span><span class="stat-l">${label}</span></button>`;
    sec.innerHTML = `
      <div class="sec-h row">
        <div class="min0"><h3><span class="ms sm" aria-hidden="true">checklist</span>Test cases <span class="muted small">· ${esc(s.suite.name)}</span> ${App.helpBtn?.('tests', 'Hướng dẫn test case') || ''}</h3></div>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm btn-primary" data-tc="new"${lock}><span class="ms sm" aria-hidden="true">add</span>Thêm case</button>
        <button type="button" class="btn btn-sm" data-tc="import-menu" aria-haspopup="menu"${lock}><span class="ms sm" aria-hidden="true">upload</span>Nhập</button>
        <button type="button" class="icon-btn" data-tc="suite-menu" aria-haspopup="menu" aria-label="Thao tác với bộ test case"><span class="ms" aria-hidden="true">more_horiz</span></button>
      </div>
      ${App.tip?.('cases', '<b>Mẹo:</b> bấm một dòng để sửa case. Bấm các ô thống kê để lọc. Chạy bằng nút <b>Run tests</b> ở trên, kết quả và evidence nằm ở khu vực <b>Runner</b>.', 'results') || ''}
      <div class="stats">${tile('', 'inventory_2', 'Tổng', cs.length)}${tile('enabled', 'play_circle', 'Sẽ chạy', enabled, 'ok')}${tile('review', 'rate_review', 'Cần review', review, review ? 'warn' : '')}${tile('disabled', 'block', 'Đang tắt', disabled)}</div>
      ${review ? `<div class="d-msg warn"><span class="ms sm" aria-hidden="true">rate_review</span><span><b>${review} case NEEDS_REVIEW</b>: tool không đoán được Expected nên để tắt. Mở từng case, kiểm tra Expected rồi bật.</span>${tv.status !== 'review' ? '<button type="button" class="btn btn-sm" data-stat="review">Xem</button>' : ''}</div>` : ''}
      <div class="toolbar list-toolbar">
        <div class="search-box"><span class="ms sm" aria-hidden="true">search</span><input type="search" id="tcSearch" value="${esc(tv.search)}" placeholder="Tìm TC ID, tên, group…" aria-label="Tìm test case"></div>
        <label class="visually-hidden" for="tcPrio">Priority</label>
        <select id="tcPrio" class="filter-select"><option value="">Mọi priority</option>${ApiSchema.PRIORITIES.map(p => `<option${p === tv.priority ? ' selected' : ''}>${p}</option>`).join('')}</select>
      </div>
      ${tv.sel.size ? `<div class="bulk-bar" role="region" aria-label="Thao tác hàng loạt"><span>${tv.sel.size} case đang chọn</span>
        <button type="button" class="btn btn-sm" data-bulk="enable"${lock}><span class="ms sm" aria-hidden="true">toggle_on</span>Bật</button>
        <button type="button" class="btn btn-sm" data-bulk="disable"${lock}><span class="ms sm" aria-hidden="true">toggle_off</span>Tắt</button>
        <button type="button" class="btn btn-sm" data-bulk="delete"${lock}><span class="ms sm" aria-hidden="true">delete</span>Xoá</button>
        <button type="button" class="btn btn-ghost btn-sm" data-bulk="clear">Bỏ chọn</button></div>` : ''}
      <div class="table-wrap data-wrap">
        <table class="data pv">
          <thead><tr><th class="cb"><input type="checkbox" id="tcAll" aria-label="Chọn tất cả case trong bộ lọc"${lock}></th><th>TC ID</th><th>Tên</th><th>Priority</th><th>Expected</th><th>Trạng thái</th><th class="act"><span class="visually-hidden">Sửa</span></th></tr></thead>
          <tbody>${page.map(({ c, i }) => {
            const st = needsReview(c) ? '<span class="badge badge-warning"><span class="ms sm" aria-hidden="true">rate_review</span> Review</span>'
              : c.enabled ? '<span class="badge badge-success"><span class="ms sm" aria-hidden="true">toggle_on</span> Bật</span>' : '<span class="badge badge-skip"><span class="ms sm" aria-hidden="true">toggle_off</span> Tắt</span>';
            return `<tr data-i="${i}" tabindex="0" class="${tv.sel.has(c.id) ? 'sel' : ''}${c.enabled ? '' : ' off'}">
              <td class="cb" data-label=""><input type="checkbox" data-sel="${i}" ${tv.sel.has(c.id) ? 'checked' : ''} aria-label="Chọn ${esc(c.id)}"${lock}></td>
              <td class="id" data-label="TC ID">${esc(c.id)}</td>
              <td class="name" data-label="Tên"><span class="clamp-1">${esc(c.name)}</span>${c.group ? `<span class="sub clamp-1">${esc(c.group)}</span>` : ''}</td>
              <td data-label="Priority"><span class="badge ${PRIO_BADGE[c.priority]}">${esc(c.priority)}</span></td>
              <td class="num" data-label="Expected">${esc(expectText(c))}</td>
              <td data-label="Trạng thái">${st}</td>
              <td class="act"><button type="button" class="icon-btn" data-edit="${i}" aria-label="Sửa ${esc(c.id)}"${lock}><span class="ms" aria-hidden="true">edit</span></button></td>
            </tr>`;
          }).join('') || `<tr class="empty-row"><td colspan="7"><div class="empty">Không có case nào khớp bộ lọc. <button type="button" class="link-btn" data-clear-filter>Xoá bộ lọc</button></div></td></tr>`}</tbody>
        </table>
      </div>
      <div class="pager">${rows.length > PAGE_SIZES[0] ? `<span class="muted small">${tv.page * tv.size + 1}–${Math.min(rows.length, (tv.page + 1) * tv.size)} / ${rows.length}</span><span class="spacer"></span>
        <label class="small muted" for="tcSize">Mỗi trang</label><select id="tcSize" class="pg-size">${PAGE_SIZES.map(x => `<option${x === tv.size ? ' selected' : ''}>${x}</option>`).join('')}</select>
        <button type="button" class="icon-btn" data-pg="-1" aria-label="Trang trước"${tv.page === 0 ? ' disabled' : ''}><span class="ms" aria-hidden="true">chevron_left</span></button>
        <span class="small">Trang ${tv.page + 1}/${pages}</span>
        <button type="button" class="icon-btn" data-pg="1" aria-label="Trang sau"${tv.page >= pages - 1 ? ' disabled' : ''}><span class="ms" aria-hidden="true">chevron_right</span></button>` : `<span class="muted small">${rows.length} / ${cs.length} case</span>`}</div>`;
    const all = $('#tcAll');
    const ids = rows.map(r => r.c.id);
    all.checked = ids.length > 0 && ids.every(id => tv.sel.has(id));
    all.indeterminate = !all.checked && ids.some(id => tv.sel.has(id));
  }
  const rerender = () => { const n = reqNode(); if (n) renderCases(n, App.W.suite(n.id)); };
  const saveSuite = (n, suite) => { App.W.setSuite(n.id, suite); App.emit('suite', n.id); };
  $('#rqTests').addEventListener('input', debounce(e => { if (e.target.id === 'tcSearch') { tv.search = e.target.value.trim(); tv.page = 0; rerender(); const i = $('#tcSearch'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); } }, 200));
  $('#rqTests').addEventListener('change', e => {
    const n = reqNode();
    if (!n) return;
    const s = App.W.suite(n.id);
    if (e.target.id === 'tcPrio') { tv.priority = e.target.value; tv.page = 0; rerender(); return; }
    if (e.target.id === 'tcSize') { tv.size = Number(e.target.value); tv.page = 0; rerender(); return; }
    if (e.target.id === 'tcAll') {
      for (const c of s.cases.filter(tvMatch)) { if (e.target.checked) tv.sel.add(c.id); else tv.sel.delete(c.id); }
      rerender();
      return;
    }
    const sel = e.target.closest('[data-sel]');
    if (sel) { const id = s.cases[Number(sel.dataset.sel)].id; if (sel.checked) tv.sel.add(id); else tv.sel.delete(id); rerender(); $(`[data-sel="${sel.dataset.sel}"]`)?.focus(); }
  });
  $('#rqTests').addEventListener('click', async e => {
    const n = reqNode();
    if (!n) return;
    if (e.target.closest('[data-ex-add]')) { n.extract.push({ name: '', source: 'body', path: '$.' }); App.W.touch(n.id); renderExtract(n); $('#exList .ex-row:last-child [data-ex="name"]')?.focus(); return; }
    const exd = e.target.closest('[data-ex-del]');
    if (exd) { n.extract.splice(Number(exd.dataset.exDel), 1); App.W.touch(n.id); renderExtract(n); return; }
    const s = App.W.suite(n.id);
    const st = e.target.closest('[data-stat]');
    if (st) { tv.status = tv.status === st.dataset.stat ? '' : st.dataset.stat; tv.page = 0; rerender(); return; }
    if (e.target.closest('[data-clear-filter]')) { Object.assign(tv, { search: '', priority: '', status: '', page: 0 }); rerender(); return; }
    const pg = e.target.closest('[data-pg]');
    if (pg) { tv.page += Number(pg.dataset.pg); rerender(); return; }
    const b = e.target.closest('[data-bulk]');
    if (b) {
      const a = b.dataset.bulk;
      if (a === 'clear') { tv.sel.clear(); rerender(); return; }
      if (a === 'delete') {
        const ok = await Ui.confirmBox(`Xoá ${tv.sel.size} test case?`, '<p>Có thể hoàn tác ngay sau khi xoá.</p>', 'Xoá');
        if (!ok) return;
        const before = JSON.parse(JSON.stringify(s));
        const next = { ...s, cases: s.cases.filter(c => !tv.sel.has(c.id)) };
        saveSuite(n, next.cases.length ? next : null);
        const k = tv.sel.size;
        tv.sel.clear();
        toast(`Đã xoá ${k} case`, 'info', 10000, { label: 'Hoàn tác', fn: () => saveSuite(n, before) });
        return;
      }
      const on = a === 'enable';
      let k = 0;
      for (const c of s.cases) if (tv.sel.has(c.id) && c.enabled !== on) { c.enabled = on; k++; }
      const rv = on ? s.cases.filter(c => tv.sel.has(c.id) && needsReview(c)).length : 0;
      saveSuite(n, s);
      toast(`${on ? 'Bật' : 'Tắt'} ${k} case${rv ? ` · ${rv} case NEEDS_REVIEW: kiểm tra Expected trước khi chạy` : ''}`, rv ? 'warn' : 'ok');
      return;
    }
    const tc = e.target.closest('[data-tc]');
    if (tc) {
      const a = tc.dataset.tc;
      if (a === 'new') openCaseEditor({ requestId: n.id, index: -1 }, tc);
      else if (a.startsWith('import-') && a !== 'import-menu') openImport(n.id, a.slice(7), tc);
      else if (a === 'import-menu') Ui.menu(tc, [
        { label: 'Excel → JSON bằng AI', icon: 'auto_awesome', action: () => openImport(n.id, 'ai', tc) },
        { label: 'Upload Excel', icon: 'table_view', action: () => openImport(n.id, 'excel', tc) },
        { label: 'Import JSON', icon: 'data_object', action: () => openImport(n.id, 'json', tc) },
      ]);
      else if (a === 'suite-menu') Ui.menu(tc, [
        { label: 'Đổi tên bộ test case', icon: 'edit', action: async () => { const v = await Ui.promptBox({ title: 'Đổi tên bộ test case', label: 'Tên', value: s.suite.name }); if (v) { s.suite.name = v; saveSuite(n, s); } } },
        { label: 'Tải JSON', icon: 'download', action: () => Ui.download(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), `${slugName(s.suite.name)}.json`) },
        { label: 'Run tests', icon: 'play_arrow', action: () => App.runRequest?.(n.id) },
        'sep',
        { label: 'Xoá toàn bộ test case', icon: 'delete', danger: true, disabled: App.isBusy(), action: async () => {
          const ok = await Ui.confirmBox('Xoá toàn bộ test case?', `<p>Xoá ${s.cases.length} case của <b>${esc(n.name)}</b>. Có thể hoàn tác ngay sau khi xoá.</p>`, 'Xoá');
          if (!ok) return;
          const before = JSON.parse(JSON.stringify(s));
          saveSuite(n, null);
          toast('Đã xoá bộ test case', 'info', 10000, { label: 'Hoàn tác', fn: () => saveSuite(n, before) });
        } },
      ]);
      return;
    }
    if (e.target.closest('.cb')) return;
    const tr = e.target.closest('tr[data-i]');
    if (tr && !App.isBusy()) openCaseEditor({ requestId: n.id, index: Number(tr.dataset.i) }, e.target.closest('[data-edit]') || tr);
  });
  $('#rqTests').addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr || e.target !== tr) return;
    if (e.key === 'Enter') { e.preventDefault(); openCaseEditor({ requestId: reqNode().id, index: Number(tr.dataset.i) }, tr); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling)?.focus(); }
  });

  // ================= TEST CASE BUILDER =================
  // target: { requestId, index (-1 = case mới) } hoặc { staging: true, index } (sửa case lỗi trong màn nhập)
  const ce = { target: null, base: null, assertions: [], extract: [], query: [], headers: [], tab: 'form' };
  const VT = { auto: 'Tự nhận', string: 'Chữ', number: 'Số', boolean: 'true/false', null: 'null', json: 'JSON' };
  function valueToForm(v) {
    if (v === undefined) return { text: '', vt: 'auto' };
    if (v === null) return { text: 'null', vt: 'null' };
    if (typeof v === 'string') return { text: v, vt: /^(-?\d+(\.\d+)?|true|false|null)$/.test(v) || /^[[{"]/.test(v.trim()) ? 'string' : 'auto' };
    if (typeof v === 'number') return { text: String(v), vt: 'number' };
    if (typeof v === 'boolean') return { text: String(v), vt: 'boolean' };
    return { text: JSON.stringify(v), vt: 'json' };
  }
  // Đọc giá trị theo kiểu tester chọn; 'auto': số / true / false / null / JSON nếu đọc được, còn lại là chữ
  function formToValue(text, vt, op) {
    const t = String(text ?? '');
    if (op === 'in') {
      try { const a = JSON.parse(t); if (Array.isArray(a)) return a; } catch {}
      return t.split(',').map(x => x.trim()).filter(Boolean).map(x => formToValue(x, 'auto', 'eq'));
    }
    if (['gt', 'gte', 'lt', 'lte'].includes(op) || vt === 'number') { const n = Number(t); return t.trim() !== '' && Number.isFinite(n) ? n : t; }
    if (op === 'type') return t;
    if (vt === 'string') return t;
    if (vt === 'boolean') return t.trim() === 'true';
    if (vt === 'null') return null;
    if (vt === 'json') { try { return JSON.parse(t); } catch { return t; } }
    const s = t.trim();
    if (s === '') return '';
    try { return JSON.parse(s); } catch { return t; }
  }
  const overrideRows = obj => Object.entries(obj || {}).map(([key, v]) => ({ key, value: v === null ? '' : Array.isArray(v) ? v.join(',') : String(v), enabled: v !== null }));
  // Đường dẫn JSON có trong response gần nhất (gợi ý cho ô Path)
  function responsePaths(requestId) {
    const body = App.sends?.get(requestId)?.result?.response?.body;
    if (!body) return [];
    let v;
    try { v = JSON.parse(body); } catch { return []; }
    const out = [];
    const walk = (x, p, d) => {
      if (out.length > 300 || d > 8) return;
      if (p !== '$') out.push(p);
      if (Array.isArray(x)) { if (x.length) walk(x[0], `${p}[0]`, d + 1); }
      else if (x && typeof x === 'object') for (const k of Object.keys(x)) if (/^[A-Za-z_$][\w$-]*$/.test(k)) walk(x[k], `${p}.${k}`, d + 1);
    };
    walk(v, '$', 0);
    return out;
  }
  function targetSuite(t) { return t.staging ? imp.data : App.W.suite(t.requestId); }
  function openCaseEditor(target, opener) {
    const s = targetSuite(target);
    const isNew = target.index < 0;
    const c = isNew ? {
      id: nextId(s), group: '', name: '', description: '', priority: 'P2', enabled: true,
      expect: { statusCodes: [200], assertions: [] }, note: '',
    } : JSON.parse(JSON.stringify(s.cases[target.index]));
    ce.target = target;
    ce.base = c;
    const ex = c.expect && typeof c.expect === 'object' ? c.expect : {};
    ce.assertions = (Array.isArray(ex.assertions) ? ex.assertions : []).map(a => ({ source: a.source || 'body', path: a.path || '', operator: a.operator || 'exists', ...valueToForm(a.value) }));
    ce.extract = Object.entries(c.extract || {}).map(([name, path]) => ({ name, path }));
    ce.query = overrideRows(c.requestOverride?.queryParams);
    ce.headers = overrideRows(c.requestOverride?.headers);
    $('#caseTitle').textContent = isNew ? 'Test case mới' : String(c.id ?? 'Test case');
    $('#caseSub').textContent = target.staging ? 'Đang sửa case trong file nhập (chưa lưu vào request)' : App.W.get(target.requestId)?.name || '';
    $('#ceErrors').classList.add('hidden');
    showCeTab('form');
    renderCaseForm(c);
    Ui.openDrawer($('#caseDrawer'), opener);
    $('#ceName').focus();
  }
  App.openCaseEditor = openCaseEditor;
  function nextId(s) {
    const ids = new Set((s?.cases || []).map(c => c.id));
    for (let i = (s?.cases.length || 0) + 1; ; i++) { const id = `TC-${String(i).padStart(3, '0')}`; if (!ids.has(id)) return id; }
  }
  function showCeTab(tab) {
    ce.tab = tab;
    for (const t of ['form', 'json']) { $('#ce-' + t).classList.toggle('hidden', t !== tab); $('#ce-tab-' + t).setAttribute('aria-selected', t === tab); }
    $('#ceHint').textContent = tab === 'form' ? 'Request override để trống = dùng request gốc.' : 'JSON phải đúng schema.';
  }
  const QUICK_CODES = ['200', '201', '204', '2xx', '400', '401', '403', '404', '409', '422', '500'];
  function renderCaseForm(c) {
    const o = c.requestOverride || {};
    const body = o.body;
    const bodyText = !body ? '' : body.mode === 'json' ? JSON.stringify(body.value, null, 2) : typeof body.value === 'string' ? body.value : JSON.stringify(body.value, null, 2);
    const s = targetSuite(ce.target);
    const groups = [...new Set((s?.cases || []).map(x => x.group).filter(Boolean))];
    const codes = Array.isArray(c.expect?.statusCodes) ? c.expect.statusCodes : [];
    const advOpen = !!(c.requestOverride && Object.keys(c.requestOverride).length);
    $('#ce-form').innerHTML = `
      <div class="form-grid">
        <div><label for="ceId">TC ID</label><input id="ceId" type="text" class="mono-in" value="${esc(c.id ?? '')}"></div>
        <div><label for="cePriority">Priority</label><select id="cePriority">${ApiSchema.PRIORITIES.map(p => `<option${p === c.priority ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="sw-cell"><span class="label">Chạy case này</span><label class="switch-row compact"><input type="checkbox" role="switch" id="ceEnabled" ${c.enabled !== false ? 'checked' : ''}><span class="switch" aria-hidden="true"></span><span class="switch-text"><b>Bật</b></span></label></div>
        <div class="span-3"><label for="ceName">Tên test case</label><input id="ceName" type="text" value="${esc(c.name ?? '')}" placeholder="vd Tạo người dùng với email hợp lệ" data-autofocus></div>
        <div class="span-3 two"><div><label for="ceGroup">Group</label><input id="ceGroup" type="text" value="${esc(c.group || '')}" list="ceGroups" placeholder="Positive, Negative, Validate…"><datalist id="ceGroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
          <div><label for="ceDesc">Mô tả</label><input id="ceDesc" type="text" value="${esc(c.description || '')}"></div></div>
      </div>
      <fieldset class="fs">
        <legend><span class="ms sm" aria-hidden="true">fact_check</span>Kết quả mong đợi</legend>
        <label for="ceStatus">HTTP status hợp lệ <span class="hint">cách nhau bằng dấu phẩy · 4xx = mọi mã 400–499</span></label>
        <input id="ceStatus" type="text" class="mono-in" value="${esc(ApiReport.fmtCodes(codes))}" placeholder="200, 201">
        <div class="code-chips" role="group" aria-label="Chọn nhanh status">${QUICK_CODES.map(q => `<button type="button" class="chip" data-code="${q}">${q}</button>`).join('')}</div>
        <div class="two"><div><label for="ceTime">Thời gian phản hồi tối đa <span class="hint">ms · bỏ trống = không kiểm tra</span></label><input id="ceTime" type="number" min="1" max="600000" inputmode="numeric" value="${esc(c.expect?.maxTimeMs ?? '')}" placeholder="vd 2000"></div></div>
        <div class="as-head"><span class="label">Kiểm tra response</span><span class="hint">không bắt buộc · trường trong body JSON hoặc header</span></div>
        <div id="ceAsserts"></div>
        <datalist id="cePaths">${responsePaths(ce.target.requestId).map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <button type="button" class="btn btn-ghost btn-sm" data-as-add><span class="ms sm" aria-hidden="true">add</span>Thêm kiểm tra</button>
      </fieldset>
      <fieldset class="fs">
        <legend><span class="ms sm" aria-hidden="true">bolt</span>Lưu biến cho case sau <span class="hint">không bắt buộc</span></legend>
        <div id="ceExtract"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-ext-add><span class="ms sm" aria-hidden="true">add</span>Lưu biến</button>
      </fieldset>
      <details class="adv fs-adv"${advOpen ? ' open' : ''}>
        <summary><span class="ms sm chev" aria-hidden="true">chevron_right</span><span class="ms sm" aria-hidden="true">http</span>Nâng cao: ghi đè request cho case này ${advOpen ? '<span class="badge badge-info">đang dùng</span>' : ''}</summary>
        <div class="fs">
          <div class="ov-line">
            <div><label for="ceMethod">Method</label><select id="ceMethod"><option value="">(như request)</option>${ApiSchema.METHODS.map(m => `<option${String(o.method || '').toUpperCase() === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
            <div><label for="ceUrl">URL <span class="hint">/path, {{baseUrl}}/… hoặc link đầy đủ</span></label><input id="ceUrl" type="text" class="mono-in" value="${esc(o.url || '')}" placeholder="(như request)"></div>
          </div>
          <h4 class="mini-h">Query params <span class="hint">bỏ tích = xoá param của request gốc</span></h4><div class="kv" id="ceQuery"></div>
          <h4 class="mini-h">Headers <span class="hint">bỏ tích = xoá header của request gốc</span></h4><div class="kv" id="ceHeaders"></div>
          <h4 class="mini-h">Body <span class="hint">thay toàn bộ body của request</span></h4>
          <select id="ceBodyMode" aria-label="Body mode"><option value="">(như request)</option>${ApiSchema.BODY_MODES.map(m => `<option value="${m}"${body?.mode === m ? ' selected' : ''}>${m === 'form-urlencoded' ? 'x-www-form-urlencoded' : m === 'raw' ? 'raw (gửi nguyên văn, vd JSON sai cú pháp)' : m}</option>`).join('')}</select>
          <textarea id="ceBody" class="mono-in code-input${body ? '' : ' hidden'}" rows="8" spellcheck="false" aria-label="Body override">${esc(bodyText)}</textarea>
        </div>
      </details>
      <div class="ce-note"><label for="ceNote">Ghi chú</label><textarea id="ceNote" rows="2">${esc(c.note || '')}</textarea>${needsReview(c) ? '<p class="warn-t small"><span class="ms sm" aria-hidden="true">rate_review</span> Case đang NEEDS_REVIEW: kiểm tra Kết quả mong đợi, xoá chữ NEEDS_REVIEW ở ghi chú và bật case khi đã chắc chắn.</p>' : ''}</div>`;
    renderAsserts();
    renderCeExtract();
    renderCodeChips();
    Ui.kvEditor($('#ceQuery'), () => ce.query, { enabled: true, keyPh: 'key', valPh: 'value', empty: 'Không ghi đè query param.', addText: 'Thêm param' }).render();
    Ui.kvEditor($('#ceHeaders'), () => ce.headers, { enabled: true, keyPh: 'Header-Name', valPh: 'value', empty: 'Không ghi đè header.', addText: 'Thêm header' }).render();
  }
  function parseCodes(text) {
    const codes = [], bad = [];
    for (const t of String(text).split(/[\s,;]+/).filter(Boolean)) {
      const m = t.match(/^([1-5])xx$/i);
      if (m) for (let x = 0; x < 100; x++) codes.push(Number(m[1]) * 100 + x);
      else if (/^\d{3}$/.test(t)) codes.push(Number(t));
      else bad.push(t);
    }
    return { codes: [...new Set(codes)], bad };
  }
  function renderCodeChips() {
    const { codes } = parseCodes($('#ceStatus').value);
    const set = new Set(codes);
    $$('#ce-form [data-code]').forEach(b => {
      const q = b.dataset.code;
      const on = /xx$/.test(q) ? Array.from({ length: 100 }, (_, i) => Number(q[0]) * 100 + i).every(x => set.has(x)) : set.has(Number(q));
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
  }
  function renderAsserts() {
    const NUM = ['gt', 'gte', 'lt', 'lte'];
    $('#ceAsserts').innerHTML = ce.assertions.length ? `<div class="as-table">${ce.assertions.map((a, j) => {
      const noVal = ApiSchema.NO_VALUE.includes(a.operator);
      let val;
      if (noVal) val = '<span class="muted small as-novalue">(không cần giá trị)</span>';
      else if (a.operator === 'type') val = `<select data-as="text" aria-label="Kiểu mong đợi ${j + 1}">${ApiSchema.TYPES.map(t => `<option value="${t}"${a.text === t ? ' selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select>`;
      else if (a.operator === 'in') val = `<input type="text" class="mono-in" data-as="text" value="${esc(a.text)}" placeholder="active, pending hoặc [1, 2]" aria-label="Danh sách giá trị ${j + 1}">`;
      else if (NUM.includes(a.operator)) val = `<input type="number" class="mono-in" data-as="text" value="${esc(a.text)}" placeholder="0" aria-label="Giá trị số ${j + 1}">`;
      else val = `<div class="as-val"><input type="text" class="mono-in" data-as="text" value="${esc(a.text)}" placeholder="${a.operator === 'contains' ? 'chuỗi cần có' : 'giá trị'}" aria-label="Giá trị ${j + 1}"${a.vt === 'null' ? ' disabled' : ''}>
        <select data-as="vt" aria-label="Kiểu giá trị ${j + 1}" title="Kiểu của giá trị: 123 (Số) khác &quot;123&quot; (Chữ)">${Object.entries(VT).map(([k, l]) => `<option value="${k}"${a.vt === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
      return `<div class="as-row" data-j="${j}">
        <select data-as="source" aria-label="Nguồn ${j + 1}"><option value="body"${a.source === 'body' ? ' selected' : ''}>Body</option><option value="header"${a.source === 'header' ? ' selected' : ''}>Header</option></select>
        <input type="text" class="mono-in" data-as="path" value="${esc(a.path)}" placeholder="${a.source === 'header' ? 'content-type' : '$.data.id'}" aria-label="Trường ${j + 1}" ${a.source === 'body' ? 'list="cePaths"' : ''}>
        <select data-as="operator" aria-label="Phép so ${j + 1}">${ApiSchema.OPERATORS.map(op => `<option value="${op}"${op === a.operator ? ' selected' : ''}>${OP_LABEL[op] || op}</option>`).join('')}</select>
        ${val}
        <button type="button" class="icon-btn" data-as-del="${j}" aria-label="Xoá kiểm tra ${j + 1}"><span class="ms sm" aria-hidden="true">delete</span></button>
        <span class="as-sum small muted">${esc(assertSentence(a))}</span>
      </div>`;
    }).join('')}</div>` : '<p class="kv-empty">Chưa có kiểm tra nào: case chỉ kiểm tra HTTP status.</p>';
  }
  function assertSentence(a) {
    const where = a.source === 'header' ? `Header ${a.path || '…'}` : `${a.path || '$…'}`;
    if (ApiSchema.NO_VALUE.includes(a.operator)) return `${where} ${OP_LABEL[a.operator]}`;
    const v = formToValue(a.text, a.vt, a.operator);
    return `${where} ${OP_LABEL[a.operator] || a.operator} ${a.operator === 'type' ? TYPE_LABEL[a.text] || a.text : JSON.stringify(v)}`;
  }
  function renderCeExtract() {
    $('#ceExtract').innerHTML = ce.extract.length ? `<div class="ex-table">${ce.extract.map((x, i) => `<div class="ex-row slim" data-k="${i}">
      <input type="text" class="mono-in" data-ce-ex="name" value="${esc(x.name)}" placeholder="ORDER_ID" aria-label="Tên biến ${i + 1}">
      <span class="muted" aria-hidden="true">←</span>
      <input type="text" class="mono-in" data-ce-ex="path" value="${esc(x.path)}" placeholder="$.data.id" list="cePaths" aria-label="Đường dẫn ${i + 1}">
      <button type="button" class="icon-btn" data-ce-ex-del="${i}" aria-label="Xoá"><span class="ms sm" aria-hidden="true">delete</span></button></div>`).join('')}</div>`
      : '<p class="muted small">Dùng khi case sau cần giá trị từ case này (vd id vừa tạo). Biến dùng được ở case sau và request sau trong cùng lần chạy.</p>';
  }
  $('#ce-form').addEventListener('input', e => {
    const f = e.target.dataset.as;
    if (f) {
      const row = e.target.closest('.as-row');
      const a = ce.assertions[Number(row.dataset.j)];
      a[f] = e.target.value;
      row.querySelector('.as-sum').textContent = assertSentence(a);
      return;
    }
    const x = e.target.dataset.ceEx;
    if (x) { ce.extract[Number(e.target.closest('.ex-row').dataset.k)][x] = e.target.value.trim(); return; }
    if (e.target.id === 'ceStatus') renderCodeChips();
  });
  $('#ce-form').addEventListener('change', e => {
    const f = e.target.dataset.as;
    if (f === 'operator' || f === 'source' || f === 'vt') {
      const a = ce.assertions[Number(e.target.closest('.as-row').dataset.j)];
      a[f] = e.target.value;
      if (f === 'operator' && a.operator === 'type' && !ApiSchema.TYPES.includes(a.text)) a.text = 'string';
      if (f === 'vt' && a.vt === 'null') a.text = 'null';
      renderAsserts();
      $(`#ceAsserts .as-row[data-j="${e.target.closest('.as-row').dataset.j}"] [data-as="${f}"]`)?.focus();
    }
    if (e.target.id === 'ceBodyMode') $('#ceBody').classList.toggle('hidden', !e.target.value);
  });
  $('#ce-form').addEventListener('click', e => {
    if (e.target.closest('[data-as-add]')) {
      ce.assertions.push({ source: 'body', path: '$.', operator: 'exists', text: '', vt: 'auto' });
      renderAsserts();
      $('#ceAsserts .as-row:last-child [data-as="path"]')?.focus();
      return;
    }
    const del = e.target.closest('[data-as-del]');
    if (del) { ce.assertions.splice(Number(del.dataset.asDel), 1); renderAsserts(); return; }
    if (e.target.closest('[data-ext-add]')) { ce.extract.push({ name: '', path: '$.' }); renderCeExtract(); $('#ceExtract .ex-row:last-child input')?.focus(); return; }
    const xd = e.target.closest('[data-ce-ex-del]');
    if (xd) { ce.extract.splice(Number(xd.dataset.ceExDel), 1); renderCeExtract(); return; }
    const code = e.target.closest('[data-code]');
    if (code) {
      const inp = $('#ceStatus');
      const { codes } = parseCodes(inp.value);
      const q = code.dataset.code;
      const add = /xx$/.test(q) ? Array.from({ length: 100 }, (_, i) => Number(q[0]) * 100 + i) : [Number(q)];
      const on = code.classList.contains('on');
      const next = on ? codes.filter(c => !add.includes(c)) : [...new Set([...codes, ...add])];
      inp.value = ApiReport.fmtCodes(next.sort((a, b) => a - b));
      renderCodeChips();
    }
  });
  // Đọc form → case (giữ field ngoài form). Trả { kase, errors }
  function readCaseForm() {
    const errors = [];
    const k = JSON.parse(JSON.stringify(ce.base));
    const txt = id => $('#' + id).value.trim();
    k.id = txt('ceId');
    k.name = txt('ceName');
    k.priority = $('#cePriority').value;
    k.enabled = $('#ceEnabled').checked;
    for (const [f, id] of [['group', 'ceGroup'], ['description', 'ceDesc'], ['note', 'ceNote']]) { const v = txt(id); if (v || f in ce.base) k[f] = v; else delete k[f]; }
    const { codes, bad } = parseCodes(txt('ceStatus'));
    for (const b of bad) errors.push({ path: 'HTTP status', msg: `"${b}" không phải mã HTTP` });
    if (!codes.length && !bad.length) errors.push({ path: 'HTTP status', msg: 'Cần ít nhất một mã, vd 200' });
    const time = txt('ceTime');
    k.expect = { statusCodes: codes, assertions: ce.assertions.map(a => {
      const x = { source: a.source, path: String(a.path).trim(), operator: a.operator };
      if (!ApiSchema.NO_VALUE.includes(a.operator)) x.value = formToValue(a.text, a.vt, a.operator);
      return x;
    }) };
    if (time) {
      const n = Number(time);
      if (!Number.isInteger(n) || n < 1) errors.push({ path: 'Thời gian tối đa', msg: 'phải là số nguyên mili giây' });
      else k.expect.maxTimeMs = n;
    }
    const ext = {};
    for (const x of ce.extract) if (x.name) ext[x.name] = x.path || '$';
    if (Object.keys(ext).length) k.extract = ext; else delete k.extract;
    const o = {};
    if ($('#ceMethod').value) o.method = $('#ceMethod').value;
    if (txt('ceUrl')) o.url = txt('ceUrl');
    const kvObj = rows => { const r = {}; for (const x of rows) if (x.key.trim()) r[x.key.trim()] = x.enabled === false ? null : x.value; return Object.keys(r).length ? r : null; };
    const q = kvObj(ce.query); if (q) o.queryParams = q;
    const h = kvObj(ce.headers); if (h) o.headers = h;
    const mode = $('#ceBodyMode').value;
    if (mode) {
      const raw = $('#ceBody').value;
      if (mode === 'json') { try { o.body = { mode, value: JSON.parse(raw) }; } catch (e) { errors.push({ path: 'Body', msg: 'JSON không hợp lệ: ' + e.message }); } }
      else if (mode === 'form-urlencoded') { let v = raw; try { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) v = p; } catch {} o.body = { mode, value: v }; }
      else o.body = { mode, value: raw };
    }
    if (Object.keys(o).length) k.requestOverride = o; else delete k.requestOverride;
    return { kase: k, errors };
  }
  function caseErrors(errors) {
    const box = $('#ceErrors');
    box.classList.toggle('hidden', !errors.length);
    const FIELD = { path: 'Trường', operator: 'Phép so', value: 'Giá trị', source: 'Nguồn' };
    const label = p => p.replace(/^expect\.statusCodes.*/, 'HTTP status')
      .replace(/^expect\.assertions\[(\d+)\](?:\.(\w+))?/, (_, i, f) => `Kiểm tra ${Number(i) + 1}${f ? ` › ${FIELD[f] || f}` : ''}`)
      .replace(/^expect\.maxTimeMs/, 'Thời gian tối đa').replace(/^extract\./, 'Lưu biến › ').replace(/^requestOverride\./, 'Ghi đè request › ');
    box.innerHTML = errors.length ? `<p class="v-title err-t"><span class="ms sm" aria-hidden="true">error</span> Chưa lưu được · ${errors.length} lỗi</p><ul>${errors.map(x => `<li><code>${esc(label(x.path))}</code> ${esc(x.msg)}</li>`).join('')}</ul>` : '';
    if (errors.length) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#caseDrawer .drawer-tabs').addEventListener('click', e => {
    const t = e.target.closest('[data-ce]');
    if (!t || t.dataset.ce === ce.tab) return;
    if (t.dataset.ce === 'json') {
      const { kase, errors } = readCaseForm();
      if (errors.length) { caseErrors(errors); return; }
      $('#ceJsonText').value = JSON.stringify(kase, null, 2);
      caseErrors([]);
      showCeTab('json');
    } else {
      let k;
      try { k = JSON.parse($('#ceJsonText').value); } catch (x) { caseErrors([{ path: 'JSON', msg: x.message }]); return; }
      if (!k || typeof k !== 'object') { caseErrors([{ path: 'JSON', msg: 'Case phải là object' }]); return; }
      k.expect = k.expect && typeof k.expect === 'object' ? k.expect : { statusCodes: [], assertions: [] };
      ce.base = k;
      ce.assertions = (Array.isArray(k.expect.assertions) ? k.expect.assertions : []).map(a => ({ source: a.source || 'body', path: a.path || '', operator: a.operator || 'exists', ...valueToForm(a.value) }));
      ce.extract = Object.entries(k.extract || {}).map(([name, path]) => ({ name, path }));
      ce.query = overrideRows(k.requestOverride?.queryParams);
      ce.headers = overrideRows(k.requestOverride?.headers);
      caseErrors([]);
      showCeTab('form');
      renderCaseForm(k);
    }
  });
  $('#btnSaveCase').addEventListener('click', () => {
    let kase, errors = [];
    if (ce.tab === 'json') { try { kase = JSON.parse($('#ceJsonText').value); } catch (x) { errors = [{ path: 'JSON', msg: x.message }]; } }
    else ({ kase, errors } = readCaseForm());
    if (errors.length) { caseErrors(errors); return; }
    const t = ce.target;
    if (t.staging) {
      imp.data.cases[t.index] = kase;
      imp.data.schemaVersion = ApiSchema.versionFor(imp.data);
      const v = ApiSchema.validate(imp.data);
      const mine = v.errors.filter(x => x.path.startsWith(`cases[${t.index}]`)).map(x => ({ ...x, path: x.path.replace(`cases[${t.index}].`, '') }));
      if (mine.length) { caseErrors(mine); return; }
      Ui.closeDrawer();
      setImport(imp.data, imp.source);
      toast(`Đã sửa ${kase.id}`, 'ok', 2000);
      return;
    }
    const n = App.W.get(t.requestId);
    const cur = App.W.suite(t.requestId);
    const base = cur ? JSON.parse(JSON.stringify(cur)) : { schemaVersion: ApiSchema.VERSION, suite: { name: `${n.name} — test cases` }, cases: [] };
    if (t.index < 0) base.cases.push(kase); else base.cases[t.index] = kase;
    base.schemaVersion = ApiSchema.versionFor(base);
    const i = t.index < 0 ? base.cases.length - 1 : t.index;
    const { suite, errors: ve } = ApiSchema.validate(base);
    const mine = ve.filter(x => x.path.startsWith(`cases[${i}]`) || !x.path.startsWith('cases[')).map(x => ({ ...x, path: x.path.replace(`cases[${i}].`, '') }));
    if (!suite) { caseErrors(mine.length ? mine : ve); return; }
    App.W.setSuite(t.requestId, suite);
    Ui.closeDrawer();
    App.emit('suite', t.requestId);
    toast(`Đã lưu ${kase.id}${suite.schemaVersion === '1.1' && cur?.schemaVersion !== '1.1' ? ' · bộ test case chuyển sang schema 1.1 (có kiểm tra thời gian phản hồi)' : ''}`, 'ok', 3000);
  });

  // ================= NHẬP TEST CASE (AI / EXCEL / JSON) =================
  const imp = { requestId: null, src: 'ai', data: null, suite: null, errors: [], warnings: [], source: '', xls: null };
  function openImport(requestId, src, opener) {
    imp.requestId = requestId;
    imp.data = null;
    imp.suite = null;
    $('#importResult').classList.add('hidden');
    $('#importFoot').classList.add('hidden');
    $('#impSub').textContent = `Cho request: ${App.W.get(requestId).name}. Mọi nguồn đều chuyển về Test Suite JSON và được kiểm tra trước khi lưu.`;
    showSrc(src);
    Ui.openDrawer($('#importDrawer'), opener);
    $(`#src-tab-${src}`).focus();
  }
  App.openImport = openImport;
  function showSrc(src) {
    imp.src = src;
    for (const s of ['ai', 'excel', 'json']) { $('#src-' + s).classList.toggle('hidden', s !== src); $('#src-tab-' + s).setAttribute('aria-selected', s === src); }
  }
  $('#importDrawer .drawer-tabs').addEventListener('click', e => { const t = e.target.closest('[data-src]'); if (t) showSrc(t.dataset.src); });
  $('#btnCopyPrompt').addEventListener('click', e => Ui.copyText(ApiPrompt.TEXT, e.currentTarget, 'Đã copy prompt'));
  $$('#importDrawer [data-example]').forEach(b => b.addEventListener('click', () => Ui.download(new Blob([JSON.stringify(ApiSchema.EXAMPLE, null, 2)], { type: 'application/json' }), 'qa-api-suite-example.json')));
  $$('#importDrawer [data-load]').forEach(b => b.addEventListener('click', () => loadText($('#' + b.dataset.load).value, b.dataset.load === 'aiJson' ? 'AI' : 'JSON')));
  $$('#importDrawer [data-json-file]').forEach(b => b.addEventListener('click', async () => {
    const f = await Ui.pickFile('.json,application/json');
    if (!f) return;
    const target = $('#' + b.dataset.jsonFile);
    target.value = await f.text();
    loadText(target.value, f.name);
  }));
  function loadText(text, source) {
    const t = ApiSchema.stripFence(String(text || ''));
    if (!t.trim()) { toast('Chưa có nội dung JSON', 'warn'); return; }
    let data;
    try { data = JSON.parse(t); } catch (e) {
      imp.data = null;
      renderImportResult({ errors: [{ path: '(JSON)', msg: 'JSON không hợp lệ: ' + e.message }], warnings: [] });
      return;
    }
    setImport(data, source);
  }
  function setImport(data, source) {
    imp.data = data;
    imp.source = source;
    const v = ApiSchema.validate(data);
    imp.suite = v.suite;
    renderImportResult(v);
  }
  function renderImportResult(v) {
    const box = $('#importResult');
    box.classList.remove('hidden');
    const cases = Array.isArray(imp.data?.cases) ? imp.data.cases : [];
    const badIdx = new Set(v.errors.map(x => x.path.match(/^cases\[(\d+)\]/)?.[1]).filter(x => x != null).map(Number));
    const rootErr = v.errors.filter(x => !/^cases\[\d+\]/.test(x.path));
    const review = cases.filter(c => c && typeof c === 'object' && needsReview(c)).length;
    const total = cases.length;
    box.innerHTML = `
      <h3 class="imp-h">Kết quả kiểm tra <span class="muted small">${esc(imp.source || '')}</span></h3>
      <dl class="imp-sum">
        <div><dt>Tổng</dt><dd>${total}</dd></div>
        <div class="ok"><dt>Hợp lệ</dt><dd>${total - badIdx.size}</dd></div>
        <div class="${review ? 'warn' : ''}"><dt>Cần review</dt><dd>${review}</dd></div>
        <div class="${badIdx.size || rootErr.length ? 'err' : ''}"><dt>Lỗi</dt><dd>${badIdx.size}${rootErr.length ? ` + ${rootErr.length} lỗi chung` : ''}</dd></div>
      </dl>
      ${v.errors.length ? `<div class="validation"><p class="v-title err-t"><span class="ms sm" aria-hidden="true">error</span> Chưa lưu được · ${v.errors.length} lỗi</p><ul>${v.errors.slice(0, 80).map(x => {
        const m = x.path.match(/^cases\[(\d+)\]/);
        const c = m ? cases[Number(m[1])] : null;
        return `<li><code>${esc(x.path)}</code>${c?.id ? ` <b>${esc(c.id)}</b>` : ''} ${esc(x.msg)}${m && c && typeof c === 'object' ? ` <button type="button" class="link-btn" data-fix-case="${m[1]}">Sửa case</button>` : ''}</li>`;
      }).join('')}</ul>${v.errors.length > 80 ? `<p class="muted small">…và ${v.errors.length - 80} lỗi khác</p>` : ''}</div>` : ''}
      ${v.warnings.length ? `<div class="validation warn-only"><p class="v-title warn-t"><span class="ms sm" aria-hidden="true">warning</span> Lưu ý</p><ul>${v.warnings.slice(0, 30).map(x => `<li><code>${esc(x.path)}</code> ${esc(x.msg)}</li>`).join('')}</ul></div>` : ''}
      ${review && imp.suite ? `<div class="review-list"><p class="v-title warn-t"><span class="ms sm" aria-hidden="true">rate_review</span> Case cần review (đang tắt, chưa chạy)</p>
        <ul>${imp.suite.cases.map((c, i) => [c, i]).filter(([c]) => needsReview(c)).slice(0, 40).map(([c, i]) => `<li><b>${esc(c.id)}</b> ${esc(c.name)} <span class="muted small">${esc(c.note.replace(/^NEEDS_REVIEW:?\s*/i, ''))}</span> <button type="button" class="link-btn" data-fix-case="${i}">Sửa</button></li>`).join('')}</ul>
        <p class="muted small">Có thể lưu ngay rồi sửa sau trong tab Tests. Case cần review vẫn để tắt cho tới khi bạn bật.</p></div>` : ''}`;
    const cur = App.W.suite(imp.requestId);
    $('#importFoot').classList.toggle('hidden', !imp.suite);
    $('#importFootHint').innerHTML = imp.suite ? (cur ? `Request đang có ${cur.cases.length} case. <label class="inline-check"><input type="radio" name="impMode" value="replace" checked> Thay toàn bộ</label> <label class="inline-check"><input type="radio" name="impMode" value="append"> Thêm vào cuối</label>` : `${imp.suite.cases.length} case sẽ được lưu vào request.`) : '';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#importResult').addEventListener('click', e => {
    const f = e.target.closest('[data-fix-case]');
    if (!f) return;
    openCaseEditor({ staging: true, index: Number(f.dataset.fixCase), requestId: imp.requestId }, f);
  });
  // Huỷ sửa case trong màn nhập → quay lại drawer nhập
  $('#caseDrawer').addEventListener('drawerclose', () => { if (ce.target?.staging) setTimeout(() => Ui.openDrawer($('#importDrawer')), 0); });
  $('#btnImportSave').addEventListener('click', async () => {
    if (!imp.suite) return;
    const n = App.W.get(imp.requestId);
    const cur = App.W.suite(imp.requestId);
    const mode = cur ? $('#importFoot input[name=impMode]:checked')?.value || 'replace' : 'replace';
    let next = JSON.parse(JSON.stringify(imp.suite));
    if (cur && mode === 'append') {
      const ids = new Set(cur.cases.map(c => c.id));
      let renamed = 0;
      for (const c of next.cases) { let id = c.id, k = 2; while (ids.has(id)) id = `${c.id}-${k++}`; if (id !== c.id) { c.id = id; renamed++; } ids.add(id); }
      next = { ...cur, cases: [...cur.cases, ...next.cases] };
      if (renamed) toast(`${renamed} case trùng TC ID đã được thêm hậu tố`, 'info', 4000);
    } else if (cur) {
      const ok = await Ui.confirmBox('Thay toàn bộ test case?', `<p>${cur.cases.length} case hiện tại của <b>${esc(n.name)}</b> sẽ được thay bằng ${next.cases.length} case mới. Có thể hoàn tác ngay sau khi lưu.</p>`, 'Thay thế');
      if (!ok) return;
    }
    next.schemaVersion = ApiSchema.versionFor(next);
    const v = ApiSchema.validate(next);
    if (!v.suite) { renderImportResult(v); return; }
    const before = cur ? JSON.parse(JSON.stringify(cur)) : null;
    App.W.setSuite(imp.requestId, v.suite);
    Ui.closeDrawer();
    App.emit('suite', imp.requestId);
    const review = v.suite.cases.filter(needsReview).length;
    if (review) tv.status = 'review';
    App.setRequestTab?.('tests', { silent: true });
    toast(`Đã lưu ${v.suite.cases.length} test case${review ? ` · ${review} cần review` : ''}`, review ? 'warn' : 'ok', 6000, before ? { label: 'Hoàn tác', fn: () => { App.W.setSuite(imp.requestId, before); App.emit('suite', imp.requestId); } } : null);
    $('#aiJson').value = '';
  });

  // ---------- Upload Excel ----------
  const FIELDS = [
    { key: 'id', label: 'TC ID', names: ['tc id', 'tcid', 'test case id', 'testcase id', 'case id', 'ma tc', 'ma test case', 'id', 'tc'] },
    { key: 'group', label: 'Group', names: ['nhom', 'group', 'loai', 'category', 'module', 'chuc nang'] },
    { key: 'desc', label: 'Tên / Mô tả', names: ['mo ta', 'description', 'desc', 'ten test case', 'title', 'summary', 'muc dich', 'scenario', 'test case', 'name', 'ten'] },
    { key: 'priority', label: 'Priority', names: ['priority', 'uu tien', 'muc do uu tien', 'muc uu tien', 'severity'] },
    { key: 'method', label: 'Method', names: ['method', 'http method', 'phuong thuc'] },
    { key: 'url', label: 'Endpoint / URL', names: ['endpoint', 'url', 'path', 'api', 'duong dan', 'uri'] },
    { key: 'headers', label: 'Headers', names: ['headers', 'header', 'request headers'] },
    { key: 'query', label: 'Query', names: ['query', 'query params', 'params', 'query string', 'tham so'] },
    { key: 'body', label: 'Request Body', names: ['request body', 'body', 'payload', 'request', 'request data', 'du lieu gui', 'input', 'data'] },
    { key: 'expect', label: 'Expected', names: ['mong muon', 'expected', 'expect', 'assert', 'assertion', 'kiem tra', 'expected result', 'ket qua mong muon', 'expected response'] },
    { key: 'save', label: 'Lưu biến', names: ['luu bien', 'save', 'extract', 'set variable', 'bien'] },
  ];
  const norm = s => Ui.norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
  function autoMap(headers) {
    const h = headers.map(norm), map = {}, used = new Set();
    for (const pass of [0, 1]) for (const f of FIELDS) {
      if (map[f.key] != null) continue;
      for (const name of f.names) {
        const i = h.findIndex((x, j) => !used.has(j) && x && (pass === 0 ? x === name : name.length > 3 && (x.startsWith(name) || x.includes(' ' + name))));
        if (i >= 0) { map[f.key] = i; used.add(i); break; }
      }
    }
    return map;
  }
  function detectHeader(rows) {
    let best = 0, bestScore = 0;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const m = autoMap(rows[r] || []);
      const score = Object.keys(m).length + (m.id != null ? 2 : 0);
      if (score > bestScore) { best = r; bestScore = score; }
    }
    return best;
  }
  const colLetter = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  async function handleXlsFile(f) {
    if (!f) return;
    try {
      if (!/\.(xlsx|csv)$/i.test(f.name)) throw new Error('Chỉ nhận .xlsx hoặc .csv (file .xls hãy lưu lại thành .xlsx)');
      const sheets = /\.csv$/i.test(f.name) ? [{ name: 'CSV', rows: Xlsx.parseCsv(await f.text()) }] : (await Xlsx.read(await f.arrayBuffer())).sheets;
      if (!sheets.some(s => s.rows.length)) throw new Error('File không có dữ liệu');
      const idx = Math.max(0, sheets.findIndex(s => autoMap(s.rows[detectHeader(s.rows)] || []).id != null));
      imp.xls = { name: f.name.replace(/\.[^.]+$/, ''), sheets };
      $('#sheet').innerHTML = sheets.map((s, i) => `<option value="${i}">${esc(s.name)} (${s.rows.length} dòng)</option>`).join('');
      $('#xlsName').innerHTML = `<span class="ms sm" aria-hidden="true">description</span> ${esc(f.name)}`;
      $('#xlsMapping').classList.remove('hidden');
      selectSheet(idx);
    } catch (x) { toast('Không đọc được file: ' + x.message, 'err'); }
  }
  $('#xlsFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; handleXlsFile(f); });
  ['dragenter', 'dragover'].forEach(t => $('#xlsDrop').addEventListener(t, e => { e.preventDefault(); $('#xlsDrop').classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => $('#xlsDrop').addEventListener(t, e => { e.preventDefault(); $('#xlsDrop').classList.remove('over'); }));
  $('#xlsDrop').addEventListener('drop', e => handleXlsFile(e.dataTransfer.files[0]));
  function selectSheet(i) {
    const x = imp.xls;
    x.sheetIdx = i;
    $('#sheet').value = i;
    x.headerRow = detectHeader(x.sheets[i].rows);
    $('#headerRow').value = x.headerRow + 1;
    applyHeader();
  }
  function applyHeader() {
    const x = imp.xls;
    x.headers = (x.sheets[x.sheetIdx].rows[x.headerRow] || []).map(s => String(s).trim());
    x.map = autoMap(x.headers);
    const opts = ['<option value="">(không dùng)</option>', ...x.headers.map((h, i) => (h ? `<option value="${i}">${esc(colLetter(i))} · ${esc(h)}</option>` : ''))].join('');
    $('#mapGrid').innerHTML = FIELDS.map(f => `<div><label for="map-${f.key}">${esc(f.label)}</label><select id="map-${f.key}" data-key="${f.key}">${opts}</select></div>`).join('');
    FIELDS.forEach(f => { $('#map-' + f.key).value = x.map[f.key] ?? ''; });
    $('#mapDetails').open = x.map.id == null || x.map.expect == null;
    xlsRows();
  }
  $('#sheet').addEventListener('change', e => selectSheet(Number(e.target.value)));
  $('#headerRow').addEventListener('change', e => {
    const x = imp.xls;
    x.headerRow = Math.min(Math.max(1, Number(e.target.value) || 1), Math.max(1, x.sheets[x.sheetIdx].rows.length)) - 1;
    e.target.value = x.headerRow + 1;
    applyHeader();
  });
  $('#mapGrid').addEventListener('change', e => {
    const s = e.target.closest('select');
    if (!s) return;
    if (s.value === '') delete imp.xls.map[s.dataset.key]; else imp.xls.map[s.dataset.key] = Number(s.value);
    xlsRows();
  });
  // Dòng dữ liệu → case; dòng trống, dòng chỉ có một ô chữ (tên phần) hoặc không có TC ID thì bỏ qua
  function xlsRows() {
    const x = imp.xls, m = x.map;
    const cell = (row, k) => (m[k] == null ? '' : String(row[m[k]] ?? '').trim());
    const out = [];
    for (const row of x.sheets[x.sheetIdx].rows.slice(x.headerRow + 1)) {
      const filled = (row || []).filter(v => String(v ?? '').trim());
      if (filled.length <= 1 || (m.id != null && !cell(row, 'id'))) continue;
      out.push({ id: cell(row, 'id'), group: cell(row, 'group'), desc: cell(row, 'desc'), priority: cell(row, 'priority'),
        cells: Object.fromEntries(['method', 'url', 'headers', 'query', 'body', 'expect', 'save'].map(k => [k, cell(row, k)])) });
    }
    x.rows = out;
    $('#mapCount').textContent = `· ${Object.keys(m).length}/${FIELDS.length} cột đã nhận`;
    const warnCols = [m.id == null && 'TC ID', m.expect == null && 'Expected'].filter(Boolean);
    $('#xlsSummary').innerHTML = `<b>${out.length}</b> dòng test case${warnCols.length ? ` · <span class="warn-t">chưa nhận cột ${warnCols.join(', ')}</span>` : ''}`;
    $('#xlsPreview').innerHTML = out.length ? `<div class="table-wrap mini-table"><table class="data"><thead><tr><th>TC ID</th><th>Tên</th><th>Expected</th></tr></thead><tbody>${out.slice(0, 5).map(r => `<tr><td class="id">${esc(r.id || '(tự đánh số)')}</td><td><span class="clamp-1">${esc(r.desc)}</span></td><td><span class="clamp-1 mono small">${esc(r.cells.expect || '—')}</span></td></tr>`).join('')}</tbody></table></div>${out.length > 5 ? `<p class="muted small">…và ${out.length - 5} dòng khác</p>` : ''}` : '';
    $('#btnConvert').disabled = !out.length;
  }
  $('#btnConvert').addEventListener('click', () => {
    const suite = ApiLegacy.toSuite(imp.xls.rows, { name: imp.xls.name });
    $('#jsonText').value = JSON.stringify(suite, null, 2);
    setImport(suite, `Excel: ${imp.xls.name}`);
  });
})();
