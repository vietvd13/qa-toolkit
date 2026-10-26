// Cấu hình ESLint (flat config). Chạy: npm run lint
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'dist/', 'results/'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  // Bản chạy bằng Node (CLI, server web, script build)
  {
    files: ['node/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  // Engine của bản web chạy trong trình duyệt
  {
    files: ['node/redirect-engine.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  // Chrome extension: trang thường + API chrome.*, chia sẻ biến toàn cục giữa các file
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions, RedirectEngine: 'readonly', Theme: 'readonly', TOOLS: 'readonly',
        Xlsx: 'readonly', ApiCheck: 'readonly', ApiTransport: 'readonly', ApiReport: 'readonly', ApiSchema: 'readonly', ApiCurl: 'readonly',
        ApiRedact: 'readonly', ApiPolicy: 'readonly', ApiRunner: 'readonly', ApiPrompt: 'readonly', ApiLegacy: 'readonly', ApiScript: 'readonly',
        ApiStore: 'readonly', ApiWorkspace: 'readonly', ApiEngine: 'readonly', Ui: 'readonly' },
    },
  },
  { files: ['extension/background.js'], languageOptions: { globals: { ...globals.serviceworker } } },
  // Script dán vào Console
  {
    files: ['extras/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser } },
  },
];
