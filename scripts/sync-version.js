// Đồng bộ phiên bản package.json → extension/manifest.json.
// Tự chạy khi dùng `npm version patch|minor|major` (hook "version" trong package.json).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const file = path.join(root, 'extension', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
if (manifest.version !== version) {
  manifest.version = version;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`manifest.json → v${version}`);
