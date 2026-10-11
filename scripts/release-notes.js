// In ra nội dung mục phiên bản trong CHANGELOG.md, dùng làm mô tả cho GitHub Release.
// Chạy: node scripts/release-notes.js 1.3.0 > notes.md
const fs = require('fs');
const path = require('path');

const version = (process.argv[2] || '').replace(/^v/, '');
const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const start = changelog.indexOf(`## [${version}]`);
if (!version || start === -1) {
  console.error(`Không thấy mục ${version || '(trống)'} trong CHANGELOG.md`);
  process.exit(1);
}
const body = changelog.slice(changelog.indexOf('\n', start) + 1);
const end = body.search(/^## \[|^\[[^\]]+\]: /m);
process.stdout.write((end === -1 ? body : body.slice(0, end)).trim() + '\n');
