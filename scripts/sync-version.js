// Đồng bộ phiên bản package.json → extension/manifest.json và CHANGELOG.md.
// Tự chạy khi dùng `npm version patch|minor|major` (hook "version" trong package.json).
// CHANGELOG: mục "Chưa phát hành" thành "[x.y.z] - ngày", thêm mục "Chưa phát hành" trống, cập nhật link.
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

const UNRELEASED = 'Chưa phát hành';
const changelogFile = path.join(root, 'CHANGELOG.md');
let changelog = fs.readFileSync(changelogFile, 'utf8');
if (changelog.includes(`## [${version}]`)) {
  console.log(`CHANGELOG.md đã có mục ${version}`);
} else {
  const today = new Date().toISOString().slice(0, 10);
  changelog = changelog
    .replace(`## [${UNRELEASED}]`, `## [${UNRELEASED}]\n\n## [${version}] - ${today}`)
    .replace(
      new RegExp(`^\\[${UNRELEASED}\\]: (.*)/compare/v[^.]+\\.[^.]+\\.[^.]+\\.\\.\\.HEAD$`, 'm'),
      `[${UNRELEASED}]: $1/compare/v${version}...HEAD\n[${version}]: $1/releases/tag/v${version}`,
    );
  fs.writeFileSync(changelogFile, changelog);
  console.log(`CHANGELOG.md → ${version} - ${today}`);
}
