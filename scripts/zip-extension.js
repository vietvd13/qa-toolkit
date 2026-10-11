// Đóng gói thư mục extension/ thành dist/bo-cong-cu-v<version>.zip để gửi cho team.
// Bỏ tools/_template (chỉ dùng khi viết tool mới). Chạy: npm run ext:zip
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
const distDir = path.join(root, 'dist');
const out = path.join(distDir, `bo-cong-cu-v${version}.zip`);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(out, { force: true });

if (process.platform === 'win32') {
  // tar có sẵn trong Windows 10+ (bsdtar) tạo được file .zip
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', out, '--exclude', 'tools/_template', '-C', extDir, '.'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', out, '.', '-x', 'tools/_template/*'], { cwd: extDir, stdio: 'inherit' });
}

const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`Đã tạo ${path.relative(root, out)} (${kb} KB)`);
console.log('Người nhận: giải nén → chrome://extensions → bật Developer mode → Load unpacked → chọn thư mục vừa giải nén.');
