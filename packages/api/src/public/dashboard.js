'use strict';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const quantity = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
let lastJson = '';
let lastUrl = '';

async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Sessão expirada');
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Erro HTTP ${response.status}`);
  return payload;
}

async function loadSession() {
  const session = await apiFetch('/auth/me');
  document.querySelector('#session-user').textContent = session.username;
}

async function checkHealth() {
  const status = document.querySelector('#api-status');
  try {
    const response = await fetch('/health');
    if (!response.ok) throw new Error();
    status.textContent = 'API online';
    status.classList.add('online');
  } catch {
    status.textContent = 'API indisponível';
    status.classList.add('offline');
  }
}

function renderBilling(payload) {
  document.querySelector('#metric-value').textContent = money.format(payload.valor_liquido || 0);
  document.querySelector('#metric-quantity').textContent = quantity.format(payload.quantidade_liquida || 0);
  document.querySelector('#metric-branches').textContent = String(payload.por_filial?.length || 0);

  const tbody = document.querySelector('#billing-table');
  tbody.replaceChildren();
  for (const row of payload.por_filial || []) {
    const tr = document.createElement('tr');
    for (const value of [
      row.filial_id,
      quantity.format(Number(row.quantidade_liquida || 0)),
      money.format(Number(row.valor_liquido || 0)),
    ]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  if (!tbody.children.length) {
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = 'Nenhum resultado.';
    const tr = document.createElement('tr');
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

document.querySelector('#billing-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector('#billing-error');
  errorBox.hidden = true;
  const params = new URLSearchParams({
    paramId: document.querySelector('#billing-param').value,
    dataInicio: document.querySelector('#billing-start').value,
    dataFim: document.querySelector('#billing-end').value,
  });
  const branch = document.querySelector('#billing-branch').value.trim();
  if (branch) params.set('filialId', branch);

  try {
    renderBilling(await apiFetch(`/api/v1/faturamento/resumo?${params}`));
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

document.querySelector('#explorer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const base = document.querySelector('#endpoint').value;
  const extra = document.querySelector('#extra-query').value.trim().replace(/^\?/, '');
  const url = extra ? `${base}${base.includes('?') ? '&' : '?'}${extra}` : base;
  lastUrl = url;
  document.querySelector('#request-url').textContent = url;
  const view = document.querySelector('#json-result');
  view.textContent = 'Consultando…';

  try {
    const payload = await apiFetch(url);
    lastJson = JSON.stringify(payload, null, 2);
    view.textContent = lastJson;
  } catch (error) {
    lastJson = '';
    view.textContent = error.message;
  }
});

document.querySelector('#copy-result').addEventListener('click', async () => {
  if (!lastJson) return;
  await navigator.clipboard.writeText(lastJson);
  const button = document.querySelector('#copy-result');
  button.textContent = 'Copiado';
  setTimeout(() => { button.textContent = 'Copiar JSON'; }, 1200);
});

document.querySelector('#download-csv').addEventListener('click', () => {
  if (!lastUrl) return;
  const separator = lastUrl.includes('?') ? '&' : '?';
  window.location.assign(`${lastUrl}${separator}format=csv`);
});

document.querySelector('#logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.assign('/login');
});

Promise.all([loadSession(), checkHealth()])
  .then(() => document.querySelector('#billing-form').requestSubmit())
  .catch(() => {});
