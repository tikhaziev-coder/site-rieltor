/* Аннуитет, равные месячные периоды, платежи в конце периода.
   Суммы графика считаются в копейках; последний платёж закрывает остаток.
   Формула: https://numpy.org/numpy-financial/latest/_api_stubs/numpy_financial.pmt.html */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MortgageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const cents = value => Math.round((value + Number.EPSILON) * 100);
  function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
  function number(value, field) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(text)) fail(field, 'Введите число без букв и других символов.');
    const result = Number(text);
    if (!Number.isFinite(result)) fail(field, 'Проверьте введённое число.');
    return result;
  }
  function validateDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function paymentDate(first, offset) {
    const [year, month, day] = first.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month + offset, 0)).getUTCDate();
    return new Date(Date.UTC(year, month - 1 + offset, Math.min(day, lastDay), 12)).toISOString().slice(0, 10);
  }
  function annuity(principal, annualRate, months) {
    const rate = annualRate / 1200;
    return rate === 0 ? principal / months : principal * rate / -Math.expm1(-months * Math.log1p(rate));
  }
  function normalize(raw) {
    const price = number(raw.price, 'price');
    const down = number(raw.downPaymentInput, 'downPayment');
    const annualRate = number(raw.annualRate, 'annualRate');
    const termInput = number(raw.termInput, 'term');
    if (price < 1000 || price > 1e9) fail('price', 'Стоимость жилья должна быть от 1 000 до 1 000 000 000 ₽.');
    if (!['percent', 'rub'].includes(raw.downPaymentUnit)) fail('downPayment', 'Выберите ₽ или %.');
    if (down < 0 || (raw.downPaymentUnit === 'percent' && down >= 100)) fail('downPayment', 'Взнос должен быть от 0% до значения меньше 100%.');
    const downCents = raw.downPaymentUnit === 'percent' ? Math.round(cents(price) * down / 100) : cents(down);
    if (downCents >= cents(price)) fail('downPayment', 'Первоначальный взнос должен быть меньше стоимости жилья.');
    if (annualRate < 0 || annualRate > 100) fail('annualRate', 'Укажите годовую ставку от 0 до 100%.');
    if (!['years', 'months'].includes(raw.termUnit)) fail('term', 'Выберите срок в годах или месяцах.');
    const termMonths = termInput * (raw.termUnit === 'years' ? 12 : 1);
    if (!Number.isInteger(termInput) || termMonths < 1 || termMonths > 360) fail('term', 'Укажите целый срок: 1–30 лет или 1–360 месяцев.');
    if (!validateDate(raw.firstPaymentDate) || Number(raw.firstPaymentDate.slice(0, 4)) < 1900 || Number(raw.firstPaymentDate.slice(0, 4)) > 2200) fail('firstPaymentDate', 'Укажите корректную дату первого платежа с 1900 по 2200 год.');
    if (!['term', 'payment'].includes(raw.extraMode)) fail('extraMode', 'Выберите вариант досрочного погашения.');
    if (!Array.isArray(raw.extraPayments) || raw.extraPayments.length > 12) fail('extraMode', 'Можно добавить до 12 досрочных платежей.');
    const extraPayments = raw.extraPayments.map((extra, index) => {
      const amount = number(extra.amount, 'extra.' + index + '.amount');
      const month = number(extra.month, 'extra.' + index + '.month');
      if (amount < 1 || amount > 1e9) fail('extra.' + index + '.amount', 'Досрочный платёж должен быть от 1 до 1 000 000 000 ₽.');
      if (!Number.isInteger(month) || month < 1 || month > termMonths) fail('extra.' + index + '.month', 'Номер месяца должен быть в пределах срока кредита.');
      if (!['once', 'monthly'].includes(extra.frequency)) fail('extra.' + index + '.frequency', 'Выберите периодичность платежа.');
      return { amount: cents(amount) / 100, month, frequency: extra.frequency };
    });
    return {
      price: cents(price) / 100, downPaymentInput: down, downPaymentUnit: raw.downPaymentUnit,
      downPaymentAmount: downCents / 100, downPaymentPercent: downCents / cents(price) * 100,
      principal: (cents(price) - downCents) / 100, annualRate, termInput, termUnit: raw.termUnit,
      termMonths, firstPaymentDate: raw.firstPaymentDate, extraMode: raw.extraMode, extraPayments
    };
  }
  function schedule(input, includeExtras) {
    let balance = cents(input.principal);
    let regular = Math.max(1, cents(annuity(input.principal, input.annualRate, input.termMonths)));
    const initialPayment = regular / 100;
    const rows = [];
    let totalInterest = 0, totalPaid = 0;
    for (let month = 1; month <= input.termMonths && balance > 0; month++) {
      const interest = Math.round(balance * input.annualRate / 1200);
      if (regular <= interest && month < input.termMonths && balance > 100) {
        fail('term', 'При этой ставке и сроке платёж не покрывает погашение долга. Уменьшите срок или ставку.');
      }
      const payment = month === input.termMonths ? balance + interest : Math.min(regular, balance + interest);
      const principal = payment - interest;
      balance -= principal;
      let requestedExtra = 0;
      if (includeExtras) input.extraPayments.forEach(extra => {
        if (extra.month === month || (extra.frequency === 'monthly' && month >= extra.month)) requestedExtra += cents(extra.amount);
      });
      const extra = Math.min(balance, requestedExtra);
      balance -= extra;
      totalInterest += interest;
      totalPaid += payment + extra;
      rows.push({ month, date: paymentDate(input.firstPaymentDate, month - 1), payment: payment / 100,
        interest: interest / 100, principal: principal / 100, extra: extra / 100, balance: balance / 100 });
      if (extra > 0 && input.extraMode === 'payment' && balance > 0 && month < input.termMonths) {
        regular = Math.max(1, cents(annuity(balance / 100, input.annualRate, input.termMonths - month)));
      }
    }
    return { initialPayment, schedule: rows, totalInterest: totalInterest / 100, totalPaid: totalPaid / 100,
      months: rows.length, lastDate: rows[rows.length - 1].date };
  }
  function calculate(raw) {
    const input = normalize(raw);
    const result = schedule(input, true);
    const baseline = input.extraPayments.length ? schedule(input, false) : result;
    return { input, ...result, baselineInterest: baseline.totalInterest,
      interestSaved: Math.max(0, cents(baseline.totalInterest - result.totalInterest)) / 100,
      monthsSaved: baseline.months - result.months };
  }
  return Object.freeze({ number, normalize, calculate, annuity, paymentDate, validateDate });
});
