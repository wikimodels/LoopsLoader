(function () {
  const SERVER = 'http://127.0.0.1:8977';
  const T = {
    MENU: 8000,
    INPUT: 15000,
    PANEL: 30000,
    FILE_READY: 180000,
    KEEP_DIALOG: 90000,
    LOAD: 240000
  };

  const MIME = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.aiff': 'audio/aiff'
  };

  const SEL_AUDIO = 'button[aria-label="Add audio - Browse, upload, or record audio"]';
  const SEL_PLAY = '[aria-label="Play audio"]';

  let running = false;
  let stopped = false;
  let currentIndex = -1;
  let total = 0;
  let phase = 'idle';
  let loops = [];
  const statuses = {};
  const logs = [];

  function log(...a) {
    const line = new Date().toLocaleTimeString('ru-RU') + ' ' + a.map((x) => (typeof x === 'string' ? x : x && x.message ? x.message : JSON.stringify(x))).join(' ');
    logs.push(line);
    if (logs.length > 400) logs.shift();
    try {
      console.log('[LoopsLoader]', line);
    } catch (e) {}
  }

  function notify() {
    try {
      chrome.runtime.sendMessage({
        type: 'progress',
        running,
        phase,
        currentIndex,
        total,
        loops,
        statuses,
        logs: logs.slice(-60)
      }).catch(() => {});
    } catch (e) {}
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function safe(fn) {
    return new Promise((resolve) => {
      try {
        const v = fn();
        if (v && typeof v.then === 'function') v.then(resolve).catch(() => resolve(null));
        else resolve(v);
      } catch (e) {
        resolve(null);
      }
    });
  }

  function textOf(el) {
    return (el && (el.textContent || '').trim()) || '';
  }

  function btnByText(scope, text) {
    const els = scope.querySelectorAll('button');
    for (const b of els) {
      if (textOf(b) === text) return b;
    }
    return null;
  }

  function isDisabled(btn) {
    return !btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  }

  function progressPct(scope) {
    try {
      const styles = scope.querySelectorAll('[style*="width"]');
      for (const s of styles) {
        const m = (s.getAttribute('style') || '').match(/width:\s*([\d.]+)%/);
        if (m) return Math.round(parseFloat(m[1]));
      }
    } catch (e) {}
    return null;
  }

  function dialogTexts() {
    return [...document.querySelectorAll('[role="dialog"]')].map((d) => textOf(d).slice(0, 120));
  }

  async function waitFor(fn, timeout, desc, poll) {
    const t0 = Date.now();
    let lastPoll = 0;
    while (Date.now() - t0 < timeout) {
      if (stopped) throw new Error('stopped');
      const v = await safe(fn);
      if (v) return v;
      const ts = Date.now() - t0;
      if (poll && ts - lastPoll >= 3000) {
        lastPoll = ts;
        try {
          poll(ts);
        } catch (e) {}
      }
      await sleep(250);
    }
    throw new Error('timeout ' + Math.round(timeout / 1000) + 's: ' + desc);
  }

  async function clickEl(el, desc) {
    if (!el) throw new Error('not found: ' + desc);
    log('clicking: ' + desc);
    await safe(() => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    });
    el.click();
    await sleep(300);
  }

  async function pingServer() {
    try {
      const r = await fetch(SERVER + '/api/loops', { cache: 'no-store' });
      const j = await r.json();
      return { ok: r.ok && !!j, n: (j.loops || []).length, error: null };
    } catch (e) {
      return { ok: false, n: 0, error: e.message || String(e) };
    }
  }

  async function stepMenu() {
    phase = 'menu';
    notify();
    log('--- step 1: open Audio+ menu');
    log('page:', location.href, 'title=' + (document.title || '').slice(0, 80), 'readyState=' + document.readyState);
    const btn = await waitFor(
      () => document.querySelector(SEL_AUDIO),
      T.MENU,
      'Audio+ button',
      (ts) => log('  wait Audio+ (' + ts + 'ms) count=' + document.querySelectorAll(SEL_AUDIO).length)
    );
    log('Audio+ button found, clicking');
    btn.click();
    await sleep(500);
    const items = [...document.querySelectorAll('button')].filter((b) => ['Browse', 'Upload', 'Record'].includes(textOf(b)));
    log('context menu items found:', items.map((b) => textOf(b)).join(' | ') || '<none>, trying loose search');
    let up = items.find((b) => textOf(b) === 'Upload');
    if (!up) {
      up = btnByText(document, 'Upload');
      if (up) log('Upload found via loose text match');
    }
    if (!up) throw new Error('menu item "Upload" not found after clicking Audio+');
    await clickEl(up, 'Upload');
    log('Upload clicked');
  }

  async function stepSetFile(name) {
    phase = 'file';
    notify();
    log('--- step 2: set file ' + name);
    const ins0 = [...document.querySelectorAll('input[type="file"]')];
    log('file inputs on page:', ins0.length, '->', ins0.map((i) => 'accept=' + (i.getAttribute('accept') || '*') + (i.multiple ? ' multi' : '')).join(' ; ') || '');
    const input = await waitFor(
      () => document.querySelector('input[type="file"]'),
      T.INPUT,
      'file input',
      (ts) => log('  wait input[type=file] (' + ts + 'ms) count=' + document.querySelectorAll('input[type="file"]').length)
    );
    log('using input: accept=' + (input.getAttribute('accept') || '*') + ' multiple=' + !!input.multiple);
    const url = SERVER + '/loop/' + encodeURIComponent(name);
    let resp = null;
    await waitFor(
      async () => {
        try {
          resp = await fetch(url, { cache: 'no-store' });
          return resp && resp.ok;
        } catch (e) {
          resp = null;
          return null;
        }
      },
      15000,
      'fetch ' + name + ' from ' + SERVER + ' (run.bat? server.js?)',
      (ts) => log('  wait local server (' + ts + 'ms) error=' + (resp ? 'http ' + resp.status : 'NO RESPONSE'))
    );
    const buf = await resp.arrayBuffer();
    log('fetched from server OK:', (buf.byteLength / 1048576).toFixed(2) + ' MB');
    const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const file = new File([buf], name.split('/').pop(), { type: MIME[ext] || 'audio/mpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      input.files = dt.files;
      log('input.files assigned OK, files=' + input.files.length + ' name=' + (input.files[0] && input.files[0].name));
    } catch (e) {
      throw new Error('cannot assign input.files: ' + (e.message || e));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    log('change event dispatched');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    log('input event dispatched');
  }

  async function stepUploadPanel() {
    phase = 'upload';
    notify();
    log('--- step 3: wait upload panel, pick Loop, Continue');
    const dialog = await waitFor(
      () => {
        const d = document.querySelector('[role="dialog"]');
        return d && btnByText(d, 'Continue') ? d : null;
      },
      T.PANEL,
      'upload panel (dialog with Continue)',
      (ts) => log('  wait upload panel (' + ts + 'ms) dialogs=' + JSON.stringify(dialogTexts()))
    );
    log('upload panel open');
    const chip = btnByText(dialog, 'Loop');
    if (chip) {
      log('Loop chip found, aria-pressed=' + (chip.getAttribute('aria-pressed') || 'null'));
      if (chip.getAttribute('aria-pressed') !== 'true') await clickEl(chip, 'Loop chip');
      else log('Loop chip already pressed');
    } else {
      log('Loop chip NOT found in panel');
    }
    await waitFor(
      () => !isDisabled(btnByText(dialog, 'Continue')),
      T.FILE_READY,
      'Continue enabled (file upload finished)',
      (ts) => {
        const bar = progressPct(dialog);
        log('  uploading (' + ts + 'ms)' + (bar != null ? ' progress=' + bar + '%' : '') + ' continueDisabled=' + isDisabled(btnByText(dialog, 'Continue')));
      }
    );
    log('Continue enabled');
    await clickEl(btnByText(dialog, 'Continue'), 'Continue');
    log('Continue clicked');
  }

  async function stepKeepCurrent() {
    phase = 'keep';
    notify();
    log('--- step 4: wait "Overwrite Lyrics & Styles?" -> Keep Current');
    const dialog = await waitFor(
      () => {
        const d = document.querySelector('[role="dialog"]');
        return d && textOf(d).includes('Overwrite Lyrics & Styles') ? d : null;
      },
      T.KEEP_DIALOG,
      'Overwrite lyrics dialog',
      (ts) => log('  wait overwrite dialog (' + ts + 'ms) dialogs=' + JSON.stringify(dialogTexts()))
    ).catch(() => null);
    if (!dialog) {
      log('overwrite dialog NOT shown (60s wait done) - continuing anyway');
      return;
    }
    log('overwrite dialog found');
    const keep = btnByText(dialog, 'Keep Current');
    if (!keep) throw new Error('"Keep Current" button not found in dialog');
    await clickEl(keep, 'Keep Current');
    log('Keep Current clicked');
  }

  async function stepLoaded(prevCount) {
    phase = 'waiting';
    notify();
    log('--- step 5: wait clip load (play buttons before=' + prevCount + ')');
    await waitFor(
      () => document.querySelectorAll(SEL_PLAY).length > prevCount,
      T.LOAD,
      'clip loaded (new play button)',
      (ts) => log('  waiting load (' + ts + 'ms) playCount=' + document.querySelectorAll(SEL_PLAY).length + ' dialogs=' + JSON.stringify(dialogTexts()))
    );
    log('clip loaded, playCount=' + document.querySelectorAll(SEL_PLAY).length);
  }

  async function runLoop(name) {
    statuses[name] = 'uploading';
    notify();
    await stepMenu();
    await stepSetFile(name);
    await stepUploadPanel();
    await stepKeepCurrent();
    const prev = document.querySelectorAll(SEL_PLAY).length;
    await stepLoaded(prev);
    statuses[name] = 'ok';
    log('=== OK: ' + name);
    notify();
  }

  async function start(list) {
    if (running) return { ok: false, error: 'already running' };
    loops = list.slice();
    total = loops.length;
    for (const n of loops) statuses[n] = 'pending';
    running = true;
    stopped = false;
    currentIndex = -1;
    log('=== START ' + total + ' loops');
    notify();
    for (let i = 0; i < loops.length; i++) {
      currentIndex = i;
      const name = loops[i];
      log('=== loop ' + (i + 1) + '/' + total + ': ' + name);
      try {
        await runLoop(name);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (stopped) {
          statuses[name] = 'stopped';
          log('=== STOPPED at ' + name);
          break;
        }
        statuses[name] = 'err';
        log('=== FAILED: ' + name + ' -> ' + msg);
        await sleep(1500);
      }
      notify();
    }
    running = false;
    phase = stopped ? 'stopped' : 'done';
    stopped = false;
    log('=== FINISHED phase=' + phase);
    notify();
    return { ok: true };
  }

  async function probe() {
    const inputs = [...document.querySelectorAll('input[type="file"]')].map((i) => ({
      accept: i.getAttribute('accept') || '*',
      multiple: !!i.multiple
    }));
    const menus = [...document.querySelectorAll('button')].map(textOf).filter((t) => ['Browse', 'Upload', 'Record'].includes(t));
    const srv = await pingServer();
    return {
      href: location.href,
      title: (document.title || '').slice(0, 80),
      readyState: document.readyState,
      audioButtons: document.querySelectorAll(SEL_AUDIO).length,
      playButtons: document.querySelectorAll(SEL_PLAY).length,
      dialogs: dialogTexts(),
      contextMenuItems: menus,
      fileInputs: inputs,
      server: srv
    };
  }

  window.addEventListener('error', (e) => log('window error:', e.message, '@', (e.filename || '').split('/').pop() + ':' + e.lineno));

  setInterval(() => {
    if (running) notify();
  }, 4000);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'start') {
      start(msg.loops || [])
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
    if (msg.type === 'stop') {
      stopped = true;
      phase = 'stopping';
      log('stop requested by user');
      sendResponse({ ok: true });
      notify();
      return false;
    }
    if (msg.type === 'get-state') {
      sendResponse({ running, phase, currentIndex, total, loops, statuses, logs: logs.slice(-60) });
      return false;
    }
    if (msg.type === 'probe') {
      probe().then((p) => sendResponse({ ok: true, probe: p })).catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
  });

  log('content.js loaded, host=' + location.hostname + ' href=' + location.href);
  probe().then((p) => log('diag:', JSON.stringify({
    audioButtons: p.audioButtons,
    playButtons: p.playButtons,
    contextMenuItems: p.contextMenuItems,
    fileInputs: p.fileInputs,
    server: p.server ? (p.server.ok ? 'OK (' + p.server.n + ' loops)' : 'DOWN: ' + p.server.error) : null
  })));
})();