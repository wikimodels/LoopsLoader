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
  promptLine: document.getElementById('promptLine'),
  list: document.getElementById('list'),
  log: document.getElementById('log'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  srvstart: document.getElementById('srvstart'),
  extractPrompt: document.getElementById('extractPrompt'),
  viewPrompt: document.getElementById('viewPrompt'),
  modes: document.getElementById('modes'),
  modal: document.getElementById('promptModal'),
  closeBtn: document.getElementById('closeBtn')
};

let tab = null;
let loops = [];
let mode = 'loops';
let coverPrompt = null; // {styles, lyrics, negativePrompt}

// ─── Cover prompt (extract from page fields) ────────────────────────────────

async function loadCoverPrompt() {
  try {
    const d = await chrome.storage.session.get('coverPrompt');
    coverPrompt = d.coverPrompt || null;
  } catch (_) {
    coverPrompt = null;
  }
}

/* Проверка формата промпта:
   styles — непустая строка (обязательно),
   lyrics — непустая строка,
   negativePrompt — строка (может быть пустой). */
function validatePrompt(p) {
  const issues = [];
  if (!p) return { ok: false, issues: ['prompt is not extracted'] };
  if (typeof p.styles !== 'string' || !p.styles.trim()) issues.push('styles is empty');
  else if (typeof p.lyrics !== 'string' || !p.lyrics.trim()) issues.push('lyrics is empty');
  else if (typeof p.negativePrompt !== 'string') issues.push('negativePrompt is missing');
  return { ok: issues.length === 0, issues };
}

function renderPromptLine() {
  if (mode !== 'cover') {
    els.promptLine.classList.add('hidden');
    els.viewPrompt.classList.add('hidden');
    return;
  }
  els.promptLine.classList.remove('hidden');
  els.viewPrompt.classList.toggle('hidden', !coverPrompt);
  if (!coverPrompt) {
    els.promptLine.textContent = '✗ prompt not extracted — press ✂ Get Prompt';
    els.promptLine.className = 'prompt-line bad';
    els.promptLine.title = '';
    return;
  }
  const v = validatePrompt(coverPrompt);
  const s = (coverPrompt.styles || '').length;
  const l = (coverPrompt.lyrics || '').length;
  const n = (coverPrompt.negativePrompt || '').length;
  if (v.ok) {
    els.promptLine.textContent = '✓ prompt valid · styles ' + s + ' ch · lyrics ' + l + ' ch' + (n ? ' · neg ' + n + ' ch' : '');
    els.promptLine.className = 'prompt-line ok viewable';
    els.promptLine.title = 'Click to view the prompt';
  } else {
    els.promptLine.textContent = '✗ prompt invalid — ' + v.issues.join('; ');
    els.promptLine.className = 'prompt-line bad viewable';
    els.promptLine.title = 'Click to view details';
  }
}

/* ── Prompt viewer modal ─────────────────────────────────── */

function openPromptModal() {
  if (!coverPrompt) return;
  const v = validatePrompt(coverPrompt);

  const badge = document.getElementById('pmBadge');
  badge.textContent = v.ok ? '✓ VALID' : '✗ INVALID';
  badge.className = 'pm-badge ' + (v.ok ? 'ok' : 'bad');

  const doc = JSON.stringify(coverPrompt, null, 2)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const body = document.getElementById('pmBody');
  body.innerHTML =
    (v.ok ? '' : '<div class="pm-issues">Format problems:\n• ' + v.issues.join('\n• ') + '</div>')
    + '<pre class="pm-pre modal-doc">' + doc + '</pre>';

  els.modal.classList.remove('hidden');
}

function closePromptModal() {
  els.modal.classList.add('hidden');
}

function setMode(m) {
  mode = m;
  for (const b of els.modes.querySelectorAll('.mode')) {
    b.classList.toggle('active', b.dataset.mode === m);
  }
  els.start.textContent = m === 'cover' ? 'Start Covers' : 'Start Process';
  // Каверы работают чисто со страницей — сервер не нужен
  els.srvstart.classList.toggle('hidden', m === 'cover');
  els.extractPrompt.classList.toggle('hidden', m !== 'cover');
  renderPromptLine();
}

