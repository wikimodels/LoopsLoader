chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'progress') {
    chrome.storage.session.set({ lastProgress: msg }).catch(() => {});
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
  return false;
});
