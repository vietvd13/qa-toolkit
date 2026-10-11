// Engine cho bản web (npm run ui): cùng giao diện với extension nhưng việc mở link do
// server.js đảm nhận (Playwright), kết quả trả về qua Server-Sent Events.
// Có cùng API với extension/tools/redirect/engine.js: RedirectEngine.run(query, handlers) → { close() }
(() => {
  function run(query, h) {
    const q = { ...query };
    delete q.clearCookies; // server luôn dùng phiên mới (cookie sạch) cho mỗi lượt
    const es = new EventSource('/api/run?' + new URLSearchParams(q));
    let closed = false;
    const close = () => { closed = true; es.close(); };
    es.addEventListener('start', e => h.start(JSON.parse(e.data)));
    es.addEventListener('row', e => h.row(JSON.parse(e.data)));
    es.addEventListener('done', () => { close(); h.done(); });
    es.addEventListener('fatal', e => { close(); h.fatal(JSON.parse(e.data).message); });
    es.onerror = () => {
      if (closed) return;
      close();
      h.fatal('Mất kết nối tới máy chủ. Kiểm tra cửa sổ đang chạy “npm run ui” rồi bấm Bắt đầu lại.');
    };
    return { close };
  }

  window.RedirectEngine = {
    run,
    features: {
      clearCookies: false,
      maxConcurrency: 30,
      runNote: 'Tool mở link bằng trình duyệt ngầm trên máy, mỗi lượt là một phiên mới (cookie sạch), đi hết chuỗi chuyển hướng rồi vẽ lại các link đã qua.',
    },
  };
})();
