/* Аналитика подключена к закрытой Google Таблице; подробности в analytics/README.txt.
   enabled=false отключает сохранение и отправку новых событий. */
window.MORTGAGE_CONFIG = Object.freeze({
  analytics: {
    enabled: true,
    endpoint: 'https://script.google.com/macros/s/AKfycbwDuXgd9_rMovO02X6otJj35QWJhU-WaytbdGvmcRHkjMWwp-Of4Y6oEWqfvL66_pBM3g/exec',
    siteId: 'kashapova-real-estate',
    queueLimit: 100,
    retentionDays: 30
  }
});
