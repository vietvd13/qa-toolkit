// Service: chạy script của tester trong iframe sandbox (sandbox.html) và chờ kết quả.
//   ApiScript.run(kind, payload, { timeout, onSend }) → Promise<{ error, logs, tests, vars, request, requestChanged }>
//     kind: 'pre' (trước khi gửi) | 'post' (sau khi nhận response) | 'check' (chỉ kiểm cú pháp)
//     onSend(request) → Promise<response>: gửi hộ pm.sendRequest (nơi gọi tự kiểm host được phép)
// Script không bao giờ chạy trong trang này: trang sandbox có origin riêng, không có API chrome.*, CSP chặn mạng.
(() => {
  let frame = null, ready = null, seq = 0;
  const pending = new Map();

  function ensure() {
    if (ready) return ready;
    frame = document.createElement('iframe');
    frame.src = 'sandbox.html';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = 'Sandbox chạy script';
    frame.hidden = true;
    ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Không khởi động được sandbox chạy script')), 10000);
      const onReady = e => {
        if (e.source !== frame.contentWindow || e.data?.type !== 'ready') return;
        clearTimeout(t);
        window.removeEventListener('message', onReady);
        resolve();
      };
      window.addEventListener('message', onReady);
    });
    document.body.appendChild(frame);
    ready.catch(() => { frame.remove(); frame = null; ready = null; });
    return ready;
  }

  window.addEventListener('message', async e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data || {};
    const p = pending.get(d.id);
    if (!p) return;
    if (d.type === 'result') { pending.delete(d.id); p.done(d.result); }
    else if (d.type === 'send') {
      let reply;
      try {
        if (!p.onSend) throw new Error('pm.sendRequest không dùng được ở đây');
        reply = { ok: true, response: await p.onSend(d.request) };
      } catch (x) { reply = { ok: false, error: x.message }; }
      frame?.contentWindow.postMessage({ type: 'sendResult', id: d.id, reqId: d.reqId, ...reply }, '*');
    }
  });

  async function run(kind, payload, { timeout = 15000, onSend } = {}) {
    try { await ensure(); } catch (x) { return { error: x.message, logs: [], tests: [], vars: payload.vars || {}, request: payload.request || null, requestChanged: false }; }
    const id = ++seq;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pending.delete(id);
        frame?.contentWindow.postMessage({ type: 'cancel', id }, '*');
        resolve({ error: `Script chạy quá ${Math.round(timeout / 1000)} giây nên đã bị dừng`, logs: [], tests: [], vars: payload.vars || {}, request: payload.request || null, requestChanged: false });
      }, timeout);
      pending.set(id, { onSend, done: r => { clearTimeout(timer); resolve(r); } });
      // Dữ liệu đi qua postMessage phải là JSON thuần
      frame.contentWindow.postMessage({ type: 'run', id, kind, payload: JSON.parse(JSON.stringify(payload)) }, '*');
    });
  }

  window.ApiScript = { run, check: code => run('check', { code }, { timeout: 5000 }) };
})();
