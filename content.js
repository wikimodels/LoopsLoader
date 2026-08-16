(function () {
  const SERVER = 'http://127.0.0.1:8977';
  const T = {
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

  function isVisible(el) {
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) {
      return false;
    }
  }

  function errorTexts() {
    const out = [];
    const sels = ['[role="alert"]', '[role="status"]', '[class*="Toast"]', '[class*="toast"]', '[class*="error"]', '[class*="Error"]', '[class*="alert"]', '[class*="Alert"]'];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const t = textOf(el);
        if (t && t.length < 300 && t.length > 2) out.push(t);
      }
    }
    return [...new Set(out)].slice(0, 6);
  }

  function visibleBtnTexts() {
    return [...document.querySelectorAll('button')]
      .map(textOf)
      .filter((t) => t && t.length < 60)
      .slice(0, 40);
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

  function dispatchClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'mouseover', 'mouseenter', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, opts));
      } catch (e) {}
    }
    try {
      el.click();
    } catch (e) {}
  }

  async function clickEl(el, desc) {
    if (!el) throw new Error('not found: ' + desc);
    log('clicking: ' + desc);
    await safe(() => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    });
    dispatchClick(el);
    await sleep(400);
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

  function uploadPanel() {
    const ds = document.querySelectorAll('[role="dialog"]');
    for (const d of ds) {
      if (btnByText(d, 'Continue')) return d;
    }
    return null;
  }

  function uploadStatusText(d) {
    if (!d) return 'CLOSED';
    const spans = d.querySelectorAll('span');
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (/^Upload(ing|ed)( Clip)?$/i.test(t)) return t;
    }
    return null;
  }

  function overwriteDialog() {
    const ds = document.querySelectorAll('[role="dialog"]');
    for (const d of ds) {
      if (textOf(d).includes('Overwrite Lyrics & Styles')) return d;
    }
    return null;
  }

  async function waitPanel(timeout) {
    return waitFor(
      uploadPanel,
      timeout,
      'upload panel (dialog with Continue)',
      (ts) => log('  wait upload panel (' + ts + 'ms) dialogs=' + JSON.stringify(dialogTexts()))
    ).catch(() => null);
  }

  function injectFile(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    log('files assigned to input: ' + input.files.length + ' [' + (input.files[0] && input.files[0].name) + ']');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function fetchLoopFile(name) {
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
      'fetch ' + name + ' from ' + SERVER,
      (ts) => log('  wait local server (' + ts + 'ms) error=' + (resp ? 'http ' + resp.status : 'NO RESPONSE'))
    );
    const buf = await resp.arrayBuffer();
    log('fetched from server: ' + (buf.byteLength / 1048576).toFixed(2) + ' MB');
    const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    return new File([buf], name.split('/').pop(), { type: MIME[ext] || 'audio/mpeg' });
  }

  async function openMenuAndUpload() {
    phase = 'menu';
    notify();
    log('--- fallback: open Audio+ menu');
    const btn = await waitFor(
      () => document.querySelector(SEL_AUDIO),
      8000,
      'Audio+ button',
      (ts) => log('  wait Audio+ (' + ts + 'ms) count=' + document.querySelectorAll(SEL_AUDIO).length)
    );
    await clickEl(btn, 'Audio+ button');
    await sleep(1500);
    const items = [...document.querySelectorAll('button')].filter((b) => ['Browse', 'Upload', 'Record'].includes(textOf(b)));
    log('context menu items:', items.map((b) => textOf(b)).join(' | ') || '<none>');
    let up = items.find((b) => textOf(b) === 'Upload') || btnByText(document, 'Upload');
    if (!up) {
      log('suspicious buttons:', JSON.stringify(visibleBtnTexts()));
      throw new Error('menu item "Upload" not found');
    }
    await clickEl(up, 'Upload');
    log('Upload clicked (native dialog may open - press Esc if so)');
    await sleep(1000);
  }

  async function tryInjectAndWaitPanel(file, timeout) {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    log('file inputs found:', inputs.length, '->', inputs.map((i) => 'accept=' + (i.getAttribute('accept') || '*')).join(' ; ') || '');
    if (!inputs.length) {
      log('no file inputs on page at all');
      return null;
    }
    const candidates = [inputs[inputs.length - 1], inputs[0]];
    const tried = [];
    for (const input of candidates) {
      if (tried.includes(input)) continue;
      tried.push(input);
      log('injecting into input (index ' + inputs.indexOf(input) + ') accept=' + (input.getAttribute('accept') || '*'));
      injectFile(input, file);
      await sleep(1200);
      const dlg = await waitPanel(timeout / 2);
      if (dlg) {
        log('upload panel appeared after inject');
        return dlg;
      }
      log('no panel after inject on this input, dialogs=' + JSON.stringify(dialogTexts()));
    }
    return null;
  }

  async function pickLoopAndContinue() {
    phase = 'upload';
    notify();
    log('waiting for upload to finish (status text -> "Uploaded")');
    const done = await waitFor(
      () => {
        const d = uploadPanel();
        if (!d) return 'CLOSED';
        const st = uploadStatusText(d);
        if (st && /Uploaded/i.test(st)) return 'DONE';
        return null;
      },
      T.FILE_READY,
      'upload finished (Uploaded)',
      (ts) => {
        const d = uploadPanel();
        const st = d ? uploadStatusText(d) : 'CLOSED';
        const bar = d ? progressPct(d) : null;
        log('  upload status (' + ts + 'ms): ' + (st || '?') + (bar != null ? ' ' + bar + '%' : '') + ' dialogs=' + JSON.stringify(dialogTexts()));
      }
    );
    log('upload finished: ' + done);
    let panel = uploadPanel();
    if (!panel) {
      log('upload panel closed, assuming upload completed');
      await sleep(1000);
      return;
    }
    await sleep(1000);
    const chip = btnByText(panel, 'Loop');
    if (chip) {
      log('Loop chip: aria-pressed=' + (chip.getAttribute('aria-pressed') || 'null'));
      if (chip.getAttribute('aria-pressed') !== 'true') await clickEl(chip, 'Loop chip');
      else log('Loop chip already pressed');
    } else {
      log('Loop chip NOT found in panel');
    }
    await sleep(1000);
    const contPanel = uploadPanel() || panel;
    log('waiting Continue enabled');
    await waitFor(
      () => !isDisabled(btnByText(contPanel, 'Continue')),
      60000,
      'Continue enabled',
      (ts) => log('  wait Continue (' + ts + 'ms) disabled=' + isDisabled(btnByText(contPanel, 'Continue')))
    );
    log('Continue enabled, clicking');
    dispatchClick(btnByText(contPanel, 'Continue'));
    await sleep(1000);
    log('Continue clicked');
  }

  async function stepOverwriteIfShown(stem) {
    phase = 'keep';
    notify();
    log('--- optional: "Overwrite Lyrics & Styles?" -> Keep Current (25s window, verified clicks)');
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      if (stopped) throw new Error('stopped');
      const dialog = overwriteDialog();
      if (dialog) {
        const keep = btnByText(dialog, 'Keep Current');
        if (!keep) {
          log('overwrite dialog without Keep Current button');
          await sleep(1000);
          continue;
        }
        await clickEl(keep, 'Keep Current');
        let closed = false;
        for (let i = 0; i < 8 && !closed; i++) {
          await sleep(250);
          if (!overwriteDialog()) closed = true;
        }
        if (closed) {
          log('Keep Current dialog closed');
          await sleep(500);
        } else {
          log('Keep Current dialog still open, clicking again');
        }
        continue;
      }
      if (clipCardReady(stem)) {
        log('clip card ready, keep window done');
        return;
      }
      await sleep(250);
    }
    if (overwriteDialog()) {
      log('overwrite dialog still open after 25s window');
      throw new Error('keep dialog stuck open');
    }
    log('no overwrite dialog shown - continuing');
  }

  let invalidUpload = false;

  function stemOf(name) {
    return name.replace(/\.[a-z0-9]+$/i, '');
  }

  function clipCardReady(stem) {
    for (const p of document.querySelectorAll(SEL_PLAY)) {
      let cur = p.parentElement;
      for (let i = 0; i < 4 && cur; i++) {
        if (textOf(cur).includes(stem) && cur.querySelector('canvas')) return p;
        cur = cur.parentElement;
      }
    }
    return null;
  }

  async function stepLoaded(name) {
    phase = 'waiting';
    notify();
    const stem = stemOf(name);
    log('--- step: wait editor clip card "' + stem + '" (name + play button + waveform, not spinner)');
    await waitFor(
      () => {
        const errs = errorTexts().join(' ').toLowerCase();
        if (/invalid upload/.test(errs)) {
          if (!invalidUpload) {
            invalidUpload = true;
            log('Suno signals: Invalid upload. Please try again.');
          }
          return 'INVALID';
        }
        return clipCardReady(stem) ? 'LOADED' : null;
      },
      T.LOAD,
      'clip card ready',
      (ts) => log('  waiting clip card (' + ts + 'ms) cardReady=' + !!clipCardReady(stem) + ' errors=' + JSON.stringify(errorTexts()) + ' dialogs=' + JSON.stringify(dialogTexts()))
    );
    if (invalidUpload) {
      invalidUpload = false;
      throw new Error('invalid upload (Suno rejected the file)');
    }
    await sleep(1000);
    log('clip card ready: ' + stem);
  }

  async function closeOpenPanels() {
    const ds = document.querySelectorAll('[role="dialog"]');
    for (const d of ds) {
      if (textOf(d).includes('Privacy Preference Center')) continue;
      const closeBtn = d.querySelector('button[aria-label="Close"]') || btnByText(d, 'Cancel');
      if (closeBtn) {
        log('closing leftover panel');
        dispatchClick(closeBtn);
        await sleep(400);
      }
    }
  }

  async function runLoop(name) {
    statuses[name] = 'uploading';
    notify();
    log('--- step 1: get file from server');
    const file = await fetchLoopFile(name);
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      log('=== attempt ' + attempt + '/3 for ' + name);
      try {
        log('--- step 2: inject file into Suno input (menu skipped)');
        let panel = await tryInjectAndWaitPanel(file, T.PANEL);
        if (!panel) {
          log('--- step 3: fallback - open Audio+ menu and press Upload');
          await openMenuAndUpload();
          panel = await tryInjectAndWaitPanel(file, T.PANEL);
          if (!panel) {
            log('final dialogs:', JSON.stringify(dialogTexts()));
            throw new Error('upload did not start');
          }
        }
        const prevCount = document.querySelectorAll(SEL_PLAY).length;
        log('play buttons before Continue: ' + prevCount);
        await pickLoopAndContinue();
        await stepOverwriteIfShown(stemOf(name));
        await stepLoaded(name);
        statuses[name] = 'ok';
        log('=== OK: ' + name);
        notify();
        return;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (msg === 'stopped') throw e;
        lastErr = msg;
        log('=== attempt ' + attempt + ' failed: ' + msg);
        await sleep(2000);
        await closeOpenPanels();
      }
    }
    throw new Error('3 attempts failed: ' + lastErr);
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
      if (!stopped) await sleep(3000);
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