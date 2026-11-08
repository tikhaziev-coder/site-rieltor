const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const core = require('../mortgage-core.js');
const base = { price: 5000000, downPaymentInput: 20, downPaymentUnit: 'percent', annualRate: 12,
  termInput: 20, termUnit: 'years', firstPaymentDate: '2026-12-08', extraMode: 'term', extraPayments: [] };
const cent = amount => Math.round(amount * 100);
const sum = (rows, key) => rows.reduce((total, row) => total + cent(row[key]), 0);
function checkLedger(result) {
  assert.equal(sum(result.schedule, 'principal') + sum(result.schedule, 'extra'), cent(result.input.principal));
  assert.equal(sum(result.schedule, 'interest'), cent(result.totalInterest));
  assert.equal(sum(result.schedule, 'payment') + sum(result.schedule, 'extra'), cent(result.totalPaid));
  assert.equal(cent(result.totalPaid), cent(result.input.principal) + cent(result.totalInterest));
  assert.equal(result.schedule.at(-1).balance, 0);
  assert.ok(result.schedule.every(row => row.balance >= 0 && row.principal >= 0 && row.extra >= 0));
}
test('annuity matches the published numpy-financial reference', () => {
  assert.ok(Math.abs(core.annuity(200000, 7.5, 180) - 1854.0247200054619) < 1e-8);
});
test('baseline mortgage, exact cent ledger and final payment', () => {
  const result = core.calculate(base); checkLedger(result);
  assert.equal(result.initialPayment, 44043.45);
  assert.equal(result.months, 240); assert.equal(result.lastDate, '2046-11-08');
  assert.equal(result.interestSaved, 0);
  assert.notEqual(result.schedule.at(-1).payment, result.initialPayment);
});
test('zero interest, one month, near-zero rate and very small remaining debt', () => {
  for (const overrides of [{ annualRate: 0 }, { termInput: 1, termUnit: 'months' },
    { annualRate: 0.000001 }, { price: 1000, downPaymentInput: 999.99, downPaymentUnit: 'rub', annualRate: 0 }]) {
    checkLedger(core.calculate({ ...base, ...overrides }));
  }
  assert.equal(core.calculate({ ...base, annualRate: 0 }).totalInterest, 0);
});
test('rubles/months and percentage/years give identical schedules', () => {
  assert.deepEqual(core.calculate(base).schedule, core.calculate({ ...base,
    downPaymentUnit: 'rub', downPaymentInput: 1000000, termUnit: 'months', termInput: 240 }).schedule);
});
test('maximum term is 30 years or 360 months, with identical schedules', () => {
  const years = core.calculate({ ...base, termInput: 30 });
  const months = core.calculate({ ...base, termInput: 360, termUnit: 'months' });
  checkLedger(years);
  assert.equal(years.months, 360);
  assert.deepEqual(years.schedule, months.schedule);
  for (const [termInput, termUnit] of [[31, 'years'], [50, 'years'], [361, 'months'], [600, 'months']]) {
    assert.throws(() => core.calculate({ ...base, termInput, termUnit }), /1–30 лет или 1–360 месяцев/);
  }
});
test('dates clamp to month end and recover original day, including leap year', () => {
  assert.equal(core.paymentDate('2027-01-31', 1), '2027-02-28');
  assert.equal(core.paymentDate('2028-01-31', 1), '2028-02-29');
  assert.equal(core.paymentDate('2028-01-31', 2), '2028-03-31');
  assert.equal(core.paymentDate('2026-12-31', 1), '2027-01-31');
});
test('early payments shorten term or lower subsequent payment', () => {
  const extraPayments = [{ amount: 500000, month: 12, frequency: 'once' }];
  const short = core.calculate({ ...base, extraPayments });
  const lower = core.calculate({ ...base, extraPayments, extraMode: 'payment' });
  checkLedger(short); checkLedger(lower);
  assert.ok(short.months < 240); assert.equal(short.schedule[12].payment, short.initialPayment);
  assert.equal(lower.months, 240); assert.ok(lower.schedule[12].payment < lower.initialPayment);
  assert.ok(short.interestSaved > lower.interestSaved && lower.interestSaved > 0);
});
test('monthly and overlapping extras are summed and capped at outstanding debt', () => {
  const result = core.calculate({ ...base, extraPayments: [
    { amount: 10000, month: 1, frequency: 'monthly' },
    { amount: 10000, month: 1, frequency: 'once' },
    { amount: 1e8, month: 3, frequency: 'once' }
  ] });
  checkLedger(result); assert.equal(result.schedule[0].extra, 20000);
  assert.equal(result.schedule[1].extra, 10000); assert.equal(result.months, 3);
  assert.ok(result.schedule[2].extra < 1e8);
});
test('invalid amounts, dates, terms and nonamortizing terms are rejected', () => {
  for (const overrides of [{ price: '' }, { downPaymentInput: 100 }, { annualRate: -1 },
    { termInput: 0 }, { termInput: 20.5 }, { firstPaymentDate: '2026-02-30' },
    { firstPaymentDate: '0000-01-01' }, { annualRate: 100, termInput: 30 },
    { extraPayments: [{ amount: 1000, month: 241, frequency: 'once' }] }]) {
    assert.throws(() => core.calculate({ ...base, ...overrides }));
  }
  assert.equal(core.number('5\u202f000\u00a0000,25', 'price'), 5000000.25);
  assert.throws(() => core.number('1e6', 'price'));
});

