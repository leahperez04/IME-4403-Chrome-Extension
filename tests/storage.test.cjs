const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('worker handles storage requests, rejects unknown keys, and reports failures', async () => {
  const storage = {}; let listener; let fail = false;
  vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), {
    console,
    chrome: {
      runtime: { id: 'test', onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: {
        async get(key) { return { [key]: storage[key] }; },
        async set(values) { if (fail) throw new Error('Storage full'); Object.assign(storage, values); }
      } }
    }
  });
  const send = message => new Promise(resolve => { assert.equal(listener({ target: 'background', ...message }, { id: 'test' }, resolve), true); });
  assert.equal((await send({ command: 'storageSet', values: { conversationFolders: [{ id: 'a', name: 'Course' }] } })).ok, true);
  assert.equal((await send({ command: 'storageGet', key: 'conversationFolders' })).data.conversationFolders[0].name, 'Course');
  assert.equal((await send({ command: 'storageSet', values: { noteStyle: { bullets: true } } })).ok, true);
  assert.equal((await send({ command: 'storageGet', key: 'noteStyle' })).data.noteStyle.bullets, true);
  assert.match((await send({ command: 'storageGet', key: 'unexpected' })).error, /Unsupported/);
  fail = true;
  assert.equal((await send({ command: 'storageSet', values: { noteStyle: {} } })).error, 'Storage full');
});
