/* Google Sheets: только явные успешные расчёты, подтверждение сервера и очередь.
   При enabled=false не создаём идентификаторы, не сохраняем и не отправляем данные. */
(() => {
  'use strict';
  const config = window.MORTGAGE_CONFIG?.analytics || {};
  const prefix = 'mortgage.' + (config.siteId || 'site') + '.';
  const memory = new Map();
  let sending = false, retryTimer = null, attempts = 0;
  const uuid = () => window.crypto.randomUUID ? window.crypto.randomUUID() : 'id-' + Array.from(window.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
  function isEnabled() {
    return config.enabled === true && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.endpoint || '');
  }
  function identifier(storageName, key) {
    const fullKey = prefix + key;
    try {
      const storage = window[storageName];
      const existing = storage.getItem(fullKey);
      if (existing) return existing;
      const value = uuid(); storage.setItem(fullKey, value); return value;
    } catch {
      if (!memory.has(fullKey)) memory.set(fullKey, uuid());
      return memory.get(fullKey);
    }
  }
  function remove(id) {
    const key = prefix + 'event.' + id;
    memory.delete(key);
    try { window.localStorage.removeItem(key); } catch { /* Работаем из памяти. */ }
  }
  function pending() {
    const events = new Map();
    const collect = (key, value) => {
      if (!key.startsWith(prefix + 'event.')) return;
      try { const event = JSON.parse(value); if (event.eventId) events.set(event.eventId, event); } catch { /* Повреждённая запись не отправляется. */ }
    };
    memory.forEach((value, key) => collect(key, value));
    try {
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key) collect(key, window.localStorage.getItem(key));
      }
    } catch { /* localStorage может быть недоступен, например в приватном режиме. */ }
    const oldest = Date.now() - (config.retentionDays || 30) * 86400000;
    return [...events.values()].filter(event => {
      if (Date.parse(event.calculatedAt) >= oldest) return true;
      remove(event.eventId); return false;
    }).sort((a, b) => a.calculatedAt.localeCompare(b.calculatedAt));
  }
  function save(event) {
    const key = prefix + 'event.' + event.eventId;
    const value = JSON.stringify(event);
    try { window.localStorage.setItem(key, value); } catch { memory.set(key, value); }
    const queue = pending();
    queue.slice(0, Math.max(0, queue.length - (config.queueLimit || 100))).forEach(item => remove(item.eventId));
  }
  async function flush() {
    if (!isEnabled() || sending || navigator.onLine === false) return;
    sending = true;
    let failed = false;
    try {
      for (const event of pending()) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          // text/plain — простой POST без OPTIONS; Google ContentService использует redirect.
          const response = await fetch(config.endpoint, { method: 'POST', mode: 'cors', credentials: 'omit',
            redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(event), signal: controller.signal, keepalive: true });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const ack = await response.json();
          if (ack.ok === true && ack.eventId === event.eventId) { remove(event.eventId); attempts = 0; }
          else if (ack.ok === false && ack.retryable === false) { remove(event.eventId); console.warn('Mortgage analytics: invalid event rejected.'); }
          else throw new Error('No confirmation');
        } finally { clearTimeout(timer); }
      }
    } catch {
      failed = true;
      console.warn('Mortgage analytics: awaiting delivery confirmation; event remains in the local queue.');
    } finally { sending = false; }
    if (!failed && pending().length) { void flush(); }
    if (failed && attempts < 3 && !retryTimer) {
      retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, 30000 * 2 ** attempts++);
    }
  }
  function track(result) {
    if (!isEnabled()) return null;
    try {
      const event = {
        schemaVersion: 1, modelVersion: 'annuity-monthly-cents-v1', event: 'mortgage_calculated',
        eventId: uuid(), calculatedAt: new Date().toISOString(),
        visitorId: identifier('localStorage', 'visitor'), sessionId: identifier('sessionStorage', 'session'),
        visitorTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
        siteId: config.siteId,
        pagePath: /^https?:$/.test(location.protocol) ? location.pathname.slice(0, 250) : 'local-preview',
        inputs: result.input,
        results: { initialPayment: result.initialPayment, totalInterest: result.totalInterest,
          totalPaid: result.totalPaid, months: result.months, lastDate: result.lastDate,
          interestSaved: result.interestSaved, monthsSaved: result.monthsSaved }
      };
      save(event); void flush(); return event.eventId;
    } catch { console.warn('Mortgage analytics unavailable; calculation is unaffected.'); return null; }
  }
  window.MortgageAnalytics = Object.freeze({ isEnabled, track, flush });
  if (isEnabled()) {
    window.addEventListener('online', () => { void flush(); });
    void flush();
  }
})();
