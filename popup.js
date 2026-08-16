const SERVER = 'http://127.0.0.1:8977';

const els = {
  srv: document.getElementById('srv'),
  phase: document.getElementById('phase'),
  list: document.getElementById('list'),
  log: document.getElementById('log'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  probe: document.getElementById('probe')
};

let tab = null;
let loops = [];

function logline(...a) {
  const line = new Date().toLocaleTimeString('ru-RU') + ' [popup] ' + a.map((x) => (typeof x === 'string' ? x : x && x.message ? x.message : JSON.stringify(x))).join(' ');
  els.log.textContent += line + '\n';
  els.log.scrollTop = els.log.scrollHeight;
  console.log('[LoopsLoader-popup]', line);
}

function fmtSize(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

async function findSunoTab() {
  const tabs = await chrome.tabs.query({});
  const hit = tabs.find((t) => t.url && /^https:\/\/.*suno\.com\//.test(t.url));
  logline('suno tab: ' + (hit ? hit.url : 'NOT FOUND'));
  return hit || null;
}

function setSrv(ok, text) {
  els.srv.textContent = text;
  els.srv.classList.toggle('ok', ok === true);
  els.srv.classList.toggle('bad', ok === false);
}

async function pingServer() {
  logline('ping ' + SERVER + '/api/loops ...');
  try {
    const r = await fetch(SERVER + '/api/loops', { cache: 'no-store' });
    logline('server http ' + r.status);
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    loops = (j && j.loops) || [];
    setSrv(true, 'server ' + loops.length);
    logline('loops on server: ' + loops.length + (loops.length ? ' (first: ' + loops[0].name + ')' : ''));
    return true;
  } catch (e) {
    setSrv(false, 'no server');
    logline('server DOWN: ' + (e.message || e) + ' -> run run.bat');
    return false;
  }
}

const IC = { pending: '·', uploading: '▸', ok: '✓', err: '✗', stopped: '◼' };

function render(statuses, currentIndex) {
  els.list.innerHTML = '';
  if (!loops.length) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = '<span class="nm">no loops found (server empty?)</span>';
    els.list.appendChild(d);
    return;
  }
  loops.forEach((l, i) => {
    const st = (statuses && statuses[l.name]) || 'pending';
    const d = document.createElement('div');
    d.className = 'item' + (st === 'ok' ? ' ok' : st === 'err' ? ' err' : i === currentIndex ? ' cur' : '');
    d.innerHTML = '<span class="ic">' + (IC[st] || '·') + '</span><span class="nm" title="' + l.name + '">' + l.name + '</span><span class="sz">' + fmtSize(l.size) + '</span>';
    els.list.appendChild(d);
  });
}

function renderLog(lines) {
  if (!lines || !lines.length) return;
  els.log.textContent = lines.join('\n') + '\n';
  els.log.scrollTop = els.log.scrollHeight;
}

async function refreshState() {
  if (!tab) {
    els.phase.textContent = 'open suno.com first';
    return;
  }
  try {
    const s = await chrome.tabs.sendMessage(tab.id, { type: 'get-state' });
    logline('get-state: running=' + !!s.running + ' phase=' + s.phase + ' idx=' + s.currentIndex + '/' + s.total);
    els.phase.textContent = s.phase + (s.running ? ' (' + (s.currentIndex + 1) + '/' + s.total + ')' : '');
    els.start.disabled = !!s.running;
    els.stop.disabled = !s.running;
    render(s.statuses || {}, s.currentIndex);
    renderLog(s.logs || []);
  } catch (e) {
    logline('get-state ERROR: ' + e.message + ' (content script not injected? reload suno tab)');
  }
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
  logline('Start pressed');
  tab = await findSunoTab();
  if (!tab) {
    logline('ABORT: no suno tab -> open suno.com first');
    return;
  }
  const ok = await pingServer();
  if (!ok) {
    logline('ABORT: no local server -> run run.bat first');
    return;
  }
  const names = loops.map((l) => l.name);
  if (!names.length) {
    logline('ABORT: loop list empty');
    return;
  }
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'start', loops: names });
    logline('start response: ' + JSON.stringify(r));
    if (r && r.error) logline('start error: ' + r.error);
  } catch (e) {
    logline('start sendMessage ERROR: ' + e.message + ' (reload suno tab, re-open popup)');
  }
  refreshState();
});

els.stop.addEventListener('click', () => {
  logline('Stop pressed');
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'stop' }).catch((e) => logline('stop ERROR: ' + e.message));
});

els.probe.addEventListener('click', async () => {
  logline('Probe pressed');
  tab = await findSunoTab();
  if (!tab) {
    logline('no suno tab');
    return;
  }
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'probe' });
    logline('probe result: ' + JSON.stringify(r));
  } catch (e) {
    logline('probe ERROR: ' + e.message);
  }
});

(async function init() {
  logline('popup opened');
  tab = await findSunoTab();
  if (!tab) els.phase.textContent = 'open suno.com first';
  await pingServer();
  await refreshState();
  if (tab) {
    setTimeout(async () => {
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'probe' });
        logline('auto-probe: ' + JSON.stringify(r));
      } catch (e) {
        logline('auto-probe ERROR: ' + e.message);
      }
    }, 300);
  }
})();