/* Интерфейс калькулятора. Пересчёт и аналитическое событие — только при submit. */
(() => {
  'use strict';
  const core = window.MortgageCore;
  const form = document.querySelector('#mortgage-form');
  const $ = selector => document.querySelector(selector);
  const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const dates = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' });
  const rub = number => money.format(number) + ' ₽';
  let downUnit = 'percent', termUnit = 'years', result = null;
  const today = new Date();
  const localToday = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  $('#mortgage-first-date').defaultValue = core.paymentDate(localToday, 1);
  $('#mortgage-privacy').hidden = !window.MortgageAnalytics.isEnabled();

  function input() {
    return {
      price: form.elements.price.value, downPaymentInput: form.elements.downPayment.value,
      downPaymentUnit: downUnit, annualRate: form.elements.annualRate.value,
      termInput: form.elements.term.value, termUnit, firstPaymentDate: form.elements.firstPaymentDate.value,
      extraMode: form.elements.extraMode.value,
      extraPayments: [...document.querySelectorAll('.extra-row')].map(row => ({
        amount: row.querySelector('[data-extra=amount]').value,
        month: row.querySelector('[data-extra=month]').value,
        frequency: row.querySelector('[data-extra=frequency]').value
      }))
    };
  }
  function clearError() {
    $('#mortgage-error').hidden = true;
    form.querySelectorAll('[aria-invalid=true]').forEach(field => field.removeAttribute('aria-invalid'));
  }
  function showError(error) {
    $('#mortgage-error').textContent = error.message;
    $('#mortgage-error').hidden = false;
    const field = [...form.querySelectorAll('[data-field]')].find(item => item.dataset.field === error.field);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      const details = field.closest('details');
      if (details) details.open = true;
      field.focus();
    }
  }
  function equivalent() {
    try {
      const price = core.number(form.elements.price.value, 'price');
      const value = core.number(form.elements.downPayment.value, 'downPayment');
      $('#down-equivalent').textContent = downUnit === 'percent' ? rub(price * value / 100) : compact.format(price ? value / price * 100 : 0) + '% от стоимости';
      const range = $('#price-range');
      range.min = String(Math.min(100000, Math.max(1000, price)));
      range.max = String(Math.max(30000000, Math.min(1e9, price)));
      range.value = String(price);
    } catch { $('#down-equivalent').textContent = 'Введите стоимость и взнос'; }
    $('#term-range').max = termUnit === 'years' ? '30' : '360';
    try { $('#term-range').value = String(core.number(form.elements.term.value, 'term')); } catch { /* Неполный ввод. */ }
  }
  function markChanged() {
    clearError(); equivalent();
    if (!result) return;
    $('#mortgage-result').dataset.stale = 'true';
    $('#result-status').textContent = 'Обновите расчёт';
    $('#result-note').textContent = 'Параметры изменены. Нажмите «Рассчитать», чтобы обновить результат.';
    $('#mortgage-schedule').hidden = true;
  }
  function setSwitch(attribute, value) {
    document.querySelectorAll('[' + attribute + ']').forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === value)));
  }
  document.querySelectorAll('[data-down-unit]').forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.downUnit;
    if (next === downUnit) return;
    try {
      const price = core.number(form.elements.price.value, 'price');
      const value = core.number(form.elements.downPayment.value, 'downPayment');
      if (price <= 0) throw Object.assign(new Error('Сначала укажите стоимость недвижимости.'), { field: 'price' });
      form.elements.downPayment.value = compact.format(next === 'rub' ? price * value / 100 : value / price * 100);
      downUnit = next; setSwitch('data-down-unit', downUnit); markChanged();
    } catch (error) { showError(error); }
  }));
  document.querySelectorAll('[data-term-unit]').forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.termUnit;
    if (next === termUnit) return;
    try {
      const value = core.number(form.elements.term.value, 'term');
      if (next === 'years' && value % 12 !== 0) {
        showError(Object.assign(new Error('Этот срок содержит неполный год. Оставьте месяцы или укажите число, кратное 12.'), { field: 'term' }));
        return;
      }
      form.elements.term.value = String(next === 'months' ? value * 12 : value / 12);
      termUnit = next; setSwitch('data-term-unit', termUnit); markChanged();
    } catch (error) { showError(error); }
  }));
  $('#price-range').addEventListener('input', event => { form.elements.price.value = compact.format(Number(event.target.value)); });
  $('#term-range').addEventListener('input', event => { form.elements.term.value = event.target.value; });
  form.addEventListener('input', markChanged);
  form.addEventListener('change', markChanged);
  ['price', 'downPayment'].forEach(name => form.elements[name].addEventListener('blur', event => {
    try { event.target.value = compact.format(core.number(event.target.value, name)); } catch { /* Сохраняем ввод для исправления. */ }
  }));

  function indexExtras() {
    const rows = [...document.querySelectorAll('.extra-row')];
    rows.forEach((row, index) => {
      row.querySelectorAll('[data-extra]').forEach(field => {
        field.id = 'extra-' + index + '-' + field.dataset.extra;
        field.dataset.field = 'extra.' + index + '.' + field.dataset.extra;
        field.previousElementSibling.htmlFor = field.id;
      });
      row.querySelector('button').setAttribute('aria-label', 'Удалить досрочный платёж ' + (index + 1));
    });
    $('#extra-mode-wrap').hidden = rows.length === 0;
    $('#add-extra').disabled = rows.length >= 12;
  }
  $('#add-extra').addEventListener('click', () => {
    if (document.querySelectorAll('.extra-row').length >= 12) return;
    const row = document.createElement('div'); row.className = 'extra-row';
    row.innerHTML = '<div><label>Сумма, ₽</label><input type="text" inputmode="decimal" value="100 000" data-extra="amount" autocomplete="off"></div><div><label>С месяца</label><input type="text" inputmode="numeric" value="1" data-extra="month" autocomplete="off"></div><div><label>Как часто</label><select data-extra="frequency"><option value="once">Один раз</option><option value="monthly">Ежемесячно</option></select></div><button class="extra-remove" type="button" data-remove-extra aria-label="Удалить досрочный платёж">×</button>';
    $('#extra-payments').append(row); indexExtras(); markChanged();
    row.querySelector('input').focus();
  });
  $('#extra-payments').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-extra]');
    if (!button) return;
    button.closest('.extra-row').remove(); indexExtras(); markChanged(); $('#add-extra').focus();
  });

  function render(data) {
    $('#mortgage-result').dataset.stale = 'false';
    $('#result-status').textContent = 'Рассчитано';
    $('#result-title').textContent = data.input.extraPayments.length && data.input.extraMode === 'payment' ? 'Начальный платёж в месяц' : 'Платёж в месяц';
    $('#result-payment').replaceChildren(document.createTextNode(money.format(data.initialPayment) + ' '));
    const currency = document.createElement('span'); currency.textContent = '₽'; $('#result-payment').append(currency);
    $('#result-note').textContent = data.input.extraPayments.length ? 'Без дополнительного взноса. Изменения платежей — в графике ниже.' : 'Равные платежи. Последний может отличаться из-за округления.';
    $('#result-principal').textContent = rub(data.input.principal);
    $('#result-interest').textContent = rub(data.totalInterest);
    $('#result-total').textContent = rub(data.totalPaid);
    $('#result-date').textContent = dates.format(new Date(data.lastDate + 'T12:00:00Z'));
    $('#cost-breakdown').hidden = false;
    $('#cost-principal').style.width = (data.input.principal / data.totalPaid * 100).toFixed(4) + '%';
    $('#result-savings').hidden = data.input.extraPayments.length === 0;
    $('#result-saved').textContent = rub(data.interestSaved);
    $('#result-time-saved').textContent = data.monthsSaved > 0 ? 'Срок короче на ' + data.monthsSaved + ' мес.' : 'Погашение за ' + data.months + ' мес.';
    $('#mortgage-schedule').hidden = false;
    $('#schedule-count').textContent = data.months + ' мес.';
    const fragment = document.createDocumentFragment();
    data.schedule.forEach(row => {
      const tr = document.createElement('tr');
      [dates.format(new Date(row.date + 'T12:00:00Z')), ...['payment', 'interest', 'principal', 'extra', 'balance'].map(key => money.format(row[key]))].forEach(value => {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }); fragment.append(tr);
    });
    $('#schedule-body').replaceChildren(fragment);
    $('#mortgage-announcement').textContent = 'Расчёт готов. Начальный платёж ' + rub(data.initialPayment) + '. Переплата ' + rub(data.totalInterest) + '.';
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); clearError();
    try {
      result = core.calculate(input()); render(result);
    } catch (error) { showError(error); return; }
    // Сбор аналитики не влияет на успешность финансового расчёта.
    window.MortgageAnalytics.track(result);
  });
  form.addEventListener('reset', () => {
    // Native reset restores fields after the event; run afterwards, not in a microtask.
    setTimeout(() => {
      downUnit = 'percent'; termUnit = 'years'; result = null;
      setSwitch('data-down-unit', downUnit); setSwitch('data-term-unit', termUnit);
      $('#extra-payments').replaceChildren(); indexExtras(); clearError(); equivalent();
      $('#mortgage-options').open = false;
      $('#mortgage-result').dataset.stale = 'false';
      $('#result-status').textContent = 'До расчёта'; $('#result-title').textContent = 'Платёж в месяц';
      $('#result-payment').textContent = '— ₽'; $('#result-note').textContent = 'Укажите условия и нажмите «Рассчитать».';
      ['principal', 'interest', 'total', 'date'].forEach(key => { $('#result-' + key).textContent = '—'; });
      ['cost-breakdown', 'result-savings', 'mortgage-schedule'].forEach(id => { $('#' + id).hidden = true; });
      $('#mortgage-schedule').open = false; $('#schedule-body').replaceChildren();
      $('#mortgage-announcement').textContent = 'Параметры сброшены.';
    }, 0);
  });
  $('#schedule-download').addEventListener('click', () => {
    if (!result || $('#mortgage-result').dataset.stale === 'true') return;
    const rows = [['Дата', 'Плановый платёж, ₽', 'Проценты, ₽', 'Основной долг, ₽', 'Досрочно, ₽', 'Остаток, ₽'], ...result.schedule.map(row => [row.date, ...['payment', 'interest', 'principal', 'extra', 'balance'].map(key => row[key].toFixed(2).replace('.', ','))])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ipoteka-' + localToday + '.csv';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  equivalent();
})();
