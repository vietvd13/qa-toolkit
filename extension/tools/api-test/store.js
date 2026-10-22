// Service: lưu workspace trên máy (local-first: không máy chủ, không tài khoản, không đồng bộ).
//   ApiStore.open()            → Promise<{ records: { key: value }, session: object }>  đọc toàn bộ khi mở tool
//   ApiStore.put(key, value)   → ghi trễ 300 ms, gộp theo từng bản ghi (sửa 1 request chỉ ghi lại request đó)
//   ApiStore.remove(key)       → xoá bản ghi
//   ApiStore.setSession(obj)   → secret + runtime variables: chỉ sống trong phiên trình duyệt
//   ApiStore.flush()           → ghi ngay những gì đang chờ (gọi khi đóng trang)
//   ApiStore.onState(fn)       → fn({ state: 'saving' | 'saved' | 'error' | 'quota', message })
//   ApiStore.usage()           → Promise<{ bytes, quota }>
// Extension: chrome.storage.local (bền, không mã hoá) + chrome.storage.session (xoá khi đóng trình duyệt).
// Bản web:   localStorage + sessionStorage, cùng giao diện. Hai nơi KHÔNG dùng chung dữ liệu: muốn chuyển thì Export / Import.
(() => {
  const PREFIX = 'apiws.';
  const SESSION_KEY = 'apiws.session';
  const IS_EXT = !!globalThis.chrome?.storage?.local;
  const listeners = new Set();
  let lastState = { state: 'saved' };
  const emit = s => { lastState = s; listeners.forEach(fn => { try { fn(s); } catch {} }); };
  const isQuota = e => /quota|QUOTA_BYTES|exceeded/i.test(e?.message || '') || e?.name === 'QuotaExceededError';

  const backend = IS_EXT ? {
    async all() {
      const all = await chrome.storage.local.get(null);
      return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(PREFIX) && k !== SESSION_KEY).map(([k, v]) => [k.slice(PREFIX.length), v]));
    },
    set: obj => chrome.storage.local.set(Object.fromEntries(Object.entries(obj).map(([k, v]) => [PREFIX + k, v]))),
    remove: keys => chrome.storage.local.remove(keys.map(k => PREFIX + k)),
    async usage() {
      let bytes = null;
      try { bytes = await chrome.storage.local.getBytesInUse(null); } catch {}
      return { bytes, quota: chrome.storage.local.QUOTA_BYTES || null };
    },
    async getSession() {
      try { return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || {}; } catch { return {}; }
    },
    setSession: v => chrome.storage.session.set({ [SESSION_KEY]: v }),
  } : {
    async all() {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(PREFIX)) continue;
        try { out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch { out[k.slice(PREFIX.length)] = { __corrupt: true }; }
      }
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) localStorage.setItem(PREFIX + k, JSON.stringify(v)); },
    async remove(keys) { for (const k of keys) localStorage.removeItem(PREFIX + k); },
    async usage() {
      let bytes = 0;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) bytes += (k.length + (localStorage.getItem(k) || '').length) * 2; }
      return { bytes, quota: 5 * 1024 * 1024 };
    },
    async getSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; } },
    async setSession(v) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); },
  };

  // ---------- Hàng đợi ghi ----------
  const pending = new Map(); // key → value | undefined (xoá)
  let timer = null, writing = null;
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (writing) await writing.catch(() => {});
    if (!pending.size) return;
    const batch = new Map(pending);
    pending.clear();
    const sets = {}, dels = [];
    for (const [k, v] of batch) { if (v === undefined) dels.push(k); else sets[k] = v; }
    emit({ state: 'saving' });
    writing = (async () => {
      if (Object.keys(sets).length) await backend.set(sets);
      if (dels.length) await backend.remove(dels);
    })();
    try {
      await writing;
      emit({ state: pending.size ? 'saving' : 'saved' });
    } catch (e) {
      // Ghi lỗi: giữ lại để lần sau thử tiếp (bản mới hơn trong pending thắng)
      for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
      emit(isQuota(e)
        ? { state: 'quota', message: 'Bộ nhớ của trình duyệt đã đầy. Hãy Export workspace để sao lưu, rồi xoá bớt kết quả hoặc test case cũ.' }
        : { state: 'error', message: 'Không lưu được: ' + (e?.message || e) });
    } finally { writing = null; }
    if (pending.size && !timer) timer = setTimeout(flush, 2000);
  }
  const schedule = (ms = 300) => { emit({ state: 'saving' }); clearTimeout(timer); timer = setTimeout(flush, ms); };

  let sessionTimer = null, sessionValue = null;
  const flushSession = () => {
    clearTimeout(sessionTimer);
    sessionTimer = null;
    if (sessionValue) backend.setSession(sessionValue).catch(() => {});
  };

  window.ApiStore = {
    mode: IS_EXT ? 'extension' : 'web',
    async open() {
      const [records, session] = await Promise.all([backend.all(), backend.getSession()]);
      return { records, session };
    },
    put(key, value) { pending.set(key, JSON.parse(JSON.stringify(value))); schedule(); },
    remove(key) { pending.set(key, undefined); schedule(); },
    setSession(obj) { sessionValue = obj; clearTimeout(sessionTimer); sessionTimer = setTimeout(flushSession, 200); },
    flush() { flushSession(); return flush(); },
    retry() { return flush(); },
    onState(fn) { listeners.add(fn); fn(lastState); return () => listeners.delete(fn); },
    usage: () => backend.usage(),
  };
})();
