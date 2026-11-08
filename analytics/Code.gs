/* Google Apps Script. Вставьте в проект, привязанный к вашей Google Таблице.
   Один раз выполните setupAnalytics(), затем разверните веб-приложение.
   Публичный обработчик принимает только записи. Данные таблицы он не возвращает. */
const ANALYTICS_SITE_ID = 'kashapova-real-estate';
const REPORT_TIMEZONE = 'Asia/Yekaterinburg';
const SHEET_NAME = 'Расчёты';
const HEADERS = [
  'ID события', 'Получено сервером, UTC', 'Время расчёта, UTC', 'Дата расчёта', 'Время расчёта',
  'Часовой пояс отчёта', 'Часовой пояс посетителя', 'ID браузера', 'ID сессии', 'Сайт', 'Страница',
  'Стоимость жилья, ₽', 'Взнос — введённое значение', 'Единица взноса', 'Взнос, ₽', 'Взнос, %',
  'Сумма кредита, ₽', 'Ставка, % годовых', 'Срок — введённое значение', 'Единица срока', 'Срок, мес.',
  'Первый платёж', 'Режим досрочного погашения', 'Досрочные платежи, JSON',
  'Начальный платёж, ₽', 'Переплата, ₽', 'Всего выплат банку, ₽', 'Фактический срок, мес.',
  'Последний платёж', 'Экономия процентов, ₽', 'Сокращение срока, мес.', 'Версия формулы'
];

function setupAnalytics() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Откройте Расширения → Apps Script из нужной Google Таблицы.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.getRange(1, 1, 1, HEADERS.length).setBackground('#795b48').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1); sheet.setColumnWidths(1, HEADERS.length, 170);
      sheet.setColumnWidth(24, 420);
    } else if (sheet.getRange(1, 1).getValue() !== HEADERS[0]) {
      throw new Error('Лист «Расчёты» уже занят другими данными. Выберите другую таблицу.');
    }
    // Заполняем новый лист. Повторный запуск не затирает пользовательскую сводку.
    const summary = spreadsheet.getSheetByName('Сводка') || spreadsheet.insertSheet('Сводка');
    if (summary.getLastRow() === 0) {
      summary.getRange('A1:B6').setValues([
        ['Ипотечный калькулятор', 'Показатель'], ['Успешных расчётов', ''],
        ['Уникальных браузеров', ''], ['Средняя сумма кредита, ₽', ''],
        ['Средняя ставка, %', ''], ['Средний начальный платёж, ₽', '']
      ]);
      summary.getRange('B4:B6').setNumberFormat('#,##0.00');
      summary.getRange('A1:B1').setBackground('#795b48').setFontColor('#ffffff').setFontWeight('bold');
      summary.getRange('A8').setValue('Один браузер может сделать несколько расчётов. Это не точное число людей.');
      summary.setColumnWidth(1, 370); summary.setColumnWidth(2, 200);
    }
    updateSummary_(spreadsheet, sheet);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

