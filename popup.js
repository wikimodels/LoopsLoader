const SERVER = 'http://127.0.0.1:8977';

const els = {
  srv: document.getElementById('srv'),
  phase: document.getElementById('phase'),
  list: document.getElementById('list'),
  log: document.getElementById('log'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop')
};

let tab = null;
let loops = [];

function fmtSize(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

async function findSunoTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => t.url && /https:\/\/.*suno\.com\//.test(t.url)) || null;
}

function setSrv(ok, text) {
  els.srv.textContent = text;
  els.srv.classList.toggle('ok', ok === true);
  els.srv.classList.toggle('bad', ok === false);
}

async function pingServer() {
  try {
    const r = await fetch(SERVER + '/api/loops', { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    loops = j.loops || [];
    setSrv(true, 'server ' + loops.length);
    return true;
  } catch (e) {
    setSrv(false, 'no server');
    return false;
  }
}

const IC = { pending: '·', uploading: '▸', ok: '✓', err: '✗', stopped: '◼' };

function render(statuses, currentIndex) {
  els.list.innerHTML = '';
  if (!loops.length) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = '<span class="nm">no loops found</span>';
    els.list.appendChild(d);
    return;
  }
  loops.forEach((l, i) => {
    const st = statuses[l.name] || 'pending';
    const d = document.createElement('div');
    d.className = 'item' + (st === 'ok' ? ' ok' : st === 'err' ? ' err' : i === currentIndex ? ' cur' : '');
    d.innerHTML = '<span class="ic">' + (IC[st] || '·') + '</span><span class="nm" title="' + l.name + '">' + l.name + '</span><span class="sz">' + fmtSize(l.size) + '</span>';
    els.list.appendChild(d);
  });
}

function renderLog(lines) {
  els.log.textContent = lines.join('\n');
  els.log.scrollTop = els.log.scrollHeight;
}

async function refreshState() {
  if (!tab) return;
  try {
    const s = await chrome.tabs.sendMessage(tab.id, { type: 'get-state' });
    els.phase.textContent = s.phase + (s.running ? ' (' + (s.currentIndex + 1) + '/' + s.total + ')' : '');
    els.start.disabled = !!s.running;
    els.stop.disabled = !s.running;
    render(s.statuses || {}, s.currentIndex);
    renderLog(s.logs || []);
  } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'progress') return;
  els.phase.textContent = msg.phase + (msg.running ? ' (' + (msg.currentIndex + 1) + '/' + msg.total + ')' : '');
  els.start.disabled = !!msg.running;
  els.stop.disabled = !msg.running;
  render(msg.statuses || {}, msg.currentIndex);
  renderLog(msg.logs || []);
});

els.start.addEventListener('click', async () => {
  tab = await findSunoTab();
  if (!tab) {
    els.log.textContent += '\nSuno tab not found, open suno.com first';
    return;
  }
  const ok = await pingServer();
  if (!ok) {
    els.log.textContent += '\nStart server.js first (run.bat)';
    return;
  }
  const names = loops.map((l) => l.name);
  if (!names.length) return;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'start', loops: names });
    if (r && r.error) els.log.textContent += '\nstart error: ' + r.error;
  } catch (e) {
    els.log.textContent += '\ncontent script error: ' + e.message;
  }
  refreshState();
});

els.stop.addEventListener('click', () => {
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'stop' }).catch(() => {});
});

(async function init() {
  tab = await findSunoTab();
  if (!tab) els.phase.textContent = 'open suno.com first';
  await pingServer();
  await refreshState();
})();