/* ── Stale prompt: Suno чистит свои поля при перезагрузке ─────────────────── */

/* Сверка сохранённого промпта с живыми полями страницы.
   Если поля пустые — промпт протух: стираем и обновляем статус. */
async function verifyPromptAgainstPage(reason) {
  if (!coverPrompt) return;
  const t = await findSunoTab();
  if (!t) return;
  try {
    const r = await chrome.tabs.sendMessage(t.id, { type: 'extract-prompt' });
    const p = (r && r.prompt) || {};
    if (!p.styles && !p.lyrics) {
      logline((reason || 'verify') + ': page fields EMPTY — stored prompt STALE, cleared ✓');
      coverPrompt = null;
      await chrome.storage.session.remove('coverPrompt').catch(() => {});
      renderPromptLine();
    }
  } catch (_) { /* content script ещё не внедрён — пропускаем */ }
}

/* Перезагрузка вкладки Suno, пока попап открыт → мгновенно чистим промпт */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, ti) => {
  const u = changeInfo.url || ti.url || '';
  if (!/^https:\/\/.*suno\.com\//.test(u)) return;
  if (changeInfo.status !== 'loading' && !changeInfo.url) return;
  if (!coverPrompt) return;
  logline('suno page RELOADED — clearing stale prompt');
  coverPrompt = null;
  try { await chrome.storage.session.remove('coverPrompt'); } catch (_) {}
  renderPromptLine();
});

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

function nmCall(msg) {
  // Одноразовый вызов native host прямо из попапа.
  return new Promise((resolve) => {
    try {
      if (typeof chrome.runtime.sendNativeMessage !== 'function') {
        resolve({ unavailable: true });
        return;
      }
      chrome.runtime.sendNativeMessage('com.loopsloader.host', msg, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(resp || {});
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

async function cleanupStrays() {
  const r = await nmCall({ type: 'cleanup' });
  if (r.unavailable) {
    logline('cleanup skipped: native messaging unavailable in popup');
    return false;
  }
  if (!r.ok) {
    logline('cleanup error: ' + (r.error || JSON.stringify(r)));
    return false;
  }
  const killed = r.killed || [];
  logline(killed.length ? 'cleanup: killed stray process(es) pid=' + killed.join(',') : 'cleanup: no stray processes');
  await new Promise((res) => setTimeout(res, 400));
  return true;
}

async function nativeStartServer() {
  const r = await nmCall({ type: 'start' });
  if (r.unavailable) {
    logline('sendNativeMessage unavailable -> fallback via background');
    try {
      chrome.runtime.sendMessage({ type: 'start-server' }, () => {
        const err = chrome.runtime.lastError;
        if (err) logline('bg message note: ' + err.message);
      });
    } catch (e) {
      logline('bg sendMessage ERROR: ' + e.message);
    }
    return true; // продолжаем опрос — фон запускает асинхронно
  }
  if (!r.ok) {
    logline('native (direct) error: ' + (r.error || JSON.stringify(r)));
    return false;
  }
  logline('native host says: ' + JSON.stringify(r));
  return true;
}

async function readStartDiag() {
  try {
    const d = await chrome.storage.session.get('serverStartDiag');
    return d.serverStartDiag || null;
  } catch (_) {
    return null;
  }
}

async function ensureServer() {
  const r0 = await pingServer();
  if (r0.ok) return true;
  logline('server DOWN -> cleanup + start via native host');
  await cleanupStrays();
  await nativeStartServer();
  let diagShown = false;
  for (let i = 0; i < 14; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await pingServer(true);
    if (r.ok) {
      logline('server is UP (' + r.n + ' loops)');
      return true;
    }
    const diag = await readStartDiag();
    if (diag && !diag.ok && !diagShown) {
      diagShown = true;
      logline('native host error: ' + (diag.error || JSON.stringify(diag.reply || {})));
    }
  }
  if (!diagShown) {
    const diag = await readStartDiag();
    logline('diag: ' + JSON.stringify(diag));
    if (diag && !diag.ok) {
      logline('native host error: ' + (diag.error || JSON.stringify(diag.reply || {})));
      diagShown = true;
    }
  }
  if (!diagShown) {
    logline('background SW did not report (old worker cached? reload extension fully)');
  }
  logline('server still DOWN after native start -> run run.bat or install_autostart.bat');
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
    await verifyPromptAgainstPage('mode cover'); // свежесть промпта после F5
    return;
  }
  await ensureServer();
  render({}, -1);
});

els.extractPrompt.addEventListener('click', async () => {
  logline('Get Prompt pressed');
  const t = await findSunoTab();
  if (!t) {
    logline('no suno tab -> open suno.com first');
    return;
  }
  try {
    const r = await chrome.tabs.sendMessage(t.id, { type: 'extract-prompt' });
    if (!r || !r.ok) {
      logline('extract ERROR: ' + (r && r.error ? r.error : 'no response'));
      return;
    }
    const p = r.prompt || {};
    if (!p.styles && !p.lyrics) {
      // Поля Suno пустые (напр. после перезагрузки страницы) —
      // сохранённый промпт протух: стираем и обновляем статус.
      logline('extract: page fields EMPTY — stale prompt cleared ✓');
      coverPrompt = null;
      await chrome.storage.session.remove('coverPrompt').catch(() => {});
      renderPromptLine();
      return;
    }
    delete p.songTitle; // title всегда = имя ковера
    coverPrompt = p;
    await chrome.storage.session.set({ coverPrompt: p }).catch(() => {});
    const v = validatePrompt(p);
    logline('prompt extracted ' + (v.ok ? '✓ VALID' : '✗ INVALID (' + v.issues.join('; ') + ')')
      + ' styles=' + (p.styles || '').length + ' lyrics=' + (p.lyrics || '').length);
    renderPromptLine();
    openPromptModal(); // наглядное подтверждение: что извлекли и валидно ли
  } catch (e) {
    logline('extract sendMessage ERROR: ' + e.message + ' (reload suno tab)');
  }
});

/* ── Prompt viewer ── */
els.viewPrompt.addEventListener('click', openPromptModal);
els.promptLine.addEventListener('click', () => { if (coverPrompt) openPromptModal(); });
document.getElementById('pmClose').addEventListener('click', closePromptModal);
document.getElementById('pmOk').addEventListener('click', closePromptModal);
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closePromptModal(); });
document.getElementById('pmCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(coverPrompt, null, 2));
    logline('prompt JSON copied ✓');
  } catch (e) {
    logline('copy failed: ' + e.message);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) closePromptModal();
});

