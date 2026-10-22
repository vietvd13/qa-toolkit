// Đọc/ghi file Excel (.xlsx) và CSV, không cần thư viện ngoài (extension MV3 không cho nạp script từ CDN).
// .xlsx là file zip chứa XML → giải nén bằng DecompressionStream('deflate-raw') có sẵn trong Chrome.
//   Xlsx.read(arrayBuffer)   → { sheets: [{ name, rows: string[][] }] }
//   Xlsx.parseCsv(text)      → string[][]
//   Xlsx.write(sheets)       → Promise<Blob>; sheets: [{ name, rows: (string|number|{v, s})[][], cols?: number[], freeze?: bool }]
//                               s = kiểu ô: 'head' | 'wrap' | 'mono' | 'pass' | 'fail' | 'warn' | 'info' | 'skip' | 'section' | 'datetime' (v = ms)
//   Xlsx.zip([[tên, chuỗi|Uint8Array]], type) → Promise<Blob>
(() => {
  const td = new TextDecoder();
  const te = new TextEncoder();

  // ---------- ZIP ----------
  const inflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const deflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('File không phải .xlsx hợp lệ (không đọc được cấu trúc zip). File .xls đời cũ hãy mở bằng Excel rồi lưu lại dạng .xlsx.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      files.set(name, { method, data: u8.subarray(start, start + compSize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return {
      has: name => files.has(name),
      async text(name) {
        const f = files.get(name);
        if (!f) return null;
        return td.decode(f.method === 0 ? f.data : await inflate(f.data));
      },
    };
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = u8 => {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  async function zip(entries, type = 'application/zip') {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, content] of entries) {
      const raw = typeof content === 'string' ? te.encode(content) : content;
      const comp = await deflate(raw);
      const nameB = te.encode(name);
      const crc = crc32(raw);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, 8, true);
      head.setUint16(10, time, true); head.setUint16(12, date, true); head.setUint32(14, crc, true);
      head.setUint32(18, comp.length, true); head.setUint32(22, raw.length, true); head.setUint16(26, nameB.length, true);
      parts.push(new Uint8Array(head.buffer), nameB, comp);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 8, true);
      cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
      cd.setUint32(20, comp.length, true); cd.setUint32(24, raw.length, true); cd.setUint16(28, nameB.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameB);
      offset += 30 + nameB.length + comp.length;
    }
    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
  }

  // ---------- Đọc .xlsx ----------
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  // Chữ trong ô (bỏ phần phiên âm <rPh> của Excel tiếng Nhật)
  const textOf = node => all(node, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('');

  async function read(buf) {
    const z = await unzip(buf);
    const wb = await z.text('xl/workbook.xml');
    if (!wb) throw new Error('File không có dữ liệu bảng tính (thiếu xl/workbook.xml).');
    const rels = xml((await z.text('xl/_rels/workbook.xml.rels')) || '<r/>');
    const target = {};
    all(rels, 'Relationship').forEach(r => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const ssText = await z.text('xl/sharedStrings.xml');
    const shared = ssText ? all(xml(ssText), 'si').map(textOf) : [];

    const sheets = [];
    for (const s of all(xml(wb), 'sheet')) {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
      let t = target[rid] || '';
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      const sx = await z.text(t);
      if (sx == null) continue;
      const rows = [];
      for (const row of all(xml(sx), 'row')) {
        const r = Number(row.getAttribute('r')) - 1 || rows.length;
        const out = [];
        let next = 0;
        for (const c of all(row, 'c')) {
          const ref = c.getAttribute('r');
          const i = ref ? colIndex(ref) : next;
          next = i + 1;
          const type = c.getAttribute('t');
          const v = all(c, 'v')[0]?.textContent ?? '';
          let val;
          if (type === 's') val = shared[Number(v)] ?? '';
          else if (type === 'inlineStr') val = textOf(c);
          else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
          else val = v;
          out[i] = val;
        }
        rows[r] = Array.from(out, x => x ?? '');
      }
      sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, x => x || []) });
    }
    return { sheets };
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ---------- Ghi .xlsx ----------
  const escXml = s => String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '') // eslint-disable-line no-control-regex
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const MAX_CELL = 32000; // Excel giới hạn 32.767 ký tự mỗi ô
  const STYLE = { head: 1, wrap: 2, mono: 3, pass: 4, fail: 5, warn: 6, info: 7, section: 8, datetime: 9, skip: 10 };
  const FORMULA_START = /^[=+\-@\t\r]/;
  // Ngày giờ theo giờ máy → số ngày kiểu Excel (1900 date system)
  const excelDate = ms => (ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000 + 25569;

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>
<fonts count="8">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><sz val="10"/><name val="Consolas"/></font>
<font><b/><sz val="11"/><color rgb="FF1E6B47"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFA12A40"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF7A4F08"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF2F4F96"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF514A56"/><name val="Calibri"/></font>
</fonts>
<fills count="9">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEAF2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3F5EA"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFCE7EA"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF0D5"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEFF"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCE8D2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF0ECF1"/></patternFill></fill>
</fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFD0C8D2"/></left><right style="thin"><color rgb="FFD0C8D2"/></right><top style="thin"><color rgb="FFD0C8D2"/></top><bottom style="thin"><color rgb="FFD0C8D2"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="__COUNT__">
<xf/>
<xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf fontId="2" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf fontId="4" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf fontId="5" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf fontId="6" fillId="6" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf fontId="1" fillId="7" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf fontId="7" fillId="8" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
__QUOTED__</cellXfs>
</styleSheet>`;

  // Bản sao của từng kiểu ô với quotePrefix="1": Excel hiển thị đúng chữ nhưng không bao giờ hiểu là công thức
  const BASE_XFS = STYLES_XML.match(/<cellXfs count="__COUNT__">\n([\s\S]*?)__QUOTED__/)[1].trim().split('\n');
  const QUOTE_OFFSET = BASE_XFS.length;
  const STYLES_FINAL = STYLES_XML
    .replace('__COUNT__', String(BASE_XFS.length * 2))
    .replace('__QUOTED__', BASE_XFS.map(x => (x === '<xf/>' ? '<xf quotePrefix="1"/>' : x.replace('<xf ', '<xf quotePrefix="1" '))).join('\n') + '\n');

  function sheetXml(sheet) {
    const rows = sheet.rows.map((row, r) => {
      const cells = row.map((cell, c) => {
        if (cell == null || cell === '') return '';
        const o = typeof cell === 'object' ? cell : { v: cell };
        const ref = colName(c) + (r + 1);
        const base = STYLE[o.s] || 0;
        if (o.s === 'datetime' && typeof o.v === 'number') return `<c r="${ref}" s="${base}"><v>${excelDate(o.v)}</v></c>`;
        if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${base ? ` s="${base}"` : ''}><v>${o.v}</v></c>`;
        let v = String(o.v ?? '');
        // Lưới an toàn: nơi gọi nên tự cắt và ghi rõ chỗ xem bản đầy đủ
        if (v.length > MAX_CELL) v = `TRUNCATED (${v.length} ký tự, đã cắt còn ${MAX_CELL})\n` + v.slice(0, MAX_CELL);
        const style = FORMULA_START.test(v) ? base + QUOTE_OFFSET : base;
        return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    const width = Math.max(1, ...sheet.rows.map(r => r.length));
    const cols = sheet.cols?.length ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const view = sheet.freeze
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const filter = sheet.freeze && sheet.rows.length > 1 ? `<autoFilter ref="A1:${colName(width - 1)}${sheet.rows.length}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`;
  }

  function write(sheets) {
    const safe = new Set();
    const names = sheets.map((s, i) => {
      let n = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
      while (safe.has(n)) n = n.slice(0, 28) + ' ' + i;
      safe.add(n);
      return n;
    });
    const entries = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', STYLES_FINAL],
      ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
    ];
    return zip(entries, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  window.Xlsx = { read, write, parseCsv, zip, MAX_CELL };
})();
