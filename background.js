let creating;
let permissionWindowId, openingPermission;
const clearPopup = () => chrome.action.setPopup({ popup: '' });
chrome.runtime.onInstalled.addListener(() => { clearPopup().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { clearPopup().catch(console.error); });
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=full') }).catch(console.error);
});
async function ensureRecorder() {
  if (creating) return creating;
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) creating = chrome.offscreen.createDocument({
    url: 'recorder.html', reasons: ['USER_MEDIA', 'BLOBS'],
    justification: 'Record conversations and transcribe microphone audio while the toolbar popup is closed.'
  }).finally(() => { creating = null; });
  await creating;
}
async function recorderCommand(command, data = {}) {
  await ensureRecorder();
  const response = await chrome.runtime.sendMessage({ target: 'recorder', command, ...data });
  if (!response) throw new Error('Background recorder did not respond. Reload the extension and try again.');
  return response;
}
async function openMicrophoneWindow(id) {
  if (openingPermission) return openingPermission;
  openingPermission = (async () => {
    if (permissionWindowId !== undefined) {
      try { await chrome.windows.update(permissionWindowId, { focused: true }); return; }
      catch { permissionWindowId = undefined; }
    }
    const window = await chrome.windows.create({
      url: chrome.runtime.getURL('microphone.html') + '?id=' + encodeURIComponent(id),
      type: 'popup', width: 480, height: 440, focused: true
    });
    permissionWindowId = window.id;
  })().finally(() => { openingPermission = null; });
  return openingPermission;
}
chrome.windows?.onRemoved?.addListener(id => { if (id === permissionWindowId) permissionWindowId = undefined; });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.target === 'background' && message.command === 'startRecording') {
    (async () => {
      const response = await recorderCommand('start', { id: message.id });
      if (response.code !== 'MICROPHONE_PERMISSION_REQUIRED') return response;
      await openMicrophoneWindow(message.id);
      return { permissionPending: true };
    })().then(reply, error => reply({ error: error.message }));
    return true;
  }
  if (message.target === 'background' && message.command === 'finishMicrophoneSetup') {
    if (!sender.url?.startsWith(chrome.runtime.getURL('microphone.html') + '?')) {
      reply({ error: 'Microphone setup must be completed in the permission window.' }); return;
    }
    recorderCommand('start', { id: message.id }).then(reply, error => reply({ error: error.message }));
    return true;
  }
  if (message.target === 'background' && ['storageGet', 'storageSet'].includes(message.command)) {
    const allowedKeys = ['conversationFolders', 'noteStyle'];
    const run = async () => {
      if (message.command === 'storageGet') {
        if (!allowedKeys.includes(message.key)) throw new Error('Unsupported storage key.');
        return { data: await chrome.storage.local.get(message.key) };
      }
      if (!message.values || typeof message.values !== 'object' || Array.isArray(message.values) || Object.keys(message.values).some(key => !allowedKeys.includes(key))) throw new Error('Unsupported storage values.');
      await chrome.storage.local.set(message.values);
      return { ok: true };
    };
    run().then(reply, error => reply({ error: error.message }));
    return true;
  }
  if (message.target === 'background' && message.command === 'openOnGoogle') {
    (async () => {
      await chrome.tabs.create({ url: 'https://www.google.com/', active: true });
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=full'), active: true });
      return { ok: true };
    })().then(reply, error => reply({ error: error.message }));
    return true;
  }
  if (message.target === 'background' && message.command === 'connect') {
    ensureRecorder().then(() => reply({ ok: true }), error => reply({ error: error.message }));
    return true;
  }
  if (message.target === 'background' && message.command === 'indicator') {
    chrome.action.setBadgeText({ text: message.active ? (message.paused ? 'Ⅱ' : 'REC') : '' });
    chrome.action.setBadgeBackgroundColor({ color: message.paused ? '#8a6a24' : '#d43b35' });
  }
});
