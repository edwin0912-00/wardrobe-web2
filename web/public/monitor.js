const events = [];
const list = document.querySelector('#event-list');
const empty = document.querySelector('#empty-log');
const sourceFilter = document.querySelector('#source-filter');
const severityFilter = document.querySelector('#severity-filter');
const search = document.querySelector('#search');

function setHealth(id, status, detail = status) {
  document.querySelector(`#${id}-status`).textContent = detail;
  const dot = document.querySelector(`#${id}-dot`);
  dot.className = `dot ${status === 'up' || status === 'ok' ? 'up' : status === 'unknown' ? 'unknown' : 'down'}`;
}

async function refreshHealth() {
  try {
    const response = await fetch('/api/monitor/status');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    setHealth('monitor', health.status, health.status === 'ok' ? `UP · ${health.uptime_seconds}s` : health.status);
    setHealth('app', health.app?.status || 'unknown', `${(health.app?.status || 'unknown').toUpperCase()} · ${health.app?.detail || 'no detail'}`);
  } catch (error) {
    setHealth('monitor', 'down', `DOWN · ${error.message}`);
  }
}

function short(value, length = 12) { return value ? String(value).slice(0, length) : '—'; }
function render() {
  const source = sourceFilter.value;
  const severity = severityFilter.value;
  const term = search.value.trim().toLowerCase();
  const filtered = events.filter((event) => {
    if (source && event.source !== source) return false;
    if (severity && event.severity !== severity) return false;
    return !term || JSON.stringify(event).toLowerCase().includes(term);
  });
  list.replaceChildren();
  for (const event of filtered.slice().reverse()) {
    const row = document.createElement('article');
    row.className = `log-row ${event.severity}`;
    const time = document.createElement('time');
    time.dateTime = event.at;
    time.textContent = new Date(event.at).toLocaleTimeString('uk-UA', { hour12: false });
    const kind = document.createElement('div');
    kind.innerHTML = `<span>${event.source}</span><strong></strong>`;
    kind.querySelector('strong').textContent = event.type;
    const identity = document.createElement('code');
    identity.textContent = event.run_id ? `run ${short(event.run_id, 16)}` : event.session_id ? `session ${short(event.session_id, 8)}` : '—';
    const details = document.createElement('pre');
    details.textContent = JSON.stringify(event.data || {});
    row.append(time, kind, identity, details);
    list.append(row);
  }
  empty.hidden = filtered.length > 0;
  document.querySelector('#event-count').textContent = filtered.length;
  document.querySelector('#last-event').textContent = events.length ? new Date(events.at(-1).at).toLocaleTimeString('uk-UA', { hour12: false }) : '—';
}

for (const control of [sourceFilter, severityFilter, search]) control.addEventListener('input', render);
document.querySelector('#clear-view').addEventListener('click', () => { events.length = 0; render(); });

const stream = new EventSource('/api/monitor/stream');
stream.addEventListener('monitor', (message) => {
  const event = JSON.parse(message.data);
  if (events.some((known) => known.id === event.id)) return;
  events.push(event);
  if (events.length > 1_000) events.splice(0, events.length - 1_000);
  render();
});
stream.onopen = () => setHealth('monitor', 'up', 'UP · live stream');
stream.onerror = () => setHealth('monitor', 'down', 'RECONNECTING…');
refreshHealth();
setInterval(refreshHealth, 10_000);
