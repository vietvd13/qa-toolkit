// Dán vào Console (F12) rồi Enter — không cần server.
// QUAN TRỌNG: mở Console trên tab thuộc ĐÚNG DOMAIN của trang chứa sub3/affiliate_id
// (vd link cuối là https://abc.com/... thì mở 1 tab https://abc.com rồi dán script vào đó).
// Trình duyệt chỉ cho đọc URL của trang cùng domain với tab này.
(async () => {
  const LINK = '';          // để trống → hiện hộp nhập
  const SO_LUOT = 1000;
  const SONG_SONG = 6;      // số cửa sổ popup chạy cùng lúc
  const CHO_TOI_DA = 10000; // ms tối đa cho 1 lượt
  const ON_DINH = 500;      // đã tới trang cuối nhưng thiếu param → chờ thêm X ms rồi chốt
  const POLL = 20;          // ms giữa 2 lần đọc URL
  const THAM_SO = ['sub3', 'sub4', 'Sub_id', 'affiliate_id', 'utm_content'];

  const link = (LINK || prompt('Nhập link:') || '').trim();
  const soLuot = LINK ? SO_LUOT : Number(prompt('Số lượt:', SO_LUOT)) || SO_LUOT;
  if (!/^https?:\/\//i.test(link)) return console.warn('Link không hợp lệ');

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const readDoc = w => { try { return w.document; } catch { return null; } }; // khác domain → null

  // Lấy param trong query, hash và cả link lồng đã mã hoá
  const getParam = (url, p, depth = 0) => {
    if (depth > 4) return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    const lists = [u.searchParams];
    if (u.hash.includes('=')) lists.push(new URLSearchParams(u.hash.slice(1).split('?').pop()));
    const lp = p.toLowerCase(); // không phân biệt hoa thường: Sub_id = sub_id
    for (const sp of lists) for (const [k, v] of sp) if (k.toLowerCase() === lp) return v;
    for (const sp of lists) for (const [, v] of sp) {
      if (/^https?(:|%3A)/i.test(v)) {
        let d = v;
        for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(d); i++) try { d = decodeURIComponent(d); } catch { break; }
        const hit = getParam(d, p, depth + 1);
        if (hit != null) return hit;
      }
    }
    return null;
  };

  const wins = [];
  for (let k = 0; k < Math.min(SONG_SONG, soLuot); k++) {
    const w = window.open('about:blank', `kt_redirect_${k}`, `width=320,height=240,left=${k * 40},top=${k * 40}`);
    if (!w) {
      wins.forEach(x => x.close());
      return console.error('Trình duyệt đang chặn popup. Hãy cho phép popup cho trang này rồi chạy lại.');
    }
    wins.push(w);
  }
  const closeAll = () => wins.forEach(w => { try { w.close(); } catch {} });
  window.addEventListener('beforeunload', closeAll); // tải lại / đóng tab cũng đóng luôn popup

  const rows = [];
  let next = 1;
  const t0 = Date.now();
  console.log(`Đang chạy ${soLuot} lượt... (đóng các cửa sổ popup để dừng)`);

  const runOne = async w => {
    // Không cần về about:blank: chỉ đọc khi document đã khác document của lượt trước
    const oldDoc = readDoc(w);
    w.location.href = link;
    const out = Object.fromEntries(THAM_SO.map(p => [p, null]));
    const start = Date.now();
    let lastHref = null, lastChange = start;

    while (Date.now() - start < CHO_TOI_DA && !w.closed) {
      const doc = readDoc(w);
      if (doc && doc !== oldDoc) {
        let href = null;
        try { href = w.location.href; } catch {}
        if (href && href !== 'about:blank') {
          for (const p of THAM_SO) if (out[p] == null) out[p] = getParam(href, p);
          if (THAM_SO.every(p => out[p] != null)) break;          // đủ param → chốt ngay
          if (href !== lastHref) { lastHref = href; lastChange = Date.now(); }
          else if (doc.readyState !== 'loading' && Date.now() - lastChange > ON_DINH) break;
        }
      }
      await sleep(POLL);
    }
    try { w.stop(); } catch {} // ngừng tải ảnh/script thừa của trang đích
    return Object.fromEntries(THAM_SO.map(p => [p, out[p] ?? '-']));
  };

  try {
    await Promise.all(wins.map(async w => {
      while (next <= soLuot && !w.closed) {
        const stt = next++;
        rows.push({ STT: stt, ...(await runOne(w)) });
        if (rows.length % 50 === 0) console.log(`${rows.length}/${soLuot} lượt · ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    }));
  } finally {
    closeAll(); // chạy xong (hoặc lỗi) → đóng hết popup
    window.removeEventListener('beforeunload', closeAll);
  }

  console.table(rows.sort((a, b) => a.STT - b.STT));

  // ------------------------------ THỐNG KÊ ------------------------------
  const N = rows.length;
  const pct = n => (N ? (100 * n / N).toFixed(1) : '0.0') + '%';
  const TOP = 20; // tham số có quá nhiều giá trị (vd click_id) → chỉ in TOP giá trị nhiều nhất
  const H = 'font-weight:bold;font-size:13px';
  const demTheo = key => {
    const m = new Map();
    rows.forEach(r => { const k = key(r); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  // 1) Tổng quan: mỗi tham số có ở bao nhiêu lượt, bao nhiêu giá trị khác nhau
  console.log(`%c\nTỔNG QUAN — ${N} lượt · ${Math.round((Date.now() - t0) / 1000)} giây`, H);
  console.table(THAM_SO.map(p => {
    const co = rows.filter(r => r[p] !== '-').length;
    return {
      'Tham số': p, 'Có': co, 'Tỉ lệ có': pct(co), 'Không có': N - co,
      'Số giá trị khác nhau': new Set(rows.filter(r => r[p] !== '-').map(r => r[p])).size,
    };
  }));

  // 2) Tỉ lệ xuất hiện của từng giá trị, cho mỗi tham số
  for (const p of THAM_SO) {
    const ds = demTheo(r => r[p]);
    const hien = ds.slice(0, TOP);
    const conLai = ds.slice(TOP);
    const bang = hien.map(([v, n]) => ({ [p]: v === '-' ? '(không có)' : v, 'Số lượt': n, 'Tỉ lệ': pct(n) }));
    if (conLai.length) {
      const n = conLai.reduce((s, x) => s + x[1], 0);
      bang.push({ [p]: `(… ${conLai.length} giá trị khác)`, 'Số lượt': n, 'Tỉ lệ': pct(n) });
    }
    console.log(`%cTỈ LỆ ${p.toUpperCase()}`, H);
    console.table(bang);
  }

  // 3) Theo nhóm: affiliate_id nào đi kèm sub3 / click_id / utm_content (có hay không)
  const nhom = demTheo(r => JSON.stringify([r.affiliate_id, ...THAM_SO.filter(p => p !== 'affiliate_id').map(p => (r[p] === '-' ? '✗' : '✓'))]));
  console.log('%cTHEO NHÓM (affiliate_id + có/không các tham số còn lại)', H);
  console.table(nhom.map(([k, n]) => {
    const [aff, ...flags] = JSON.parse(k);
    const o = { affiliate_id: aff === '-' ? '(không có)' : aff };
    THAM_SO.filter(p => p !== 'affiliate_id').forEach((p, i) => (o[p] = flags[i]));
    return { ...o, 'Số lượt': n, 'Tỉ lệ': pct(n) };
  }));
})();
