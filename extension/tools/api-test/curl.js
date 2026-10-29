// Đọc lệnh cURL thành dữ liệu request. KHÔNG thực thi lệnh: chỉ tách chữ theo quy tắc trích dẫn của bash.
//   ApiCurl.parse(text) → { request: { method, url, query: [{key, value, enabled}], headers: [{key, value, enabled}],
//                                      body: { mode: 'none'|'json'|'raw'|'form-urlencoded', text } },
//                           format: 'bash'|'cmd'|'fetch', fromBrowser: bool, errors: [string], warnings: [string] }
//   Nhận: cURL kiểu bash (Postman, Chrome/Edge/Firefox "Copy as cURL (bash)"), cURL kiểu cmd của Chrome trên Windows
//   ("Copy as cURL (cmd)", có dấu ^), và "Copy as fetch" của trình duyệt.
//   ApiCurl.muteBrowserHeaders(headers) → tắt (enabled=false) các header do trình duyệt tự thêm, trả về danh sách đã tắt
// Hỗ trợ: -X/--request, URL, --url, -H/--header, -d/--data/--data-ascii, --data-raw, --data-binary, --json, -G/--get,
// --data-urlencode, -u/--user, -b/--cookie, -A/--user-agent, -e/--referer. Cú pháp khác báo lỗi rõ ràng.
(() => {
  // Tách từ như bash: '…' giữ nguyên, "…" cho phép \" \\ \$ \`, $'…' có \n \t \' \\ \xHH \uHHHH, \ ngoài ngoặc thoát 1 ký tự.
  // Xuống dòng không có \ = hết lệnh, trừ khi dòng sau rõ ràng vẫn là một phần của lệnh (bắt đầu bằng -, ngoặc hoặc http);
  // phần còn lại (vd tên host dán thừa, lệnh thứ hai) trả về ở out.rest để báo "đã bỏ qua".
  function tokenize(src) {
    const out = [];
    let cur = null;
    let i = 0;
    const push = () => { if (cur != null) out.push(cur); cur = null; };
    while (i < src.length) {
      const ch = src[i];
      // \ + xuống dòng = nối dòng: xét trước khi mở từ mới, nếu không mỗi dòng sinh một từ rỗng ("Không hiểu phần """)
      if (ch === '\\' && src[i + 1] === '\n') { i += 2; continue; }
      if (ch === '\n' && out.length + (cur != null) > 0) {
        const next = src.slice(i).replace(/^\s+/, '');
        if (next && !/^(-|'|"|\$'|https?:\/\/)/i.test(next)) { push(); out.rest = next; return out; }
      }
      if (/\s/.test(ch)) { push(); i++; continue; }
      cur = cur ?? '';
      if (ch === "'") {
        const j = src.indexOf("'", i + 1);
        if (j < 0) throw new Error('Thiếu dấu \' đóng');
        cur += src.slice(i + 1, j);
        i = j + 1;
      } else if (ch === '$' && src[i + 1] === "'") {
        i += 2;
        while (i < src.length && src[i] !== "'") {
          if (src[i] === '\\') {
            const n = src[i + 1];
            const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0', e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v' };
            if (n === 'x') { cur += String.fromCharCode(parseInt(src.substr(i + 2, 2), 16)); i += 4; continue; }
            if (n === 'u') { cur += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)); i += 6; continue; }
            cur += map[n] ?? n;
            i += 2;
          } else cur += src[i++];
        }
        if (i >= src.length) throw new Error("Thiếu dấu ' đóng của $'…'");
        i++;
      } else if (ch === '"') {
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1])) { if (src[i + 1] !== '\n') cur += src[i + 1]; i += 2; }
          else cur += src[i++];
        }
        if (i >= src.length) throw new Error('Thiếu dấu " đóng');
        i++;
      } else if (ch === '\\') {
        cur += src[i + 1] ?? '';
        i += 2;
      } else { cur += ch; i++; }
    }
    push();
    return out;
  }

  // "Copy as cURL (cmd)" của Chrome: chuỗi bọc trong ^"…^", ký tự đặc biệt có ^ đứng trước, " bên trong là \^",
  // \ bên trong là ^\^\, xuống dòng trong dữ liệu là ^ + 2 lần xuống dòng, ^ cuối dòng là nối dòng.
  function tokenizeCmd(src) {
    const out = [];
    let cur = null;
    let i = 0;
    const push = () => { if (cur != null) out.push(cur); cur = null; };
    const nl = j => (src[j] === '\n' ? 1 : src[j] === '\r' && src[j + 1] === '\n' ? 2 : 0);
    while (i < src.length) {
      const ch = src[i];
      if (ch === '^' && nl(i + 1)) { i += 1 + nl(i + 1); continue; }
      if (/\s/.test(ch)) { push(); i++; continue; }
      cur = cur ?? '';
      if (ch === '^' && src[i + 1] === '"') {
        i += 2;
        let raw = '';
        for (;;) {
          if (i >= src.length) throw new Error('Thiếu ^" đóng');
          const c = src[i];
          if (c !== '^') { raw += c; i++; continue; }
          const n = src[i + 1];
          if (n === '"') {
            let bs = 0;
            for (let j = raw.length - 1; j >= 0 && raw[j] === '\\'; j--) bs++;
            i += 2;
            if (bs % 2 === 0) break; // ^" đóng chuỗi
            raw += '"';
            continue;
          }
          const k = nl(i + 1);
          if (k) { raw += '\n'; i += 1 + k; i += nl(i); continue; }
          raw += n ?? '';
          i += 2;
        }
        cur += raw.replace(/\\([\\"])/g, '$1');
      } else if (ch === '"') {
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\' && (src[i + 1] === '"' || src[i + 1] === '\\')) { cur += src[i + 1]; i += 2; } else cur += src[i++];
        }
        i++;
      } else if (ch === '^') { cur += src[i + 1] ?? ''; i += 2; }
      else { cur += ch; i++; }
    }
    push();
    return out;
  }

  // "Copy as fetch" (trình duyệt hoặc Node.js): fetch("url", { "headers": {…}, "body": "…", "method": "POST", … });
  function parseFetch(src) {
    const m = src.match(/fetch\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:,\s*(\{[\s\S]*\}))?\s*\)\s*;?\s*$/);
    if (!m) throw new Error('Không đọc được lệnh fetch. Hãy dùng “Copy as fetch” hoặc “Copy as cURL” nguyên văn');
    const url = m[1].startsWith("'") ? m[1].slice(1, -1).replace(/\\'/g, "'") : JSON.parse(m[1]);
    let opts = {};
    if (m[2]) { try { opts = JSON.parse(m[2]); } catch (e) { throw new Error('Phần tuỳ chọn của fetch không phải JSON: ' + e.message, { cause: e }); } }
    return { url, method: opts.method ? String(opts.method).toUpperCase() : null, headers: Object.entries(opts.headers || {}).map(([key, value]) => ({ key, value: String(value), enabled: true })),
      body: opts.body == null ? '' : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body), credentials: opts.credentials };
  }

  // Header trình duyệt tự gắn, không thuộc nghiệp vụ API → tắt sẵn (tester bật lại được)
  const BROWSER_HEADER = /^(sec-ch-ua(-.*)?|sec-fetch-.*|sec-gpc|user-agent|accept-language|accept-encoding|priority|referer|origin|dnt|upgrade-insecure-requests|cache-control|pragma|connection|host|content-length|if-none-match|if-modified-since|x-client-data|purpose|sec-purpose)$/i;
  function muteBrowserHeaders(headers) {
    const muted = [];
    for (const h of headers) if (h.enabled !== false && BROWSER_HEADER.test(h.key)) { h.enabled = false; muted.push(h.key); }
    return muted;
  }
  const looksLikeBrowser = headers => headers.some(h => /^sec-(fetch|ch-ua)/i.test(h.key));

  // Cờ cần giá trị: kể cả cờ tool bỏ qua cũng phải "nuốt" giá trị đi kèm, nếu không giá trị bị hiểu nhầm là URL
  const LONG_WITH_VALUE = new Set(['--request', '--url', '--header', '--data', '--data-ascii', '--data-raw', '--data-binary', '--data-urlencode', '--json',
    '--user', '--cookie', '--user-agent', '--referer', '--form', '--form-string', '--output', '--upload-file', '--max-time', '--connect-timeout', '--proxy', '--cert', '--key', '--cacert', '--resolve', '--retry', '--write-out',
    '--oauth2-bearer', '--url-query', '--cookie-jar', '--dump-header', '--config', '--range', '--proxy-user', '--proxy-header', '--max-redirs', '--retry-delay', '--retry-max-time',
    '--speed-limit', '--speed-time', '--limit-rate', '--max-filesize', '--interface', '--local-port', '--noproxy', '--connect-to', '--capath', '--cert-type', '--key-type', '--ciphers',
    '--trace', '--trace-ascii', '--stderr', '--unix-socket', '--abstract-unix-socket', '--expect100-timeout', '--keepalive-time', '--happy-eyeballs-timeout-ms', '--aws-sigv4',
    '--request-target', '--variable', '--time-cond', '--pass', '--pinnedpubkey', '--preproxy', '--socks5', '--socks5-hostname', '--dns-servers', '--doh-url', '--etag-save', '--etag-compare',
    '--output-dir', '--quote', '--continue-at', '--ftp-port', '--telnet-option', '--tlsuser', '--tlspassword', '--login-options', '--sasl-authzid', '--service-name', '--mail-from', '--mail-rcpt', '--hsts', '--alt-svc']);
  const SHORT_WITH_VALUE = new Set(['X', 'H', 'd', 'u', 'b', 'A', 'e', 'F', 'o', 'T', 'm', 'x', 'E', 'w', 'c', 'D', 'K', 'r', 'U', 'y', 'Y', 'z', 'C', 'P', 'Q', 't']);
  const SHORT_ALIAS = { X: '--request', H: '--header', d: '--data', u: '--user', b: '--cookie', A: '--user-agent', e: '--referer', F: '--form', o: '--output', T: '--upload-file', m: '--max-time', x: '--proxy', E: '--cert', w: '--write-out', G: '--get', k: '--insecure', L: '--location', s: '--silent', S: '--show-error', v: '--verbose', i: '--include', I: '--head', f: '--fail',
    c: '--cookie-jar', D: '--dump-header', K: '--config', r: '--range', U: '--proxy-user', y: '--speed-time', Y: '--speed-limit', z: '--time-cond', C: '--continue-at', P: '--ftp-port', Q: '--quote', t: '--telnet-option',
    g: '--globoff', N: '--no-buffer', O: '--remote-name', J: '--remote-header-name', R: '--remote-time', n: '--netrc', j: '--junk-session-cookies', q: '--disable', Z: '--parallel', B: '--use-ascii', l: '--list-only', M: '--manual', V: '--version', h: '--help' };
  // Cờ không ảnh hưởng nội dung request → bỏ qua (kèm cảnh báo nếu đáng chú ý). Cờ lạ khác: bỏ qua kèm cảnh báo, không chặn import.
  const IGNORED = {
    '--compressed': '', '--silent': '', '--show-error': '', '--verbose': '', '--include': '', '--location': 'Tool luôn tự đi theo redirect (tối đa 5 bước).',
    '--insecure': 'Đã bỏ qua -k/--insecure: tool không tắt kiểm tra chứng chỉ TLS.', '--http1.1': '', '--http1.0': '', '--http2': '', '--http2-prior-knowledge': '', '--http3': '', '--http3-only': '', '--fail': '', '--fail-with-body': '',
    '--max-time': 'Thời gian chờ đặt ở phần Cài đặt chạy, không lấy từ cURL.', '--connect-timeout': '', '--retry': 'Tool không tự retry.', '--retry-delay': '', '--retry-max-time': '', '--retry-all-errors': '', '--retry-connrefused': '',
    '--write-out': '', '--output': '', '--output-dir': '', '--remote-name': '', '--remote-name-all': '', '--remote-header-name': '', '--remote-time': '', '--create-dirs': '', '--dump-header': '', '--cookie-jar': '', '--stderr': '',
    '--globoff': '', '--no-buffer': '', '--path-as-is': '', '--location-trusted': '', '--max-redirs': '', '--tcp-nodelay': '', '--tcp-fastopen': '', '--no-keepalive': '', '--keepalive-time': '', '--no-sessionid': '', '--no-alpn': '', '--no-npn': '',
    '--ipv4': '', '--ipv6': '', '--tlsv1': '', '--tlsv1.0': '', '--tlsv1.1': '', '--tlsv1.2': '', '--tlsv1.3': '', '--tls-max': '', '--sslv2': '', '--sslv3': '', '--ssl': '', '--ssl-reqd': '', '--ssl-no-revoke': '', '--ssl-revoke-best-effort': '', '--ssl-allow-beast': '',
    '--progress-bar': '', '--no-progress-meter': '', '--show-headers': '', '--styled-output': '', '--no-styled-output': '', '--raw': '', '--tr-encoding': '', '--trace': '', '--trace-ascii': '', '--trace-time': '', '--expect100-timeout': '', '--happy-eyeballs-timeout-ms': '',
    '--limit-rate': '', '--speed-limit': '', '--speed-time': '', '--max-filesize': '', '--disable': '', '--parallel': '', '--parallel-max': '', '--netrc': '', '--netrc-optional': '', '--junk-session-cookies': '', '--disable-eprt': '', '--disable-epsv': '',
    '--anyauth': '', '--basic': '', '--digest': 'Tool chỉ gửi Basic auth, đã bỏ qua --digest.', '--ntlm': 'Tool không hỗ trợ NTLM, đã bỏ qua --ntlm.', '--negotiate': '', '--http0.9': '', '--interface': '', '--local-port': '', '--dns-servers': '', '--doh-url': '',
  };
  // Tool không làm được → bỏ qua kèm cảnh báo rõ ràng; request vẫn được tạo từ phần còn lại của lệnh
  const UNSUPPORTED = {
    '--upload-file': 'tải file lên (-T/--upload-file) chưa hỗ trợ: đã bỏ qua',
    '--proxy': 'proxy (-x/--proxy) chưa hỗ trợ: request gửi thẳng, không qua proxy', '--proxy-user': '', '--proxy-header': '', '--preproxy': '', '--socks5': 'proxy SOCKS chưa hỗ trợ: đã bỏ qua', '--socks5-hostname': 'proxy SOCKS chưa hỗ trợ: đã bỏ qua', '--noproxy': '',
    '--cert': 'chứng chỉ client (--cert) chưa hỗ trợ: đã bỏ qua', '--key': '', '--cert-type': '', '--key-type': '', '--pass': '', '--cacert': '--cacert chưa hỗ trợ: đã bỏ qua', '--capath': '', '--ciphers': '', '--pinnedpubkey': '',
    '--resolve': '--resolve chưa hỗ trợ: đã bỏ qua', '--connect-to': '--connect-to chưa hỗ trợ: đã bỏ qua', '--unix-socket': 'Unix socket chưa hỗ trợ: đã bỏ qua', '--abstract-unix-socket': 'Unix socket chưa hỗ trợ: đã bỏ qua',
    '--range': 'Đã bỏ qua -r/--range (thêm header Range nếu cần)', '--config': 'Đọc cấu hình từ file (-K/--config) chưa hỗ trợ: đã bỏ qua', '--aws-sigv4': 'Ký AWS SigV4 chưa hỗ trợ: đã bỏ qua', '--variable': '--variable chưa hỗ trợ: đã bỏ qua',
    '--continue-at': '', '--time-cond': '', '--request-target': '--request-target chưa hỗ trợ: đã bỏ qua',
  };

  const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
  const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };

  // Tách URL thành phần chính + query (không dùng new URL để giữ nguyên {{BIEN}})
  function splitUrl(u) {
    const noHash = u.split('#')[0];
    const q = noHash.indexOf('?');
    if (q < 0) return { url: noHash, query: [] };
    const query = noHash.slice(q + 1).split('&').filter(Boolean).map(p => {
      const i = p.indexOf('=');
      return { key: dec(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : dec(p.slice(i + 1)), enabled: true };
    });
    return { url: noHash.slice(0, q), query };
  }

  // Làm sạch chữ dán vào trước khi đọc: ký tự vô hình, khối ``` markdown, dấu nhắc ($ / > / PS C:\>), dấu cách thừa sau \ cuối dòng,
  // ngoặc cong ‘ ’ “ ” (Slack / Word / Notion tự đổi) khi cả lệnh không còn dấu ngoặc thẳng nào
  function clean(text) {
    let s = String(text || '').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\r\n?/g, '\n');
    s = s.split('\n').filter(l => !/^\s*```/.test(l)).join('\n').trim();
    s = s.replace(/^(?:\$|>|#|PS [^>\n]*>)\s+(?=\S)/, '');
    s = s.replace(/\\[ \t]+\n/g, '\\\n');
    if (/[‘’“”]/.test(s) && !/['"]/.test(s)) s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    return s;
  }

  function parse(text) {
    const errors = [], warnings = [];
    let src = clean(text);
    if (!src) return { request: null, errors: ['Chưa dán gì'], warnings };
    if (/^(await\s+)?fetch\s*\(/.test(src)) {
      let f;
      try { f = parseFetch(src); } catch (e) { return { request: null, errors: [e.message], warnings }; }
      if (f.credentials === 'include') warnings.push('“Copy as fetch” không chép cookie. Nếu API đăng nhập bằng cookie, hãy dùng “Copy as cURL” thay thế.');
      return assemble({ method: f.method, url: f.url, headers: f.headers, bodyText: f.body }, errors, warnings, 'fetch');
    }
    const format = /\^"|\^\r?\n/.test(src) ? 'cmd' : 'bash';
    if (format === 'bash') src = src.replace(/`\r?\n/g, ' ').replace(/\r\n/g, '\n'); // nối dòng kiểu PowerShell
    let tokens;
    try { tokens = format === 'cmd' ? tokenizeCmd(src) : tokenize(src); } catch (e) { return { request: null, errors: ['Không tách được lệnh cURL: ' + e.message], warnings }; }
    if (tokens.rest) warnings.push(`Đã bỏ qua phần dán sau lệnh cURL: “${tokens.rest.length > 60 ? tokens.rest.slice(0, 60) + '…' : tokens.rest}”`);
    if (tokens[0] && /(^|[\\/])curl(\.exe)?$/i.test(tokens[0])) tokens.shift();
    if (!tokens.length) return { request: null, errors: ['Lệnh cURL trống'], warnings };

    let method = null, url = null, getMode = false, jsonMode = false, urlencoded = false;
    const headers = [];
    const data = [], extraQuery = [], form = [];
    const once = new Set();
    const warn = m => { if (m && !once.has(m)) { once.add(m); warnings.push(m); } };
    const setHeader = (k, v) => {
      const i = headers.findIndex(h => h.key.toLowerCase() === k.toLowerCase());
      if (i >= 0) headers.splice(i, 1);
      headers.push({ key: k, value: v, enabled: true });
    };

    for (let i = 0; i < tokens.length; i++) {
      let t = tokens[i];
      let val;
      if (t === '--') { url = url ?? tokens[i + 1]; break; }
      if (/^--[a-z0-9.-]+=/.test(t)) { val = t.slice(t.indexOf('=') + 1); t = t.slice(0, t.indexOf('=')); }
      else if (/^-[A-Za-z]/.test(t) && !t.startsWith('--')) {
        const f = t[1];
        if (SHORT_WITH_VALUE.has(f) && t.length > 2) { val = t.slice(2); t = '-' + f; } // -XPOST, -H'…'
        else if (!SHORT_WITH_VALUE.has(f) && t.length > 2) { // -sSL: nhiều cờ không cần giá trị
          for (const g of t.slice(1)) tokens.splice(i + 1, 0, '-' + g);
          continue;
        }
        t = SHORT_ALIAS[f] || t;
      }
      // Từ không phải cờ: URL đầu tiên; URL thứ hai trở đi (cURL gửi lần lượt) thì bỏ qua kèm cảnh báo
      if (!t.startsWith('-') || t === '-') {
        if (url == null) url = t;
        else warn(`Lệnh có nhiều URL: tool chỉ lấy URL đầu tiên, đã bỏ qua “${t.length > 60 ? t.slice(0, 60) + '…' : t}”`);
        continue;
      }
      const needs = LONG_WITH_VALUE.has(t);
      if (needs && val == null) {
        if (i + 1 >= tokens.length) { warn(`${t} thiếu giá trị: đã bỏ qua`); break; }
        val = tokens[++i];
      }
      switch (t) {
        case '--request': method = val.toUpperCase(); break;
        case '--head': method = method ?? 'HEAD'; break;
        case '--url': if (url == null) url = val; else warn(`Lệnh có nhiều URL: tool chỉ lấy URL đầu tiên, đã bỏ qua “${val}”`); break;
        case '--get': getMode = true; break;
        case '--url-query': extraQuery.push(val.startsWith('+') ? val.slice(1) : val); break;
        case '--oauth2-bearer': setHeader('Authorization', 'Bearer ' + val); break;
        case '--header': {
          const c = val.indexOf(':');
          if (c > 0) {
            const v = val.slice(c + 1).trim();
            if (v === '') warn(`Header "${val.slice(0, c).trim()}:" không có giá trị (cURL hiểu là bỏ header) → đã bỏ qua`);
            else setHeader(val.slice(0, c).trim(), v);
          } else if (/;\s*$/.test(val)) setHeader(val.replace(/;\s*$/, '').trim(), '');
          else if (val.startsWith('@')) warn('Đọc header từ file (-H @file) chưa hỗ trợ: đã bỏ qua, hãy thêm header trong tab Headers');
          else warn(`Header "${val}" thiếu dấu ":" → đã bỏ qua`);
          break;
        }
        case '--data': case '--data-ascii': case '--data-binary':
          if (val.startsWith('@')) warn(`Đọc body từ file (${t} ${val}) chưa hỗ trợ: body để trống, hãy dán nội dung vào tab Body`);
          else data.push(t === '--data-binary' ? val : val.replace(/[\r\n]/g, ''));
          break;
        case '--data-raw': data.push(val); break;
        case '--json':
          if (val.startsWith('@')) warn(`Đọc body từ file (--json ${val}) chưa hỗ trợ: body để trống, hãy dán JSON vào tab Body`);
          else data.push(val);
          jsonMode = true;
          break;
        case '--data-urlencode': {
          urlencoded = true;
          if (/^([^=@]*)@/.test(val)) { warn(`--data-urlencode đọc từ file (“${val}”) chưa hỗ trợ: đã bỏ qua`); break; }
          const eq = val.indexOf('=');
          if (eq < 0) data.push(enc(val));
          else if (eq === 0) data.push(enc(val.slice(1)));
          else data.push(val.slice(0, eq) + '=' + enc(val.slice(eq + 1)));
          break;
        }
        // multipart chưa gửi được: field chữ chuyển thành x-www-form-urlencoded, field file bỏ qua — đều có cảnh báo
        case '--form': case '--form-string': {
          const eq = val.indexOf('=');
          if (eq <= 0) { warn(`-F “${val}” không đúng dạng name=value: đã bỏ qua`); break; }
          const v = val.slice(eq + 1);
          if (t === '--form' && /^[@<]/.test(v)) { warn(`Field file “${val.slice(0, eq)}” (-F ${val.slice(0, eq)}=${v.split(';')[0]}) chưa gửi được: đã bỏ qua`); break; }
          form.push(val.slice(0, eq) + '=' + enc(t === '--form' ? v.replace(/;type=[^;]*$/, '') : v));
          break;
        }
        case '--user': {
          // Không có mật khẩu: cURL sẽ hỏi mật khẩu → coi như mật khẩu rỗng
          if (!val.includes(':')) warn('-u/--user không có mật khẩu: dùng mật khẩu rỗng, sửa lại ở tab Auth nếu cần');
          setHeader('Authorization', 'Basic ' + btoa(unescape(encodeURIComponent(val.includes(':') ? val : val + ':'))));
          break;
        }
        case '--cookie':
          if (!val.includes('=')) warn('-b/--cookie đọc từ file chưa hỗ trợ: đã bỏ qua, hãy ghi dạng name=value');
          else setHeader('Cookie', val);
          break;
        case '--user-agent': setHeader('User-Agent', val); break;
        case '--referer': setHeader('Referer', val.replace(/;auto$/, '')); break;
        default:
          if (t in IGNORED) warn(IGNORED[t]);
          else if (t in UNSUPPORTED) warn(UNSUPPORTED[t]);
          else warn(`Đã bỏ qua cờ ${t} (tool chưa dùng tới)`);
      }
    }
    if (form.length) {
      warn('multipart/form-data (-F) chưa hỗ trợ: các field chữ được gửi dạng x-www-form-urlencoded, kiểm tra lại API có chấp nhận không');
      data.push(...form);
      urlencoded = true;
    }
    if (extraQuery.length && url) url += (url.includes('?') ? '&' : '?') + extraQuery.join('&');

    return assemble({ method, url, headers, bodyText: getMode ? '' : data.join('&'), getData: getMode ? data.join('&') : '', jsonMode, urlencoded }, errors, warnings, format);
  }

  function assemble({ method, url, headers, bodyText, getData = '', jsonMode = false, urlencoded = false }, errors, warnings, format) {
    const setHeader = (k, v) => {
      const i = headers.findIndex(h => h.key.toLowerCase() === k.toLowerCase());
      if (i >= 0) headers.splice(i, 1);
      headers.push({ key: k, value: v, enabled: true });
    };
    if (!url) errors.push('Không thấy URL trong lệnh');
    else if (!/^https?:\/\//i.test(url) && !/^\{\{/.test(url)) {
      // Thiếu giao thức như cURL vẫn chạy: localhost / IP → http://, tên miền → https://
      if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#]|$)/i.test(url)) { warnings.push('URL không có giao thức, đã thêm http://'); url = 'http://' + url; }
      else if (/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(url)) { warnings.push('URL không có giao thức, đã thêm https://'); url = 'https://' + url; }
      else errors.push(`URL "${url}" phải bắt đầu bằng http:// hoặc https://`);
    }
    if (errors.length) return { request: null, errors, warnings };

    const parts = splitUrl(url);
    for (const p of getData.split('&').filter(Boolean)) {
      const i = p.indexOf('=');
      parts.query.push({ key: dec(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : dec(p.slice(i + 1)), enabled: true });
    }
    if (jsonMode) {
      if (!headers.some(h => h.key.toLowerCase() === 'content-type')) setHeader('Content-Type', 'application/json');
      if (!headers.some(h => h.key.toLowerCase() === 'accept')) setHeader('Accept', 'application/json');
    }
    const ct = (headers.find(h => h.key.toLowerCase() === 'content-type')?.value || '').toLowerCase();
    let mode = 'none';
    if (bodyText !== '') {
      let isJson = false;
      try { JSON.parse(bodyText); isJson = true; } catch {}
      if (jsonMode || (isJson && (!ct || ct.includes('json')))) mode = 'json';
      else if (urlencoded || ct.includes('x-www-form-urlencoded') || (!ct && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(bodyText))) mode = 'form-urlencoded';
      else mode = 'raw';
      if (mode === 'json' && !isJson) warnings.push('Body khai báo JSON nhưng chưa phải JSON hợp lệ, hãy kiểm tra lại ô Body');
      if (mode === 'json') { try { bodyText = JSON.stringify(JSON.parse(bodyText), null, 2); } catch {} }
    }
    if (!method) method = bodyText !== '' ? 'POST' : 'GET';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) return { request: null, errors: [`Method "${method}" không được hỗ trợ`], warnings };
    if ((method === 'GET' || method === 'HEAD') && bodyText !== '') warnings.push(`Method ${method} không gửi được body, body sẽ bị bỏ qua khi chạy`);
    return { request: { method, url: parts.url, query: parts.query, headers, body: { mode, text: bodyText } }, format, fromBrowser: format === 'cmd' || format === 'fetch' || looksLikeBrowser(headers), errors, warnings };
  }

  window.ApiCurl = { parse, tokenize, tokenizeCmd, muteBrowserHeaders };
})();
