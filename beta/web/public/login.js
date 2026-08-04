const form = document.querySelector('#pin-form');
const input = document.querySelector('#pin');
const message = document.querySelector('#message');
const button = form.querySelector('button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  message.textContent = '';
  try {
    const response = await fetch('/api/auth/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: input.value }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(response.status === 429 ? 'Забагато спроб. Спробуйте пізніше.' : (result.error === 'Incorrect PIN' ? 'Неправильний PIN-код.' : 'Не вдалося увійти.'));
    }
    const next = new URLSearchParams(location.search).get('next') ?? '/';
    location.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  } catch (error) {
    message.textContent = error.message;
    input.select();
  } finally {
    button.disabled = false;
  }
});
