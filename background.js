// background.js — Loops Loader service worker (MV3)
// 'progress'      -> ретрансляция статусов от content.js в popup + storage.session
// 'start-server'  -> fire-and-forget запуск сервера через native messaging host;
//                    результат пишется в storage.session (diag), ответ по каналу
//                    сообщения не критичен — popup опрашивает HTTP и читает diag.
'use strict';

const NATIVE_HOST = 'com.loopsloader.host';
const BG_VERSION = 'bg-v4';

console.log('[LoopsLoader-bg] service worker started, ' + BG_VERSION);

function startServerViaNative() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      resolve(payload);
    };

    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener((m) => {
        finish({ ok: !!(m && m.ok), reply: m });
        try { port.disconnect(); } catch (_) {}
      });
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        finish({ ok: false, error: err ? err.message : 'native host disconnected' });
      });
      port.postMessage({ type: 'start' });
      setTimeout(() => finish({ ok: false, error: 'native host timeout' }), 5000);
    } catch (e) {
      finish({ ok: false, error: e.message || String(e) });
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === 'progress') {
    chrome.storage.session.set({ lastProgress: msg }).catch(() => {});
    chrome.runtime.sendMessage(msg).catch(() => {});
    return false;
  }

  if (msg.type === 'start-server') {
    // Отвечаем мгновенно, чтобы канал не порвался; реальный результат — в storage.
    try { sendResponse({ ok: true, accepted: true }); } catch (_) {}
    startServerViaNative().then((res) => {
      res.at = new Date().toISOString();
      res.version = BG_VERSION;
      chrome.storage.session.set({ serverStartDiag: res }).catch(() => {});
      console.log('[LoopsLoader-bg] start-server result:', JSON.stringify(res));
    });
    return false;
  }

  if (msg.type === 'get-start-diag') {
    chrome.storage.session.get('serverStartDiag')
      .then((d) => sendResponse(d.serverStartDiag || null))
      .catch(() => sendResponse(null));
    return true;
  }

  return false;
});
