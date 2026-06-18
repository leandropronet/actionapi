'use strict';

const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#login-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Entrando…';

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.querySelector('#username').value,
        password: document.querySelector('#password').value,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Não foi possível entrar');
    window.location.assign('/painel');
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
});