function updateSummary_(spreadsheet, sheet) {
  const summary = spreadsheet.getSheetByName('Сводка');
  if (!summary) return;
  const count = Math.max(0, sheet.getLastRow() - 1);
  const rows = count ? sheet.getRange(2, 8, count, 18).getValues() : [];
  const unique = new Set(rows.map(row => row[0]).filter(Boolean)).size;
  const average = index => count ? rows.reduce((sum, row) => sum + (Number(row[index]) || 0), 0) / count : 0;
  // Числа вместо формул: работает при любой локали Google Таблицы.
  summary.getRange(2, 2, 5, 1).setValues([[count], [unique], [average(9)], [average(10)], [average(17)]]);
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function invalid_() { const error = new Error('invalid_payload'); error.invalid = true; throw error; }
function finite_(value, min, max) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid_(); }
function string_(value, max) { if (typeof value !== 'string' || value.length > max) invalid_(); }
function safeCell_(value) {
  // Предотвращает выполнение формул из клиентских строк в Google Sheets / CSV.
  return typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
}
function validateEvent_(event) {
  if (!event || event.schemaVersion !== 1 || event.event !== 'mortgage_calculated' || event.siteId !== ANALYTICS_SITE_ID || event.modelVersion !== 'annuity-monthly-cents-v1') invalid_();
  ['eventId', 'visitorId', 'sessionId'].forEach(key => {
    if (typeof event[key] !== 'string' || !/^[\w-]{8,80}$/.test(event[key])) invalid_();
  });
  string_(event.calculatedAt, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(event.calculatedAt) || !Number.isFinite(Date.parse(event.calculatedAt))) invalid_();
  string_(event.visitorTimezone, 80); string_(event.pagePath, 250);
  const i = event.inputs, r = event.results;
  if (!i || !r) invalid_();
  finite_(i.price, 1000, 1e9); finite_(i.downPaymentInput, 0, 1e9);
  finite_(i.downPaymentAmount, 0, i.price); finite_(i.downPaymentPercent, 0, 100);
  finite_(i.principal, 0.01, i.price); finite_(i.annualRate, 0, 100);
  finite_(i.termInput, 1, 360); finite_(i.termMonths, 1, 360);
  if (!Number.isInteger(i.termMonths) || !Number.isInteger(i.termInput) || !['percent','rub'].includes(i.downPaymentUnit) || !['years','months'].includes(i.termUnit) || !['term','payment'].includes(i.extraMode)) invalid_();
  if (i.termMonths !== i.termInput * (i.termUnit === 'years' ? 12 : 1) || Math.abs(i.price - i.downPaymentAmount - i.principal) > 0.02) invalid_();
  if (typeof i.firstPaymentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(i.firstPaymentDate)) invalid_();
  if (!Array.isArray(i.extraPayments) || i.extraPayments.length > 12) invalid_();
  i.extraPayments.forEach(extra => {
    finite_(extra.amount, 1, 1e9); finite_(extra.month, 1, i.termMonths);
    if (!Number.isInteger(extra.month) || !['once', 'monthly'].includes(extra.frequency)) invalid_();
  });
  ['initialPayment', 'totalInterest', 'totalPaid', 'interestSaved'].forEach(key => finite_(r[key], 0, 1e12));
  finite_(r.months, 1, i.termMonths); finite_(r.monthsSaved, 0, i.termMonths);
  if (!Number.isInteger(r.months) || !Number.isInteger(r.monthsSaved) || typeof r.lastDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.lastDate) || Math.abs(r.totalPaid - i.principal - r.totalInterest) > 0.03) invalid_();
}
function doGet() { return jsonResponse_({ ok: true, service: 'mortgage-analytics', schemaVersion: 1 }); }
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 16000) invalid_();
    let event;
    try { event = JSON.parse(e.postData.contents); } catch { invalid_(); }
    validateEvent_(event);
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) return jsonResponse_({ ok: false, retryable: true, error: 'setup_required' });
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, retryable: true, error: 'busy' });
    const spreadsheet = SpreadsheetApp.openById(id);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 1) throw new Error('setup_required');
    const lastRow = sheet.getLastRow();
    if (lastRow > 1 && sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(event.eventId).matchEntireCell(true).findNext()) {
      updateSummary_(spreadsheet, sheet); SpreadsheetApp.flush();
      return jsonResponse_({ ok: true, eventId: event.eventId, duplicate: true });
    }
    const time = new Date(event.calculatedAt), i = event.inputs, r = event.results;
    const row = [event.eventId, new Date().toISOString(), event.calculatedAt,
      Utilities.formatDate(time, REPORT_TIMEZONE, 'yyyy-MM-dd'), Utilities.formatDate(time, REPORT_TIMEZONE, 'HH:mm:ss'),
      REPORT_TIMEZONE, event.visitorTimezone, event.visitorId, event.sessionId, event.siteId, event.pagePath,
      i.price, i.downPaymentInput, i.downPaymentUnit, i.downPaymentAmount, i.downPaymentPercent, i.principal,
      i.annualRate, i.termInput, i.termUnit, i.termMonths, i.firstPaymentDate, i.extraMode, JSON.stringify(i.extraPayments),
      r.initialPayment, r.totalInterest, r.totalPaid, r.months, r.lastDate, r.interestSaved, r.monthsSaved, event.modelVersion];
    sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row.map(safeCell_)]);
    updateSummary_(spreadsheet, sheet);
    SpreadsheetApp.flush();
    return jsonResponse_({ ok: true, eventId: event.eventId });
  } catch (error) {
    return jsonResponse_({ ok: false, retryable: !error.invalid, error: error.invalid ? 'invalid_payload' : 'storage_error' });
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
