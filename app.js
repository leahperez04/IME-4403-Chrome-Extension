// Persistent recording engine. Only runtime messaging is used from this offscreen document.
// Offscreen documents expose runtime messaging only; storage lives in the worker.
const localStore = {
  async get(key) {
    const response = await chrome.runtime.sendMessage({ target: 'background', command: 'storageGet', key });
    if (!response || response.error) throw new Error(response?.error || 'Local storage did not respond.');
    return response.data;
  },
  async set(values) {
    const response = await chrome.runtime.sendMessage({ target: 'background', command: 'storageSet', values });
    if (!response || response.error) throw new Error(response?.error || 'Local storage did not respond.');
  }
};
const Speech = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
let folders = [];
let db, sessions = [], current, stream, recorder, recognition, audioURL;
let active = false, paused = false, busy = false, elapsed = 0, since = 0;
let status = 'Ready to record', warning = '', interim = '', saved = 'Saved locally';
let restartTimer, generation = 0, recognitionFailures = 0, pendingWrites = Promise.resolve(), stopDone;
let transcriptRevision = 0, speechEdits = [];
const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
function transaction(operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readwrite'); operation(tx.objectStore('lectures'));
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
function duration() { return elapsed + (active && !paused ? Date.now() - since : 0); }
function snapshot() {
  return { current: current && { id: current.id, title: current.title, text: current.text, notes: current.notes || '', figures: current.figures || [], flashcards: current.flashcards || [], flashcardsRevision: current.flashcardsRevision ?? -1, quiz: current.quiz || [], quizRevision: current.quizRevision ?? -1, studyRevision: current.studyRevision || 0, language: current.language, created: current.created, folderId: current.folderId || '', hasAudio: Boolean(current.audio) },
    folders, sessions: sessions.map(({ id, title, created, folderId }) => ({ id, title, created, folderId: folderId || '' })),
    active, paused, busy, status, warning, interim, saved, duration: duration(), audioURL, transcriptRevision };
}
function broadcast() {
  chrome.runtime.sendMessage({ target: 'popup', state: snapshot() }).catch(() => {});
}
function indicator() {
  chrome.runtime.sendMessage({ target: 'background', command: 'indicator', active, paused }).catch(() => {});
}
function save() {
  const data = structuredClone(current); saved = 'Saving…';
  const write = pendingWrites.catch(() => {}).then(() => transaction(store => store.put(data)));
  pendingWrites = write;
  write.then(() => { if (write === pendingWrites) saved = 'Saved locally'; broadcast(); }, () => {
    saved = 'Save failed'; warning = 'Local storage could not save this lecture. Export text and download audio before closing Chrome.'; broadcast();
  });
  return write;
}
function setAudio() {
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = current.audio ? URL.createObjectURL(current.audio) : null;
}
function select(lecture) {
  current = lecture; elapsed = lecture.duration || 0; warning = ''; interim = '';
  transcriptRevision = 0; speechEdits = [];
  status = lecture.audio ? 'Recording saved' : 'Ready to record'; setAudio(); broadcast();
}
async function newLecture(folderId = '') {
  const lecture = { id: crypto.randomUUID(), title: '', text: '', notes: '', flashcards: [], flashcardsRevision: -1, quiz: [], quizRevision: -1, studyRevision: 0, language: 'en-US', folderId, created: Date.now(), duration: 0, audio: null };
  sessions.unshift(lecture); select(lecture); await save();
}
function haltRecognition() {
  generation++; clearTimeout(restartTimer); interim = '';
  if (recognition) { recognition.onend = null; recognition.abort(); recognition = null; }
}
function restartRecognition(token, delay = 500) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    // A recognition object that has ended is not reliably restartable in Chrome.
    // Start a new session instead; the recorder and its transcript stay intact.
    restartTimer = null;
    if (token !== generation || !active || paused) return;
    recognition = null;
    startRecognition();
  }, delay);
}
function startRecognition() {
  const token = ++generation;
  const speech = new Speech(); recognition = speech;
  speech.lang = current.language; speech.continuous = true; speech.interimResults = true;
  let fatal = false;
  speech.onresult = event => {
    if (token !== generation || !active || paused) return;
    interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        recognitionFailures = 0;
        speechEdits.push({ revision: ++transcriptRevision, text: result[0].transcript });
        current.text += `${current.text && !/\s$/.test(current.text) ? ' ' : ''}${result[0].transcript}`;
        current.studyRevision = (current.studyRevision || 0) + 1;
        save().catch(() => {});
      } else interim += result[0].transcript;
    }
    broadcast();
  };
  speech.onerror = event => {
    if (token !== generation || !active || paused || event.error === 'aborted') return;
    if (['not-allowed', 'service-not-allowed'].includes(event.error)) {
      fatal = true; status = 'Recording · transcription unavailable';
      warning = `Live transcription was denied (${event.error}). Audio is still recording. Check Chrome microphone permission, then pause and resume to retry.`; broadcast();
      return;
    }
    recognitionFailures++;
    status = 'Recording · reconnecting transcription';
    const delay = Math.min(15000, 750 * 2 ** Math.min(recognitionFailures, 4));
    warning = event.error === 'no-speech'
      ? 'No speech detected. Keeping live transcription ready…'
      : `Live transcription paused (${event.error}). Audio is still recording; retrying in ${Math.ceil(delay / 1000)} seconds.`;
    restartRecognition(token, delay); broadcast();
  };
  speech.onend = () => {
    if (token !== generation) return;
    interim = ''; broadcast();
    if (active && !paused && !fatal && !restartTimer) restartRecognition(token, 500);
  };
  try { speech.start(); } catch {
    recognitionFailures++;
    status = 'Recording · reconnecting transcription';
    warning = 'Speech recognition could not start. Audio is still recording; retrying shortly.';
    restartRecognition(token, Math.min(15000, 750 * 2 ** Math.min(recognitionFailures, 4))); broadcast();
  }
}
async function start() {
  if (active || busy || current.audio) return;
  busy = true; warning = ''; status = 'Connecting microphone…'; broadcast();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    const chunks = [], lecture = current;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      chunks.push(event.data); lecture.audio = new Blob(chunks, { type: recorder.mimeType });
      lecture.duration = duration(); save().catch(() => {});
    };
    recorder.onstop = async () => {
      let persisted = true; await pendingWrites.catch(() => { persisted = false; });
      busy = false; setAudio(); status = persisted ? 'Recording saved' : 'Stopped · download to preserve audio';
      broadcast(); stopDone?.(); stopDone = null;
    };
    recorder.onerror = () => { warning = 'Audio recording failed. Your transcript is still available.'; stop(); };
    stream.getAudioTracks()[0].onended = () => { if (active) { warning = 'Microphone disconnected. Recording stopped.'; stop(); } };
    elapsed = 0; since = Date.now(); active = true; paused = false;
    recorder.start(1000); busy = false; status = 'Recording';
    if (Speech) {
      try { startRecognition(); } catch { warning = 'Live transcription could not start. Audio is still recording in the background.'; }
    } else { warning = 'Live transcription is unavailable in this browser. Audio is still recording in the background.'; }
    indicator(); broadcast();
  } catch (error) {
    active = false; busy = false; stream?.getTracks().forEach(track => track.stop()); status = 'Ready to record';
    const permissionRequired = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name);
    warning = permissionRequired ? 'Microphone approval is needed. Approve Chrome’s microphone prompt to start background recording.'
      : `Cannot record (${error.name}). Check your microphone connection and Chrome’s operating-system microphone permission, then try again.`;
    indicator(); broadcast();
    throw Object.assign(new Error(warning), { code: permissionRequired ? 'MICROPHONE_PERMISSION_REQUIRED' : 'MICROPHONE_FAILED' });
  }
}
function pause() {
  if (!active || busy) return;
  if (!paused) {
    elapsed = duration(); paused = true; recorder.pause(); recorder.requestData();
    stream.getAudioTracks().forEach(track => { track.enabled = false; });
    haltRecognition(); status = 'Paused';
  } else {
    stream.getAudioTracks().forEach(track => { track.enabled = true; });
    recorder.resume(); since = Date.now(); paused = false; warning = ''; status = 'Recording';
    if (Speech) { try { startRecognition(); } catch { warning = 'Live transcription could not resume. Audio is still recording.'; } }
  }
  current.duration = duration(); save().catch(() => {}); indicator(); broadcast();
}
async function stop() {
  if (!active || busy) return;
  elapsed = duration(); active = false; paused = false; busy = true;
  haltRecognition(); current.duration = elapsed; status = 'Saving recording…';
  const stopped = new Promise(resolve => { stopDone = resolve; });
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else { busy = false; stopDone(); stopDone = null; }
  stream?.getTracks().forEach(track => track.stop()); save().catch(() => {}); indicator(); broadcast();
  await stopped;
}
async function init() {
  // Retain the original database name so existing alpha lectures survive the rename.
  const opening = indexedDB.open('lectureleaf', 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('lectures', { keyPath: 'id' });
  db = await request(opening);
  sessions = await request(db.transaction('lectures').objectStore('lectures').getAll());
  const stored = await localStore.get('conversationFolders');
  folders = Array.isArray(stored.conversationFolders) ? stored.conversationFolders : [];
  sessions.sort((a, b) => b.created - a.created);
  if (sessions.length) select(sessions[0]); else await newLecture();
}
function makeStyle(sample = '') {
  const lines = sample.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const bulletLines = lines.filter(line => /^(?:[-*•]|\d+[.)])\s/.test(line));
  const markdownHeadings = lines.filter(line => /^#{1,3}\s+/.test(line));
  const headingCandidates = lines.map(line => line.replace(/^#{1,3}\s+/, '').trim()).filter(line => {
    const words = line.split(/\s+/);
    return !/^(?:[-*•]|\d+[.)])\s/.test(line) && words.length <= 6 && line.length >= 3 && line.length <= 45 && !/[.!?]$/.test(line);
  });
  const inferredHeadings = [...new Set(headingCandidates)].slice(0, 4);
  const uppercaseHeadings = inferredHeadings.filter(line => /[A-Z]/.test(line) && line === line.toUpperCase());
  const bulletChar = bulletLines.find(line => /^[-*•]/.test(line))?.[0] || '-';
  return {
    bullets: bulletLines.length >= Math.max(2, lines.length / 3),
    bulletChar,
    short: lines.length ? lines.reduce((n, line) => n + line.split(/\s+/).length, 0) / lines.length < 14 : true,
    labels: /(?:Action|Next|Todo|Decision|Key|Follow)/i.test(sample),
    sectionLabels: inferredHeadings,
    headingStyle: markdownHeadings.length ? 'markdown' : uppercaseHeadings.length ? 'uppercase' : 'plain',
    sample: sample.slice(0, 250000)
  };
}
function folderName(value, exceptId) {
  const name = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  if (!name) throw new Error('Enter a folder name.');
  if (folders.some(folder => folder.id !== exceptId && folder.name.toLowerCase() === name.toLowerCase())) throw new Error('A folder with that name already exists.');
  return name;
}
const ready = init(); ready.catch(() => {});
let commands = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'recorder') return;
  // Serialize mutations, including stop finalization, to prevent session switching races.
  const run = async () => {
    await ready;
    switch (message.command) {
      case 'state': break;
      case 'start':
        if (message.id && message.id !== current.id) throw new Error('Conversation changed. Return to the extension and start recording again.');
        await start(); break;
      case 'pause': pause(); break;
      case 'stop': await stop(); break;
      case 'new': if (!active && !busy) await newLecture(folders.some(folder => folder.id === message.folderId) ? message.folderId : ''); break;
      case 'select': if (!active && !busy) { const lecture = sessions.find(item => item.id === message.id); if (lecture) select(lecture); } break;
      case 'edit':
        if (message.id !== current.id) break;
        if (typeof message.title === 'string') current.title = message.title.slice(0, 160);
        if (typeof message.text === 'string') {
          if (message.text !== current.text) current.studyRevision = (current.studyRevision || 0) + 1;
          current.text = message.text;
          // Preserve speech arriving after the popup's editable text snapshot.
          for (const edit of speechEdits.filter(item => item.revision > (message.revision ?? transcriptRevision))) {
            current.text += `${current.text && !/\s$/.test(current.text) ? ' ' : ''}${edit.text}`;
          }
        }
        if (typeof message.notes === 'string') {
          const notes = message.notes.slice(0, 30000);
          if (notes !== (current.notes || '')) current.studyRevision = (current.studyRevision || 0) + 1;
          current.notes = notes;
        }
        if (!active && !busy && ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'hi-IN'].includes(message.language)) current.language = message.language;
        await save(); break;
      case 'createFolder': {
        const name = folderName(message.name);
        const folder = { id: crypto.randomUUID(), name };
        const next = [...folders, folder];
        await localStore.set({ conversationFolders: next }); folders = next;
        break;
      }
      case 'renameFolder': {
        if (!folders.some(folder => folder.id === message.id)) throw new Error('Folder no longer exists.');
        const name = folderName(message.name, message.id);
        const next = folders.map(folder => folder.id === message.id ? { ...folder, name } : folder);
        await localStore.set({ conversationFolders: next }); folders = next;
        break;
      }
      case 'deleteFolder': {
        if (sessions.some(item => item.folderId === message.id)) throw new Error('Move conversations out of this folder before deleting it.');
        const next = folders.filter(folder => folder.id !== message.id);
        await localStore.set({ conversationFolders: next }); folders = next;
        break;
      }
      case 'moveFolder':
        if (active || busy || message.id !== current.id) break;
        if (message.folderId !== '' && !folders.some(folder => folder.id === message.folderId)) throw new Error('Folder no longer exists.');
        { const previous = current.folderId; current.folderId = message.folderId;
          try { await save(); } catch (error) { current.folderId = previous; throw error; }
        }
        break;
      case 'setStyle': {
        if (message.image !== undefined) {
          if (typeof message.image !== 'string' || message.image.length > 2000000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(message.image)) throw new Error('Invalid photo sample. Upload a JPG, PNG, or WebP image again.');
          const parsed = makeStyle(typeof message.sample === 'string' ? message.sample : '');
          await localStore.set({ noteStyle: { ...parsed, image: message.image, name: String(message.name || 'Notebook photo').slice(0, 160) } });
        } else {
          await localStore.set({ noteStyle: { ...makeStyle(message.sample || ''), name: String(message.name || '').slice(0, 160) } });
        }
        break;
      }
      case 'applyGeneratedNotes': {
        if (active || busy || message.id !== current.id) throw new Error('Conversation changed. Generate notes again for the open conversation.');
        if (current.text !== message.transcript || (current.notes || '') !== message.previousNotes) throw new Error('The transcript or notes changed during generation. Your edits have been kept; generate again.');
        if (typeof message.notes !== 'string' || !message.notes.trim() || message.notes.length > 30000) throw new Error('AI returned invalid notes. Your existing notes have been kept.');
        const previous = current.notes, previousRevision = current.studyRevision || 0;
        if (message.notes !== (current.notes || '')) current.studyRevision = previousRevision + 1;
        current.notes = message.notes;
        try { await save(); } catch (error) { current.notes = previous; current.studyRevision = previousRevision; throw error; }
        break;
      }
      case 'applyGeneratedFlashcards': {
        if (active || busy || message.id !== current.id) throw new Error('Conversation changed. Generate flashcards again for the open conversation.');
        if (current.text !== message.transcript || (current.notes || '') !== message.notes) throw new Error('The transcript or notes changed during flashcard generation. Your existing study set has been kept; generate again.');
        if (!Array.isArray(message.flashcards) || message.flashcards.length < 2 || message.flashcards.length > 30) throw new Error('AI returned an invalid flashcard set. Your existing study set has been kept.');
        const flashcards = message.flashcards.map(card => {
          if (!card || typeof card.front !== 'string' || typeof card.back !== 'string') throw new Error('AI returned an invalid flashcard. Your existing study set has been kept.');
          const front = card.front.trim().slice(0, 500), back = card.back.trim().slice(0, 1200);
          if (!front || !back) throw new Error('AI returned an empty flashcard. Your existing study set has been kept.');
          return { front, back };
        });
        const previous = { flashcards: current.flashcards, flashcardsRevision: current.flashcardsRevision };
        current.flashcards = flashcards;
        current.flashcardsRevision = current.studyRevision || 0;
        try { await save(); } catch (error) { current.flashcards = previous.flashcards; current.flashcardsRevision = previous.flashcardsRevision; throw error; }
        break;
      }
      case 'applyGeneratedQuiz': {
        if (active || busy || message.id !== current.id) throw new Error('Conversation changed. Generate the quiz again for the open conversation.');
        if (current.text !== message.transcript || (current.notes || '') !== message.notes) throw new Error('The transcript or notes changed during quiz generation. Your existing quiz has been kept; generate again.');
        if (!Array.isArray(message.questions) || message.questions.length < 4 || message.questions.length > 20) throw new Error('AI returned an invalid quiz. Your existing quiz has been kept.');
        const questions = message.questions.map(item => {
          if (!item || !['multiple_choice', 'true_false'].includes(item.type) || typeof item.prompt !== 'string' || !Number.isInteger(item.answerIndex)) throw new Error('AI returned an invalid quiz question. Your existing quiz has been kept.');
          const prompt = item.prompt.trim().slice(0, 600);
          const choices = Array.isArray(item.choices) ? item.choices.map(choice => String(choice).trim().slice(0, 300)) : [];
          const choiceCount = item.type === 'true_false' ? 2 : 4;
          if (!prompt || choices.length !== choiceCount || choices.some(choice => !choice) || item.answerIndex < 0 || item.answerIndex >= choiceCount) throw new Error('AI returned an incomplete quiz question. Your existing quiz has been kept.');
          if (item.type === 'true_false' && (choices[0] !== 'True' || choices[1] !== 'False')) throw new Error('AI returned invalid true/false choices. Your existing quiz has been kept.');
          if (item.type === 'multiple_choice' && new Set(choices.map(choice => choice.toLowerCase())).size !== 4) throw new Error('AI returned duplicate multiple-choice answers. Your existing quiz has been kept.');
          return { type: item.type, prompt, choices, answerIndex: item.answerIndex, explanation: String(item.explanation || '').trim().slice(0, 1000) };
        });
        if (questions.filter(item => item.type === 'multiple_choice').length < 2 || questions.filter(item => item.type === 'true_false').length < 2) throw new Error('The quiz needs both multiple-choice and true/false questions. Your existing quiz has been kept.');
        const previous = { quiz: current.quiz, quizRevision: current.quizRevision };
        current.quiz = questions; current.quizRevision = current.studyRevision || 0;
        try { await save(); } catch (error) { current.quiz = previous.quiz; current.quizRevision = previous.quizRevision; throw error; }
        break;
      }
      case 'cacheStyleGuide': {
        const stored = await localStore.get('noteStyle');
        const style = stored.noteStyle;
        if (style && (style.image || '') === (message.image || '') && (style.sample || '') === (message.sample || '') && typeof message.guide === 'string' && message.guide.trim() && message.guide.length <= 3000) {
          await localStore.set({ noteStyle: { ...style, styleGuide: message.guide, styleGuideVersion: 2 } });
        }
        break;
      }
      case 'setFigures': {
        if (active || busy || message.id !== current.id) throw new Error('Stop recording and select the correct conversation before attaching images.');
        if (!Array.isArray(message.figures) || message.figures.length > 4) throw new Error('Attach up to four images per conversation.');
        const figures = message.figures.map(figure => {
          if (!figure || typeof figure.image !== 'string' || figure.image.length > 2000000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(figure.image)) throw new Error('Invalid image attachment. Upload a JPG, PNG, or WebP image.');
          return { image: figure.image, caption: String(figure.caption || '').slice(0, 240) };
        });
        const previous = current.figures; current.figures = figures;
        try { await save(); } catch (error) { current.figures = previous; throw error; }
        break;
      }
      case 'delete':
        if (active || busy || message.id !== current.id) break;
        await pendingWrites.catch(() => {}); await transaction(store => store.delete(current.id));
        sessions = sessions.filter(item => item.id !== current.id);
        if (sessions.length) select(sessions[0]); else await newLecture(); break;
      default: throw new Error('Unknown recorder command');
    }
    return snapshot();
  };
  commands = commands.catch(() => {}).then(run);
  commands.then(state => reply({ state }), error => reply({ error: error.message, code: error.code }));
  return true;
});
setInterval(() => { if (active) broadcast(); }, 500);