function storage() {
  const map = new Map();
  return { map, get length() { return map.size; }, key: index => [...map.keys()][index],
    getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
function client(enabled, fetch) {
  const localStorage = storage(), sessionStorage = storage();
  const window = { MORTGAGE_CONFIG: { analytics: { enabled, endpoint: 'https://script.google.com/macros/s/test_endpoint/exec', siteId: 'kashapova-real-estate' } },
    crypto: webcrypto, localStorage, sessionStorage, addEventListener() {} };
  const context = vm.createContext({ window, navigator: { onLine: true }, location: { protocol: 'file:', pathname: '/PRIVATE/PATH' },
    fetch, console: { warn() {} }, Intl, Date, Map, AbortController, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../mortgage-analytics.js'), 'utf8'), context);
  return { api: window.MortgageAnalytics, localStorage, sessionStorage, context };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('disabled analytics never writes storage or sends data', async () => {
  let sent = 0; const c = client(false, async () => { sent++; });
  assert.equal(c.api.track(core.calculate(base)), null); await settle();
  assert.equal(sent, 0); assert.equal(c.localStorage.length + c.sessionStorage.length, 0);
});
test('each submit is distinct; visitor stays same; acknowledged events leave queue', async () => {
  const events = [];
  const c = client(true, async (url, options) => {
    const event = JSON.parse(options.body); events.push(event);
    return { ok: true, json: async () => ({ ok: true, eventId: event.eventId }) };
  });
  c.api.track(core.calculate(base)); c.api.track(core.calculate(base)); await settle();
  assert.equal(events.length, 2); assert.notEqual(events[0].eventId, events[1].eventId);
  assert.equal(events[0].visitorId, events[1].visitorId);
  assert.equal(events[0].pagePath, 'local-preview');
  assert.equal(events[0].results.initialPayment, 44043.45);
  assert.equal([...c.localStorage.map.keys()].filter(key => key.includes('.event.')).length, 0);
});
test('failed delivery stays queued and is retried with the same event ID', async () => {
  const c = client(true, async () => { throw new Error('offline'); });
  const id = c.api.track(core.calculate(base)); await settle();
  assert.equal([...c.localStorage.map.keys()].filter(key => key.includes('.event.')).length, 1);
  c.context.fetch = async (url, options) => {
    assert.equal(JSON.parse(options.body).eventId, id);
    return { ok: true, json: async () => ({ ok: true, eventId: id }) };
  };
  await c.api.flush();
  assert.equal([...c.localStorage.map.keys()].filter(key => key.includes('.event.')).length, 0);
});

function googleHandler() {
  const data = [[]], summaryData = [];
  function sheet(rows) {
    return { getLastRow: () => rows.length, getRange(row, column, height, width) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[column - 1 + j] ?? '')),
        setValues(values) { values.forEach((valuesRow, i) => {
          rows[row - 1 + i] ||= []; valuesRow.forEach((value, j) => { rows[row - 1 + i][column - 1 + j] = value; });
        }); },
        createTextFinder(value) { return { matchEntireCell() { return this; }, findNext: () => rows.slice(1).some(r => r[0] === value) }; }
      };
    } };
  }
  const rows = sheet(data), summary = sheet(summaryData);
  let locked = false;
  const lock = { tryLock() { locked = true; return true; }, hasLock: () => locked, releaseLock() { locked = false; } };
  const context = vm.createContext({ console, Date, JSON, Set, Number, Math,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'sheet-id' }) },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => name === 'Расчёты' ? rows : summary }), flush() {} },
    Utilities: { formatDate(date, zone, format) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
      return format === 'yyyy-MM-dd' ? [parts.year, parts.month, parts.day].join('-') : [parts.hour, parts.minute, parts.second].join(':');
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../analytics/Code.gs'), 'utf8'), context);
  data[0] = [...vm.runInContext('HEADERS', context)];
  return { data, summaryData, locked: () => locked, post: event => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(event) } }).text) };
}
function sampleEvent() {
  const r = core.calculate(base);
  return { schemaVersion: 1, modelVersion: 'annuity-monthly-cents-v1', event: 'mortgage_calculated', eventId: 'event-12345678', visitorId: 'visitor-12345678', sessionId: 'session-12345678',
    calculatedAt: '2026-11-08T21:15:30.000Z', visitorTimezone: 'Europe/Moscow', siteId: 'kashapova-real-estate', pagePath: '/', inputs: r.input,
    results: { initialPayment: r.initialPayment, totalInterest: r.totalInterest, totalPaid: r.totalPaid, months: r.months, lastDate: r.lastDate, interestSaved: r.interestSaved, monthsSaved: r.monthsSaved } };
}
test('Google handler writes 32 columns, timezone date, unique-browser summary and deduplicates retries', () => {
  const g = googleHandler(); const event = sampleEvent();
  assert.equal(g.post(event).ok, true); assert.equal(g.data.length, 2); assert.equal(g.data[1].length, 32);
  assert.equal(g.data[1][3], '2026-11-09'); assert.equal(g.data[1][4], '02:15:30');
  assert.equal(g.post(event).duplicate, true); assert.equal(g.data.length, 2);
  assert.equal(g.post({ ...event, eventId: 'event-87654321' }).ok, true);
  assert.equal(g.summaryData[1][1], 2); assert.equal(g.summaryData[2][1], 1); assert.equal(g.locked(), false);
});
test('Google handler rejects bad events and escapes spreadsheet-formula injection', () => {
  const g = googleHandler(); const event = sampleEvent();
  assert.equal(g.post({ ...event, siteId: 'other' }).retryable, false);
  for (const [termInput, termUnit, termMonths] of [[31, 'years', 372], [361, 'months', 361]]) {
    assert.equal(g.post({ ...event, inputs: { ...event.inputs, termInput, termUnit, termMonths } }).ok, false);
  }
  assert.equal(g.data.length, 1);
  assert.equal(g.post({ ...event, pagePath: '=IMPORTXML("secret")' }).ok, true);
  assert.equal(g.data[1][10], "'=IMPORTXML(\"secret\")");
  assert.equal(g.locked(), false);
});
