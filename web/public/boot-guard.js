(() => {
  const send = (type, data) => {
    try {
      const key = 'zeely_monitor_session';
      let sessionId = sessionStorage.getItem(key);
      if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem(key, sessionId); }
      fetch('/api/telemetry', {
        method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ type, session_id: sessionId, data }),
      }).catch(() => {});
    } catch {}
  };

  const reveal = (message) => {
    document.documentElement.classList.remove('workflow-pending');
    const guard = document.querySelector('#boot-error');
    if (!guard) return;
    guard.querySelector('[data-error-message]').textContent = message;
    guard.hidden = false;
  };

  window.addEventListener('error', (event) => {
    send('client.error', { message: String(event.message || 'Browser error').slice(0, 500), stage: 'window' });
    reveal('Інтерфейс зупинився через помилку. Файли в локальній чернетці не видалялись.');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message || String(event.reason || 'Unhandled rejection');
    send('client.unhandled_rejection', { message: message.slice(0, 500), stage: 'promise' });
    reveal('Сталася помилка процесу. Можна перезавантажити сторінку — локальна чернетка відновиться.');
  });
  window.setTimeout(() => {
    if (document.body?.dataset.appReady !== 'true') {
      send('client.error', { message: 'App boot timeout', stage: 'boot' });
      reveal('Застосунок не запустився за 8 секунд. Перезавантаж сторінку.');
    }
  }, 8000);
  window.ZeelyBootGuard = {
    ready() {
      document.documentElement.classList.remove('workflow-pending');
      document.body.dataset.appReady = 'true';
      document.querySelector('#boot-error')?.setAttribute('hidden', '');
      const preloader = document.querySelector('#app-preloader');
      if (preloader) {
        const bar = preloader.querySelector('#preloader-bar');
        const status = preloader.querySelector('#preloader-status');
        if (bar) bar.style.width = '100%';
        if (status) status.textContent = 'Готово!';
        window.setTimeout(() => {
          preloader.classList.add('is-hidden');
        }, 300);
      }
    }
  };
})();
