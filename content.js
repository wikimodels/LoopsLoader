(function () {
  const SERVER = 'http://127.0.0.1:8977';
  const T = {
    MENU: 5000,
    DIALOG: 15000,
    FILE_READY: 120000,
    KEEP_DIALOG: 10000,
    LOAD: 180000
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
    if (logs.length > 200) logs.shift();
    console.log('[LoopsLoader]', line);
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
        logs: logs.slice(-30)
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

  function scopeHasText(scope, text) {
    return (scope && textOf(scope).includes(text)) || false;
  }

  function isDisabled(btn) {
    return !btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  }

  async function waitFor(fn, timeout, desc) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (stopped) throw new Error('stopped');
      const v = await safe(fn);
      if (v) return v;
      await sleep(250);
    }
    throw new Error('timeout: ' + desc);
  }

  async function clickEl(el, desc) {
    if (!el) throw new Error('not found: ' + desc);
    await safe(() => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    });
    el.click();
  }

  async function openUploadDialog() {
    phase = 'open';
    notify();
    const btn = await waitFor(
      () => document.querySelector('button[aria-label="Add audio - Browse, upload, or record audio"]'),
      10000,
      'Audio+ button'
    );
    await clickEl(btn, 'Audio+ button');
    const uploadItem = await waitFor(() => btnByText(document, 'Upload'), T.MENU, 'Upload menu item');
    await clickEl(uploadItem, 'Upload menu item');
    await waitFor(
      () => {
        const d = document.querySelector('[role="dialog"]');
        return d && btnByText(d, 'Continue') && document.querySelector('input[type="file"]') ? d : null;
      },
      T.DIALOG,
      'Upload dialog'
    );
    log('upload dialog open');
  }

  async function setFile(name) {
    phase = 'file';
    notify();
    const url = SERVER + '/loop/' + encodeURIComponent(name);
    let resp;
    await waitFor(
      async () => {
        try {
          resp = await fetch(url, { cache: 'no-store' });
          return resp && resp.ok;
        } catch (e) {
          return null;
        }
      },
      15000,
      'fetch loop from local server (is server.js running?)'
    );
    const buf = await resp.arrayBuffer();
    const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const file = new File([buf], name.split('/').pop(), { type: MIME[ext] || 'audio/mpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error('no file input found');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    log('file set:', name, (buf.byteLength / 1048576).toFixed(2) + ' MB');
  }

  async function waitUploadAndContinue() {
    phase = 'upload';
    notify();
    const dialog = await waitFor(
      () => {
        const d = document.querySelector('[role="dialog"]');
        return d && btnByText(d, 'Continue') ? d : null;
      },
      T.DIALOG,
      'upload dialog for continue'
    );
    const chip = btnByText(dialog, 'Loop');
    if (chip) await clickEl(chip, 'Loop chip');
    await waitFor(() => isDisabled(btnByText(dialog, 'Continue')) === false, T.FILE_READY, 'upload finished (Continue enabled)');
    await clickEl(btnByText(dialog, 'Continue'), 'Continue button');
    log('Continue clicked');
  }

  async function resolveKeepCurrent() {
    phase = 'keep';
    notify();
    const dialog = await waitFor(
      () => {
        const d = document.querySelector('[role="dialog"]');
        return d && scopeHasText(d, 'Overwrite Lyrics & Styles') ? d : null;
      },
      T.KEEP_DIALOG,
      'Keep Current dialog'
    ).catch(() => null);
    if (!dialog) {
      log('no Keep Current dialog, continuing');
      return;
    }
    const keep = btnByText(dialog, 'Keep Current');
    if (!keep) throw new Error('Keep Current button not found');
    await clickEl(keep, 'Keep Current');
    log('Keep Current clicked');
  }

  async function waitLoaded(prevCount) {
    phase = 'waiting';
    notify();
    await waitFor(
      () => document.querySelectorAll('[aria-label="Play audio"]').length > prevCount,
      T.LOAD,
      'clip loaded (play button)'
    );
    log('clip loaded');
  }

  async function runLoop(name) {
    statuses[name] = 'uploading';
    notify();
    await openUploadDialog();
    await setFile(name);
    await waitUploadAndContinue();
    await resolveKeepCurrent();
    const prev = document.querySelectorAll('[aria-label="Play audio"]').length;
    await waitLoaded(prev);
    statuses[name] = 'ok';
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
    log('start', total + ' loops');
    for (let i = 0; i < loops.length; i++) {
      currentIndex = i;
      const name = loops[i];
      try {
        await runLoop(name);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (stopped) {
          statuses[name] = 'stopped';
          log('stopped at', name);
          break;
        }
        statuses[name] = 'err';
        log('FAILED', name, '-', msg);
        await sleep(1500);
      }
    }
    running = false;
    phase = stopped ? 'stopped' : 'done';
    stopped = false;
    notify();
    return { ok: true };
  }

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
      sendResponse({ ok: true });
      notify();
      return false;
    }
    if (msg.type === 'get-state') {
      sendResponse({ running, phase, currentIndex, total, loops, statuses, logs: logs.slice(-30) });
      return false;
    }
  });

  log('content.js loaded on', location.hostname);
})();
