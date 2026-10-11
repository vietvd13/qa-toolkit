// Kiểm tra dự án trước khi phát hành. Chạy: npm run check
// - Phiên bản manifest.json khớp package.json
// - Mỗi tool trong tools/registry.js có đủ file, id không trùng
// - Mọi trang HTML của extension nạp theme.css + theme.js, không có <script> viết trực tiếp (MV3 chặn)
// - Mọi đường dẫn src/href nội bộ trong HTML đều tồn tại
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ext = path.join(root, 'extension');
const errors = [];
const fail = msg => errors.push(msg);
const rel = p => path.relative(root, p).replace(/\\/g, '/');

// 1) Phiên bản
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) fail(`Phiên bản lệch nhau: manifest.json ${manifest.version} ≠ package.json ${pkg.version} (chạy: node scripts/sync-version.js)`);
if (manifest.manifest_version !== 3) fail('manifest.json phải là Manifest V3');
for (const size of Object.values(manifest.icons || {})) if (!fs.existsSync(path.join(ext, size))) fail(`Thiếu icon: extension/${size}`);
if (!fs.existsSync(path.join(ext, manifest.background.service_worker))) fail('Thiếu file service worker của extension');

// 2) Danh sách tool
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ext, 'tools/registry.js'), 'utf8'), sandbox);
const tools = sandbox.window.TOOLS || [];
if (!tools.length) fail('tools/registry.js chưa có công cụ nào');
const ids = new Set();
for (const t of tools) {
  for (const k of ['id', 'name', 'icon', 'desc', 'path']) if (!t[k]) fail(`Tool "${t.id || '?'}" thiếu trường "${k}"`);
  if (ids.has(t.id)) fail(`Trùng id tool: ${t.id}`);
  ids.add(t.id);
  if (t.path && !fs.existsSync(path.join(ext, t.path))) fail(`Tool "${t.id}": không thấy extension/${t.path}`);
}

// 3) + 4) Trang HTML
const htmlFiles = [];
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmlFiles.push(p);
  }
};
walk(ext);
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, ''); // bỏ phần chú thích
  if (!/theme\.css"/.test(html)) fail(`${rel(file)}: chưa nạp shared/theme.css`);
  if (!/theme\.js"/.test(html)) fail(`${rel(file)}: chưa nạp shared/theme.js (sáng/tối + màu tự chọn)`);
  if (/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html)) fail(`${rel(file)}: có <script> viết trực tiếp trong HTML — extension MV3 sẽ chặn, hãy chuyển sang file .js`);
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail(`${rel(file)}: có thuộc tính onclick/onload… — extension MV3 sẽ chặn`);
  for (const [, ref] of html.matchAll(/\s(?:src|href)="([^"#?]+)"/g)) {
    if (/^(https?:|data:|mailto:|#)/.test(ref)) continue;
    if (!fs.existsSync(path.join(path.dirname(file), ref))) fail(`${rel(file)}: không thấy file "${ref}"`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} lỗi:\n` + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ Ổn: v${manifest.version} · ${tools.length} công cụ · ${htmlFiles.length} trang HTML`);
