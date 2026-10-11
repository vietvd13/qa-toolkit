// Quy tắc lời nhắn commit (Conventional Commits). Xem CONTRIBUTING.md › Quy tắc commit.
// Kiểm tra tự động khi commit (husky) và trên Pull Request (GitHub Actions).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Phạm vi = các phần cố định + id của từng công cụ trong extension/tools/registry.js
const toolIds = (() => {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'extension/tools/registry.js'), 'utf8'), sandbox);
    return (sandbox.window.TOOLS || []).map(t => t.id);
  } catch {
    return [];
  }
})();

const SCOPES = [
  'hub', // khung bộ công cụ: đầu trang, thanh bên, danh mục
  'theme', // hệ màu, giao diện dùng chung (shared/)
  'template', // khung mẫu tools/_template
  'ext', // manifest, quyền, icon, đóng gói extension
  'web', // bản web (node/server.js)
  'cli', // bản dòng lệnh (node/trace.js)
  'console', // script dán vào Console (extras/)
  'deps', // thư viện
  'ci', // GitHub Actions
  'docs', // tài liệu
  'release', // phát hành phiên bản
  ...toolIds,
];

module.exports = {
  extends: ['@commitlint/config-conventional'],
  // Commit do Dependabot tạo ("chore(deps): Bump …", viết hoa chữ đầu) không sửa được → bỏ qua
  ignores: [msg => /^Signed-off-by: dependabot\[bot\]/m.test(msg)],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'style', 'docs', 'test', 'build', 'ci', 'chore', 'revert']],
    'scope-enum': [2, 'always', SCOPES],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
    'footer-max-line-length': [0],
  },
  helpUrl: 'https://github.com/vietvd13/qa-toolkit/blob/master/CONTRIBUTING.md#quy-tắc-commit',
};
