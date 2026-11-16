const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker({ permission = true } = {}) {
  let listener, offscreen = false, permissionGranted = permission;
  const windows = [], commands = [], broadcasts = [];
  const state = { current: { id: 'conversation' }, active: false };
  const context = {
    console,
    chrome: {
      runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path,
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } },
        async sendMessage(message) {
          commands.push(message);
          if (!permissionGranted) return { error: 'Microphone approval needed', code: 'MICROPHONE_PERMISSION_REQUIRED' };
          if (message.id !== state.current.id) return { error: 'Conversation changed' };
          state.active = true; return { state: structuredClone(state) };
        }
      },
      offscreen: { async hasDocument() { return offscreen; }, async createDocument(options) { offscreen = true; broadcasts.push(options); } },
      windows: { onRemoved: { addListener() {} }, async create(options) { windows.push(options); return { id: 1 }; }, async update() {} }
    }
  };
  vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), context);
  const send = (command, data = {}, sender = {}) => new Promise(resolve => listener({ target: 'background', command, ...data }, { id: 'test', ...sender }, resolve));
  return { send, windows, commands, broadcasts, state, grant() { permissionGranted = true; } };
}

test('start uses the offscreen recorder without opening any tab or permission window when allowed', async () => {
  const w = worker();
  const response = await w.send('startRecording', { id: 'conversation' });
  assert.equal(response.state.active, true);
  assert.equal(w.windows.length, 0);
  assert.equal(w.broadcasts.length, 1);
  assert.ok(w.broadcasts[0].reasons.includes('USER_MEDIA'));
  assert.equal(w.commands[0].target, 'recorder');
  // A fresh popup reconnects to the same hidden document, without recreating it.
  await w.send('connect');
  assert.equal(w.broadcasts.length, 1);
  assert.equal(w.state.active, true);
});

test('permission prompt hands off to the same offscreen recorder and stale conversations are rejected', async () => {
  const w = worker({ permission: false });
  assert.equal((await w.send('startRecording', { id: 'conversation' })).permissionPending, true);
  assert.equal(w.windows[0].type, 'popup');
  assert.match(w.windows[0].url, /microphone.html\?id=conversation/);
  w.grant();
  const response = await w.send('finishMicrophoneSetup', { id: 'conversation' }, { url: w.windows[0].url });
  assert.equal(response.state.active, true);
  assert.equal(w.broadcasts.length, 1);
  assert.match((await w.send('startRecording', { id: 'stale' })).error, /changed/);
});

async function permissionPage({ denied = false, backgroundError = false } = {}) {
  let resolveStart, rejectStart, streamStopped = false, closed = false;
  const elements = { allow: {}, result: {} };
  let request;
  const backgroundStart = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  vm.runInNewContext(fs.readFileSync('microphone.js', 'utf8'), {
    document: { getElementById: id => elements[id] }, location: { search: '?id=conversation' }, URLSearchParams,
    navigator: { mediaDevices: { async getUserMedia() {
      if (denied) throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
      return { getTracks: () => [{ stop() { streamStopped = true; } }] };
    } } },
    chrome: { runtime: { sendMessage(message) { request = message; return backgroundStart; } } },
    setTimeout: fn => fn(), window: { close() { closed = true; } }
  });
  await new Promise(resolve => setImmediate(resolve));
  if (!denied) {
    assert.equal(streamStopped, false, 'permission stream stays alive during handoff');
    assert.equal(closed, false);
    assert.equal(request.command, 'finishMicrophoneSetup');
    if (backgroundError) rejectStart(new Error('Recorder failed'));
    else resolveStart({ state: { active: true } });
    await new Promise(resolve => setImmediate(resolve));
  }
  return { elements, streamStopped, closed };
}

test('permission window closes only after background recording is confirmed', async () => {
  const result = await permissionPage();
  assert.equal(result.streamStopped, true);
  assert.equal(result.closed, true);
});

test('permission denial or recorder failure leaves a retry message and releases temporary audio', async () => {
  const denied = await permissionPage({ denied: true });
  assert.equal(denied.closed, false); assert.equal(denied.elements.allow.hidden, false);
  const failed = await permissionPage({ backgroundError: true });
  assert.equal(failed.closed, false); assert.equal(failed.streamStopped, true);
  assert.match(failed.elements.result.textContent, /Recorder failed/);
});
