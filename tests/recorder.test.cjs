const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('background recording survives reconnect, pause excludes speech/time, and edits preserve new speech', async () => {
  const storage = {}; const records = new Map(); let listener, now = 0;
  const speeches = [], recorders = [], track = { enabled: true, stop() {} };
  const asyncRequest = value => {
    const req = {}; setImmediate(() => { req.result = value; req.onsuccess?.(); }); return req;
  };
  const db = {
    createObjectStore() {},
    transaction() {
      const tx = { objectStore: () => ({
        getAll: () => asyncRequest([...records.values()]),
        put: data => { records.set(data.id, data); setImmediate(() => tx.oncomplete?.()); },
        delete: id => { records.delete(id); setImmediate(() => tx.oncomplete?.()); }
      }) }; return tx;
    }
  };
  class Speech {
    constructor() { speeches.push(this); }
    start() {} abort() { this.onend?.(); }
    emit(text) { const result = [{ transcript: text }]; result.isFinal = true; this.onresult?.({ resultIndex: 0, results: [result] }); }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; recorders.push(this); }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    requestData() { this.ondataavailable({ data: new Blob(['audio']) }); }
    stop() { this.state = 'inactive'; setImmediate(() => { this.requestData(); this.onstop(); }); }
  }
  const context = vm.createContext({
    SpeechRecognition: Speech, MediaRecorder: Recorder, Blob, URL, structuredClone,
    crypto: require('node:crypto').webcrypto, Date: { now: () => now },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } },
    indexedDB: { open: () => asyncRequest(db) },
    chrome: { runtime: { id: 'test', sendMessage: async message => {
      if (message.command === 'storageGet') return { data: { [message.key]: storage[message.key] } };
      if (message.command === 'storageSet') { Object.assign(storage, structuredClone(message.values)); return { ok: true }; }
    }, onMessage: { addListener: fn => { listener = fn; } } } },
    setTimeout, clearTimeout, setInterval: () => 0
  });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  const command = (command, data = {}) => new Promise(resolve => listener({ target: 'recorder', command, ...data }, { id: 'test' }, resolve)).then(response => { assert.equal(response.error, undefined); return response.state; });
  let state = await command('state'); const id = state.current.id;
  await command('start'); now = 3000; speeches[0].emit('First phrase.');
  state = await command('state'); assert.equal(state.active, true); assert.equal(state.duration, 3000); assert.equal(state.current.text, 'First phrase.');
  const revision = state.transcriptRevision;
  speeches[0].emit('New speech.');
  state = await command('edit', { id, text: 'Corrected phrase.', revision });
  assert.equal(state.current.text, 'Corrected phrase. New speech.');
  state = await command('pause'); assert.equal(state.paused, true); assert.equal(recorders[0].state, 'paused'); assert.equal(track.enabled, false);
  now = 13000; speeches[0].emit('Should not be saved.');
  state = await command('state'); assert.equal(state.duration, 3000); assert.equal(state.current.text, 'Corrected phrase. New speech.');
  state = await command('new'); assert.equal(state.current.id, id, 'cannot switch a paused recording');
  await command('pause'); assert.equal(track.enabled, true); assert.equal(recorders[0].state, 'recording');
  now = 15000; speeches[1].emit('Resumed.');
  state = await command('stop'); assert.equal(state.active, false); assert.equal(state.busy, false); assert.equal(state.duration, 5000);
  assert.equal(state.current.text, 'Corrected phrase. New speech. Resumed.'); assert.ok(state.audioURL); assert.ok(records.get(id).audio.size);
  state = await command('state'); assert.equal(state.current.id, id, 'reopening uses the same saved lecture');
  state = await command('applyGeneratedNotes', { id, transcript: state.current.text, previousNotes: '', notes: '# AI notes\n- Confirmed facts.' });
  assert.match(records.get(id).notes, /Confirmed facts/);
  const quizQuestions = [
    { type: 'multiple_choice', prompt: 'Which item was approved?', choices: ['Budget', 'Schedule', 'Hiring', 'Scope'], answerIndex: 0, explanation: 'The lecture says the budget was approved.' },
    { type: 'multiple_choice', prompt: 'What did the team approve?', choices: ['Budget', 'Schedule', 'Hiring', 'Scope'], answerIndex: 0, explanation: 'The notes confirm the budget approval.' },
    { type: 'true_false', prompt: 'The budget was approved.', choices: ['True', 'False'], answerIndex: 0, explanation: 'The lecture confirms this.' },
    { type: 'true_false', prompt: 'The schedule was approved.', choices: ['True', 'False'], answerIndex: 1, explanation: 'No schedule approval was mentioned.' }
  ];
  state = await command('applyGeneratedQuiz', { id, transcript: state.current.text, notes: state.current.notes, questions: quizQuestions });
  assert.equal(state.current.quiz.length, 4);
  assert.equal(state.current.quiz[2].choices.length, 2, 'true/false options remain a two-choice pair');
  assert.equal(state.current.quizRevision, state.current.studyRevision);
  assert.equal(records.get(id).quiz.length, 4, 'the mixed quiz is persisted');
  const stale = await new Promise(resolve => listener({ target: 'recorder', command: 'applyGeneratedNotes', id, transcript: 'stale transcript', previousNotes: state.current.notes, notes: 'Should not save' }, { id: 'test' }, resolve));
  assert.match(stale.error, /changed during generation/);
  assert.match(records.get(id).notes, /Confirmed facts/);
  const wrongConversation = await new Promise(resolve => listener({ target: 'recorder', command: 'applyGeneratedNotes', id: 'wrong-id', notes: 'Should not save' }, { id: 'test' }, resolve));
  assert.match(wrongConversation.error, /Conversation changed/);
  state = await command('setFigures', { id, figures: [{ image: 'data:image/jpeg;base64,/9j/', caption: 'Figure caption' }] });
  assert.equal(state.current.figures[0].caption, 'Figure caption');
  assert.equal(records.get(id).figures[0].image, 'data:image/jpeg;base64,/9j/');
  await command('setFigures', { id, figures: [] });
  assert.equal(records.get(id).figures.length, 0);
  state = await command('setStyle', { image: 'data:image/jpeg;base64,/9j/', name: 'Notebook.jpg' });
  assert.equal(storage.noteStyle.image, 'data:image/jpeg;base64,/9j/');
  assert.equal(storage.noteStyle.name, 'Notebook.jpg');
  await command('cacheStyleGuide', { image: 'data:image/jpeg;base64,/9j/', guide: 'Headings and nested bullets.' });
  assert.equal(storage.noteStyle.styleGuide, 'Headings and nested bullets.');
  await command('cacheStyleGuide', { image: 'different photo', guide: 'Wrong style' });
  assert.equal(storage.noteStyle.styleGuide, 'Headings and nested bullets.');
  const invalidImage = await new Promise(resolve => listener({ target: 'recorder', command: 'setStyle', image: 'https://remote/photo.jpg' }, { id: 'test' }, resolve));
  assert.match(invalidImage.error, /Invalid photo/);
  assert.equal(storage.noteStyle.name, 'Notebook.jpg');
  await command('setStyle', { sample: '## Summary\n- Key point', name: 'sample.md' });
  assert.equal(storage.noteStyle.image, undefined);
  assert.equal(storage.noteStyle.name, 'sample.md');
  state = await command('createFolder', { name: 'Course notes' });
  const folderId = state.folders[0].id;
  state = await command('moveFolder', { id, folderId });
  assert.equal(state.current.folderId, folderId);
  assert.equal(records.get(id).folderId, folderId);
  state = await command('renameFolder', { id: folderId, name: 'IME 4403' });
  assert.equal(storage.conversationFolders[0].name, 'IME 4403');
  const failure = await new Promise(resolve => listener({ target: 'recorder', command: 'deleteFolder', id: folderId }, { id: 'test' }, resolve));
  assert.match(failure.error, /Move conversations/);
  state = await command('state'); assert.equal(state.folders.length, 1);
  state = await command('moveFolder', { id, folderId: '' });
  state = await command('deleteFolder', { id: folderId });
  assert.equal(state.folders.length, 0); assert.equal(storage.conversationFolders.length, 0);
  assert.equal(records.has(id), true);
  state = await command('createFolder', { name: 'New folder' });
  const newFolderId = state.folders[0].id;
  state = await command('new', { folderId: newFolderId });
  assert.equal(state.current.folderId, newFolderId);
  const secondId = state.current.id;
  await command('start'); now = 18000; await command('pause'); now = 28000;
  state = await command('stop'); assert.equal(state.duration, 3000, 'stopping while paused excludes pause time');
  assert.equal(state.paused, false); assert.equal(state.busy, false); assert.ok(state.audioURL);
  await command('select', { id });
  state = await command('delete', { id }); assert.equal(records.has(id), false); assert.notEqual(state.current.id, id);
  assert.equal(state.current.id, secondId); assert.equal(records.has(secondId), true, 'delete preserves other lectures');
  // A Chrome build without Web Speech must still capture microphone audio.
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { ...context, SpeechRecognition: undefined });
  await command('new');
  state = await command('start'); assert.equal(state.active, true); assert.match(state.warning, /transcription is unavailable/);
  await command('pause'); await command('pause'); state = await command('stop'); assert.ok(state.audioURL);
  await command('new');
  const originalGetUserMedia = context.navigator.mediaDevices.getUserMedia;
  context.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  const deniedMic = await new Promise(resolve => listener({ target: 'recorder', command: 'start' }, { id: 'test' }, resolve));
  assert.equal(deniedMic.code, 'MICROPHONE_PERMISSION_REQUIRED');
  state = await command('state'); assert.equal(state.active, false); assert.equal(state.busy, false);
  context.navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  state = await command('start'); assert.equal(state.active, true); await command('stop');

});
