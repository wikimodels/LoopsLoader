const SERVER = 'http://127.0.0.1:8977';

function showError(msg) {
  const b = document.getElementById('errbanner');
  if (b) {
    b.style.display = 'block';
    b.textContent += (b.textContent ? '\n' : '') + new Date().toLocaleTimeString('ru-RU') + ' ' + msg;
  }
  try {
    console.error('[LoopsLoader-popup]', msg);
  } catch (e) {}
}

window.addEventListener('error', (e) => showError('error: ' + e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => showError('promise: ' + (e.reason && (e.reason.message || e.reason) || String(e.reason))));

const els = {
  srv: document.getElementById('srv'),
  phase: document.getElementById('phase'),
  list: document.getElementById('list'),
  log: document.getElementById('log'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  probe: document.getElementById('probe'),
  modes: document.getElementById('modes')
};

let tab = null;
let loops = [];
let mode = 'loops';

function setMode(m) {
  mode = m;
  for (const b of els.modes.querySelectorAll('.mode')) {
    b.classList.toggle('active', b.dataset.mode === m);
  }
  els.start.textContent = m === 'cover' ? 'Start covers' : 'Start';
}

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

function nativeStartServer() {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative('com.loopsloader.host');
      let done = false;
      const finish = (ok, txt) => {
        if (done) return;
        done = true;
        logline(txt);
        resolve(ok);
      };
      port.onMessage.addListener((m) => finish(!!(m && m.ok), 'native host says: ' + JSON.stringify(m)));
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        if (!done) logline('native host disconnected: ' + (err ? err.message : 'after response'));
        resolve(done);
      });
      port.postMessage({ type: 'start' });
      setTimeout(() => finish(false, 'native host timeout'), 5000);
    } catch (e) {
      logline('connectNative ERROR: ' + e.message);
      resolve(false);
    }
  });
}

async function ensureServer() {
  if ((await pingServer()) && !pingServerResult.error) {
    return true;
  }
  logline('server DOWN -> starting via native host');
  await nativeStartServer();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await pingServer();
    if (r.ok) {
      logline('server is UP (' + r.n + ' loops)');
      return true;
    }
  }
  logline('server still DOWN after native start -> run run.bat manually');
  return false;
}

async function pingServer(quiet) {
  if (!quiet) logline('ping ' + SERVER + '/api/loops ...');
  try {
    const r = await fetch(SERVER + '/api/loops', { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    loops = (j && j.loops) || [];
    setSrv(true, 'server ' + loops.length);
    if (!quiet) logline('loops on server: ' + loops.length + (loops.length ? ' (first: ' + loops[0].name + ')' : ''));
    return { ok: true, n: loops.length };
  } catch (e) {
    setSrv(false, 'no server');
    if (!quiet) logline('server DOWN: ' + (e.message || e) + ' -> will try to start it');
    return { ok: false, n: 0 };
  }
}

function nativeStartServer() {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative('com.loopsloader.host');
      let done = false;
      const finish = (ok, txt) => {
        if (done) return;
        done = true;
        logline(txt);
        resolve(ok);
      };
      port.onMessage.addListener((m) => finish(!!(m && m.ok), 'native host says: ' + JSON.stringify(m)));
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        if (!done) logline('native host disconnected: ' + (err ? err.message : 'after response'));
        resolve(done);
      });
      port.postMessage({ type: 'start' });
      setTimeout(() => finish(false, 'native host timeout'), 5000);
    } catch (e) {
      logline('connectNative ERROR: ' + e.message);
      resolve(false);
    }
  });
}

async function ensureServer() {
  const r0 = await pingServer();
  if (r0.ok) return true;
  logline('server DOWN -> starting via native host');
  await nativeStartServer();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await pingServer(true);
    if (r.ok) {
      logline('server is UP (' + r.n + ' loops)');
      return true;
    }
  }
  logline('server still DOWN after native start -> run run.bat manually');
  return false;
}

const IC = { pending: '·', uploading: '▸', ok: '✓', err: '✗', stopped: '◼' };

function render(statuses, currentIndex) {
  els.list.innerHTML = '';
  if (!loops.length) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = '<span class="nm">' + (mode === 'cover' ? 'no clips found (open library?)' : 'no loops found (server empty?)') + '</span>';
    els.list.appendChild(d);
    return;
  }
  loops.forEach((l, i) => {
    const st = (statuses && statuses[l.name]) || 'pending';
    const d = document.createElement('div');
    d.className = 'item' + (st === 'ok' ? ' ok' : st === 'err' ? ' err' : i === currentIndex ? ' cur' : '');
    d.innerHTML = '<span class="ic">' + (IC[st] || '·') + '</span><span class="nm" title="' + l.name + '">' + l.name + '</span><span class="sz">' + (l.size != null ? fmtSize(l.size) : '') + '</span>';
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

els.modes.addEventListener('click', async (e) => {
  const b = e.target.closest('.mode');
  if (!b || b.dataset.mode === mode) return;
  setMode(b.dataset.mode);
  logline('mode -> ' + mode);
  if (mode === 'cover') {
    tab = await findSunoTab();
    if (!tab) {
      logline('no suno tab -> open suno.com first');
      loops = [];
      render({}, -1);
      return;
    }
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'probe' });
      const clips = (r && r.probe && r.probe.clips) || [];
      loops = clips.map((n) => ({ name: n, size: null }));
      logline('clips on page: ' + clips.length + (clips.length ? ' (first: ' + clips[0] + ')' : ''));
      if (!clips.length) logline('no clips -> make sure library list is open (with rows)');
      render({}, -1);
    } catch (e) {
      logline('cover probe ERROR: ' + e.message + ' (reload suno tab, re-open popup)');
    }
    return;
  }
  await ensureServer();
  render({}, -1);
});

els.start.addEventListener('click', async () => {
  logline('Start pressed (' + mode + ')');
  tab = await findSunoTab();
  if (!tab) {
    logline('ABORT: no suno tab -> open suno.com first');
    return;
  }
  if (mode === 'cover') {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'start-cover' });
      logline('cover start response: ' + JSON.stringify(r));
      if (r && r.error) logline('cover start error: ' + r.error);
    } catch (e) {
      logline('cover start sendMessage ERROR: ' + e.message + ' (reload suno tab, re-open popup)');
    }
    refreshState();
    return;
  }
  const ok = await ensureServer();
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

els.srv.addEventListener('click', async () => {
  logline('server chip clicked -> (re)start');
  await ensureServer();
  render({}, -1);
});

els.srv.classList.add('clickable');

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

(function () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run().catch((e) => showError('init failed: ' + (e && e.message ? e.message : String(e)))));
  } else {
    run().catch((e) => showError('init failed: ' + (e && e.message ? e.message : String(e))));
  }
})();

async function run() {
  logline('popup opened (DOM loaded)');
  tab = await findSunoTab();
  if (!tab) els.phase.textContent = 'open suno.com first';
  await ensureServer();
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
}