els.closeBtn.addEventListener('click', () => window.close());

els.start.addEventListener('click', async () => {
  logline('Start pressed (' + mode + ')');
  tab = await findSunoTab();
  if (!tab) {
    logline('ABORT: no suno tab -> open suno.com first');
    return;
  }
  if (mode === 'cover') {
    const p = coverPrompt || {};
    if (!p.styles && !p.lyrics) {
      logline('ABORT: no prompt — make sure prompt is placed in Suno! Press ✂ Get Prompt');
      return;
    }
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'start-cover', prompt: p });
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

els.srvstart.addEventListener('click', async () => {
  logline('=== Start Server pressed ===');
  els.srvstart.disabled = true;
  els.srvstart.textContent = '… Starting';
  const ok = await ensureServer();
  if (ok) {
    render({}, -1);
    logline('✅ server ready (' + loops.length + ' loops)');
  } else {
    logline('❌ could not start server — see errors above');
  }
  els.srvstart.disabled = false;
  els.srvstart.textContent = '▶ Start Server';
});

els.srv.classList.add('clickable');

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
  await loadCoverPrompt();
  renderPromptLine();
  await verifyPromptAgainstPage('popup open'); // поля могли очиститься при F5
  // Проверка живости фонового воркера
  try {
    chrome.runtime.sendMessage({ type: 'get-start-diag' }, (r) => {
      const e = chrome.runtime.lastError;
      logline(e ? 'bg check FAIL: ' + e.message : 'bg alive, lastDiag=' + JSON.stringify(r));
    });
  } catch (_) {}
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