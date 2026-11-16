import { availability, createLocalSession, generateLocalNotes, generateLocalFlashcards, generateLocalQuiz, explainAIError } from './local-ai.mjs';
const fullView = new URLSearchParams(location.search).get('view') === 'full';
if (fullView) document.body.classList.add('full-view');
import { prepareSampleImage, sampleImageBlob, isSampleImage } from './sample-image.mjs';

const $ = id => document.getElementById(id);
let folderFilter = 'all';
let warmSession, warmImage = false, figureBusy = false, pdfBusy = false, figureKey;
let noteStyle = null, styleLoading = true;
let aiRunning = false, aiTask = null, aiController, aiAvailability = 'checking';
let state, localError = '', listKey, lastAudioURL, editorRevision = 0, dirtyText = false, editSequence = 0;
let flashcardIndex = 0, flashcardFlipped = false, flashcardOrder = [], flashcardDeckKey = '';
let quizIndex = 0, quizSelected = [], quizSubmitted = [], quizFinished = false, quizDeckKey = '';
function showError(text) { localError = text; $('message').textContent = text; $('message').hidden = !text; }
function formatTime(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
async function send(command, data = {}) { try { const response = await chrome.runtime.sendMessage({ target: 'recorder', command, ...data }); if (response?.error) throw new Error(response.error); if (response?.state) { localError = ''; render(response.state); } else throw new Error('Recorder did not respond. Reopen the popup to reconnect.'); return response; } catch (error) { showError(error.message); return null; } }
function render(next) {
  const switched = state?.current?.id !== next.current?.id; state = next; if (!state.current) return;
  const locked = state.active || state.busy || aiRunning || figureBusy || pdfBusy; document.body.classList.toggle('recording', state.active); document.body.classList.toggle('paused', state.paused);
  $('heading').textContent = state.active ? (state.paused ? 'Conversation paused' : 'Listening…') : state.current.hasAudio ? 'Conversation captured' : 'Ready to listen';
  $('status').textContent = state.status; $('timer').textContent = formatTime(state.duration); $('microphone').textContent = state.active ? state.paused ? 'Microphone paused' : 'Microphone connected' : 'Microphone ready when you are';
  $('record').hidden = state.active; $('record').disabled = locked || state.current.hasAudio; $('record').textContent = state.current.hasAudio ? '✓ Saved · create a new conversation' : '● Start recording'; $('pause').hidden = !state.active; $('pause').disabled = state.busy; $('pause').textContent = state.paused ? '▶ Resume' : 'Ⅱ Pause'; $('stop').hidden = !state.active; $('stop').disabled = state.busy;
  for (const id of ['new', 'delete', 'language']) $(id).disabled = locked; for (const id of ['title', 'transcript', 'notes']) $(id).disabled = aiRunning || figureBusy || pdfBusy; $('export').disabled = false; $('generate').disabled = aiRunning || styleLoading || figureBusy || pdfBusy || state.active || state.busy; $('generate').textContent = aiTask === 'notes' ? 'Generating notes…' : '✦ Generate PDF notes'; $('upload-style').disabled = aiRunning || styleLoading || figureBusy || pdfBusy; $('clear-style').disabled = aiRunning || styleLoading || figureBusy; $('add-figure').disabled = locked; $('download-pdf').disabled = aiRunning || figureBusy || pdfBusy || !state.current.notes?.trim();
  $('generate-flashcards').disabled = aiRunning || figureBusy || pdfBusy || state.active || state.busy || !state.current.text?.trim() || !state.current.notes?.trim(); $('generate-flashcards').textContent = aiTask === 'flashcards' ? 'Generating flashcards…' : state.current.flashcards?.length ? '↻ Regenerate set' : '✦ Generate flashcards'; renderFigures(); renderFlashcards(switched);
  $('generate-quiz').disabled = aiRunning || figureBusy || pdfBusy || state.active || state.busy || !state.current.text?.trim() || !state.current.notes?.trim(); $('generate-quiz').textContent = aiTask === 'quiz' ? 'Generating quiz…' : state.current.quiz?.length ? '↻ Regenerate quiz' : '✦ Create quiz'; renderQuiz(switched);
  const values = { title: state.current.title, transcript: state.current.text, notes: state.current.notes || '', language: state.current.language };
  for (const [id, value] of Object.entries(values)) { const element = $(id); if (switched || (document.activeElement !== element && !(id === 'transcript' && dirtyText))) { element.value = value; if (id === 'transcript') editorRevision = state.transcriptRevision; } else if (id === 'transcript' && !dirtyText && element.value !== value) { const selection = [element.selectionStart, element.selectionEnd]; element.value = value; element.setSelectionRange(...selection); editorRevision = state.transcriptRevision; } }
  $('interim').textContent = state.interim; $('saved').textContent = state.saved; const text = $('transcript').value.trim(); $('words').textContent = `${text ? text.split(/\s+/).length : 0} words`; $('message').textContent = localError || state.warning; $('message').hidden = !(localError || state.warning); $('setup').hidden = true;
  if (lastAudioURL !== state.audioURL) { lastAudioURL = state.audioURL; if (lastAudioURL) $('audio').src = lastAudioURL; else { $('audio').removeAttribute('src'); $('audio').load(); } } $('audio-area').hidden = !state.audioURL;
  const folders = state.folders || [];
  if (folderFilter !== 'all' && folderFilter !== '' && !folders.some(folder => folder.id === folderFilter)) folderFilter = 'all';
  for (const [id, all] of [['folder-filter', true], ['conversation-folder', false]]) {
    const select = $(id); select.replaceChildren();
    const options = [...(all ? [{ id: 'all', name: 'All conversations' }] : []), { id: '', name: 'Unfiled' }, ...folders];
    for (const folder of options) { const option = document.createElement('option'); option.value = folder.id; option.textContent = folder.name; select.append(option); }
    select.value = all ? folderFilter : state.current.folderId || ''; select.disabled = locked;
  }
  $('create-folder').disabled = locked;
  const selectedFolder = folders.find(folder => folder.id === folderFilter);
  for (const id of ['rename-folder', 'delete-folder']) { $(id).hidden = !selectedFolder; $(id).disabled = locked; }
  const visible = state.sessions.filter(item => folderFilter === 'all' || (item.folderId || '') === folderFilter);
  $('library-empty').hidden = visible.length > 0;
  const key = JSON.stringify([visible, state.current.id, locked, folders]); if (key !== listKey) { listKey = key; $('lectures').replaceChildren(); for (const item of visible) { const button = document.createElement('button'); button.disabled = locked; button.className = item.id === state.current.id ? 'active' : ''; const title = document.createElement('strong'); title.textContent = item.title || 'Untitled conversation'; const date = document.createElement('small'); date.textContent = new Date(item.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); button.append(title, date); button.onclick = () => send('select', { id: item.id }); $('lectures').append(button); } }
}
function renderFlashcards(switched = false) {
  const cards = state?.current?.flashcards || [];
  const key = JSON.stringify(cards);
  if (switched || key !== flashcardDeckKey) {
    flashcardDeckKey = key; flashcardOrder = cards.map((_, index) => index); flashcardIndex = 0; flashcardFlipped = false;
  }
  const stale = cards.length > 0 && state.current.flashcardsRevision !== state.current.studyRevision;
  $('flashcards-status').classList.toggle('stale', stale);
  if (aiTask !== 'flashcards') $('flashcards-status').textContent = stale
    ? 'Your transcript or notes changed after this set was made. You can keep studying it, or regenerate it to refresh the cards.'
    : cards.length ? `${cards.length} cards · based on the transcript and notes.`
      : 'Create a study set from this conversation’s transcript and notes.';
  $('flashcard-study').hidden = cards.length === 0;
  if (!cards.length) return;
  const orderPosition = Math.min(flashcardIndex, flashcardOrder.length - 1);
  const card = cards[flashcardOrder[orderPosition]];
  $('flashcard-label').textContent = flashcardFlipped ? 'ANSWER' : 'TERM / QUESTION';
  $('flashcard-text').textContent = flashcardFlipped ? card.back : card.front;
  $('flashcard-hint').textContent = flashcardFlipped ? 'Click card to return to the prompt' : 'Click card to reveal the answer';
  $('flashcard-card').classList.toggle('is-flipped', flashcardFlipped);
  $('flashcard-card').setAttribute('aria-pressed', String(flashcardFlipped));
  $('flashcard-card').setAttribute('aria-label', `${flashcardFlipped ? 'Answer' : 'Question'} ${orderPosition + 1} of ${cards.length}. Click to flip.`);
  $('flashcard-count').textContent = `Card ${orderPosition + 1} of ${cards.length}`;
  $('flashcard-side').textContent = flashcardFlipped ? 'Answer' : 'Front';
  $('flashcard-prev').disabled = cards.length < 2;
  $('flashcard-next').disabled = cards.length < 2;
}
function renderQuiz(switched = false) {
  const questions = state?.current?.quiz || [];
  const key = JSON.stringify(questions);
  if (switched || key !== quizDeckKey) {
    quizDeckKey = key; quizIndex = 0; quizSelected = questions.map(() => null); quizSubmitted = questions.map(() => false); quizFinished = false;
  }
  const stale = questions.length > 0 && state.current.quizRevision !== state.current.studyRevision;
  $('quiz-status').classList.toggle('stale', stale);
  if (aiTask !== 'quiz') $('quiz-status').textContent = stale
    ? 'Your transcript or notes changed after this quiz was made. You can keep using it, or regenerate it to refresh the questions.'
    : questions.length ? `${questions.length} questions · multiple choice and true/false.`
      : 'Create multiple-choice and true/false questions from this conversation’s transcript and notes.';
  $('quiz-game').hidden = questions.length === 0;
  if (!questions.length) return;
  const totalCorrect = questions.reduce((total, question, index) => total + (quizSubmitted[index] && quizSelected[index] === question.answerIndex ? 1 : 0), 0);
  $('quiz-score').textContent = `Score: ${totalCorrect} / ${quizSubmitted.filter(Boolean).length}`;
  $('quiz-results').hidden = !quizFinished;
  if (quizFinished) {
    $('quiz-result-score').textContent = `${totalCorrect} / ${questions.length}`;
    $('quiz-result-message').textContent = totalCorrect === questions.length ? 'Perfect score! You got every question right.' : `You answered ${totalCorrect} of ${questions.length} correctly. Retake the quiz to try again.`;
    $('quiz-count').textContent = 'Quiz complete';
    $('quiz-question').hidden = true; $('quiz-options').hidden = true; $('quiz-feedback').hidden = true;
    $('quiz-prev').hidden = true; $('quiz-submit').hidden = true; $('quiz-next').hidden = true;
    return;
  }
  $('quiz-question').hidden = false; $('quiz-options').hidden = false; $('quiz-prev').hidden = false; $('quiz-submit').hidden = false; $('quiz-next').hidden = false;
  const index = Math.min(quizIndex, questions.length - 1), question = questions[index], submitted = quizSubmitted[index];
  $('quiz-count').textContent = `Question ${index + 1} of ${questions.length} · ${question.type === 'true_false' ? 'True or false' : 'Multiple choice'}`;
  $('quiz-question').textContent = question.prompt;
  $('quiz-options').replaceChildren();
  question.choices.forEach((choice, choiceIndex) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiz-option';
    button.textContent = question.type === 'multiple_choice' ? `${String.fromCharCode(65 + choiceIndex)}. ${choice}` : choice;
    button.setAttribute('aria-pressed', String(quizSelected[index] === choiceIndex));
    if (quizSelected[index] === choiceIndex) button.classList.add('selected');
    if (submitted && choiceIndex === question.answerIndex) button.classList.add('correct');
    if (submitted && quizSelected[index] === choiceIndex && choiceIndex !== question.answerIndex) button.classList.add('incorrect');
    button.disabled = submitted;
    button.onclick = () => { quizSelected[index] = choiceIndex; renderQuiz(); };
    $('quiz-options').append(button);
  });
  $('quiz-feedback').hidden = !submitted;
  $('quiz-feedback').classList.toggle('correct', submitted && quizSelected[index] === question.answerIndex);
  $('quiz-feedback').classList.toggle('incorrect', submitted && quizSelected[index] !== question.answerIndex);
  if (submitted) {
    const result = quizSelected[index] === question.answerIndex ? 'Correct!' : `Not quite. The correct answer is ${question.choices[question.answerIndex]}.`;
    $('quiz-feedback').textContent = `${result}${question.explanation ? ` ${question.explanation}` : ''}`;
  }
  $('quiz-prev').disabled = index === 0;
  $('quiz-submit').disabled = submitted || quizSelected[index] === null;
  $('quiz-submit').textContent = submitted ? 'Answer checked' : 'Check answer';
  $('quiz-next').textContent = index === questions.length - 1 ? 'See results →' : 'Next →';
  $('quiz-next').disabled = index === questions.length - 1 && !quizSubmitted.every(Boolean);
}
$('upload-style').onclick = () => $('style-file').click();
$('folder-filter').onchange = event => { folderFilter = event.target.value; render(state); };
$('conversation-folder').onchange = event => send('moveFolder', { id: state.current.id, folderId: event.target.value });
$('create-folder').onclick = async () => {
  const name = prompt('Folder name:'); if (name === null) return;
  const previous = new Set((state.folders || []).map(folder => folder.id));
  const response = await send('createFolder', { name });
  const created = response?.state.folders.find(folder => !previous.has(folder.id));
  if (created) { folderFilter = created.id; render(state); }
};
$('rename-folder').onclick = () => {
  const folder = state.folders.find(folder => folder.id === folderFilter); if (!folder) return;
  const name = prompt('Rename folder:', folder.name); if (name !== null) send('renameFolder', { id: folder.id, name });
};
$('delete-folder').onclick = () => {
  const folder = state.folders.find(folder => folder.id === folderFilter); if (!folder) return;
  if (state.sessions.some(item => item.folderId === folder.id)) { showError('Move conversations out of this folder before deleting it.'); return; }
  if (confirm('Delete the empty folder “' + folder.name + '”?')) send('deleteFolder', { id: folder.id });
};
function edit(field) { if (!state) return; const sequence = ++editSequence; if (field === 'text') dirtyText = true; const id = field === 'text' ? 'transcript' : field; send('edit', { id: state.current.id, [field]: $(id).value, revision: editorRevision }).finally(() => { if (sequence === editSequence) { dirtyText = false; if (state) render(state); } }); }
$('title').oninput = () => edit('title'); $('transcript').oninput = () => edit('text'); $('notes').oninput = () => edit('notes'); $('language').onchange = () => edit('language'); $('record').onclick = startBackgroundRecording; $('pause').onclick = () => send('pause'); $('stop').onclick = () => send('stop'); $('new').onclick = () => send('new', { folderId: folderFilter === 'all' ? '' : folderFilter }); $('generate').onclick = runLocalAI;
$('generate-flashcards').onclick = runLocalFlashcards;
$('open-full-view').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=full') });
$('flashcard-card').onclick = () => { flashcardFlipped = !flashcardFlipped; renderFlashcards(); };
$('flashcard-prev').onclick = () => { if (!flashcardOrder.length) return; flashcardIndex = (flashcardIndex - 1 + flashcardOrder.length) % flashcardOrder.length; flashcardFlipped = false; renderFlashcards(); };
$('flashcard-next').onclick = () => { if (!flashcardOrder.length) return; flashcardIndex = (flashcardIndex + 1) % flashcardOrder.length; flashcardFlipped = false; renderFlashcards(); };
$('flashcard-shuffle').onclick = () => { for (let i = flashcardOrder.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [flashcardOrder[i], flashcardOrder[j]] = [flashcardOrder[j], flashcardOrder[i]]; } flashcardIndex = 0; flashcardFlipped = false; renderFlashcards(); };
$('export-flashcards').onclick = () => {
  const cards = state?.current?.flashcards || []; if (!cards.length) return;
  const lines = [`${state.current.title || 'Flashcard set'}`, `${cards.length} cards`, ''];
  cards.forEach((card, index) => lines.push(`${index + 1}. ${card.front}`, card.back, ''));
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  download(url, `${filename()}-flashcards.txt`); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('generate-quiz').onclick = runLocalQuiz;
$('quiz-prev').onclick = () => { if (quizIndex > 0) { quizIndex--; renderQuiz(); } };
$('quiz-submit').onclick = () => { if (quizSelected[quizIndex] !== null) { quizSubmitted[quizIndex] = true; renderQuiz(); } };
$('quiz-next').onclick = () => {
  const questions = state?.current?.quiz || [];
  if (quizIndex < questions.length - 1) { quizIndex++; renderQuiz(); }
  else if (quizSubmitted.length && quizSubmitted.every(Boolean)) { quizFinished = true; renderQuiz(); }
};
$('quiz-retake').onclick = () => { quizIndex = 0; quizSelected = (state?.current?.quiz || []).map(() => null); quizSubmitted = (state?.current?.quiz || []).map(() => false); quizFinished = false; renderQuiz(); };
$('delete').onclick = () => { if (state && confirm(`Delete “${state.current.title || 'Untitled conversation'}” and its audio permanently from this device?`)) send('delete', { id: state.current.id }); }; $('setup').onclick = startBackgroundRecording;
async function extractPdfText(file) {
  const pdfjsLib = await import('./vendor/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');
  $('style-status').textContent = 'Opening PDF…';
  const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useWorkerFetch: false });
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      task.destroy().catch(() => {});
      reject(new Error('PDF reading took longer than 30 seconds. Try a smaller PDF or upload a TXT/Markdown sample.'));
    }, 30000);
  });
  try {
    const document = await Promise.race([task.promise, timeout]);
    const pages = Math.min(document.numPages, 30);
    const output = [];
    let previewImage = '';
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      $('style-status').textContent = `Reading your notes sample… page ${pageNumber} of ${pages}${document.numPages > pages ? ` (of ${document.numPages})` : ''}`;
      const page = await Promise.race([document.getPage(pageNumber), timeout]);
      if (pageNumber === 1) {
        const viewport = page.getViewport({ scale: Math.min(1.5, 1200 / Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1])) });
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (context) {
          await Promise.race([page.render({ canvasContext: context, viewport }).promise, timeout]);
          for (const quality of [0.78, 0.62, 0.48]) {
            const candidate = canvas.toDataURL('image/jpeg', quality);
            if (isSampleImage(candidate)) { previewImage = candidate; break; }
          }
        }
      }
      const content = await Promise.race([page.getTextContent(), timeout]);
      const lines = []; let line = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) { lines.push(line); line = ''; }
        else line += ' ';
      }
      if (line.trim()) lines.push(line);
      output.push(lines.join('\n'));
      if (output.join('\n').length > 250000) break;
    }
    if (document.numPages > pages) $('style-status').textContent = `Read the first ${pages} pages of your notes sample.`;
    return { text: output.join('\n\n').slice(0, 250000).trim(), previewImage };
  } finally {
    clearTimeout(timeoutId);
    task.destroy().catch(() => {});
  }
}
$('style-file').onchange = async event => {
  const file = event.target.files[0]; if (!file || aiRunning || styleLoading || figureBusy || pdfBusy) return;
  if (file.size > 10000000) { showError('Please choose a photo, PDF, or text sample smaller than 10 MB.'); event.target.value = ''; return; }
  try {
    styleLoading = true; render(state);
    showError(''); $('style-status').textContent = 'Reading your notes sample…';
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
      const image = await prepareSampleImage(file);
      if (await send('setStyle', { image, name: file.name })) { noteStyle = { image, name: file.name, sample: '' }; renderStyleSample(); await checkLocalAI(); }
      return;
    }
    const extracted = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? await extractPdfText(file) : { text: await file.text(), previewImage: '' };
    const sample = extracted.text.slice(0, 250000);
    if (!sample.trim()) throw new Error('No selectable text was found. If this is a scanned PDF, use a text-based PDF or OCR it first.');
    const styleData = { sample, name: file.name };
    if (extracted.previewImage) styleData.image = extracted.previewImage;
    const response = await send('setStyle', styleData);
    if (response) { noteStyle = { sample, image: extracted.previewImage || '', name: file.name }; renderStyleSample(); await checkLocalAI(); }
  } catch (error) { showError(`Could not read this notes sample: ${error.message}`); renderStyleSample(); }
  finally { event.target.value = ''; styleLoading = false; if (state) render(state); }
};
function filename() { return (state.current.title || 'conversation').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100); } function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
$('export').onclick = () => { if (!state) return; const url = URL.createObjectURL(new Blob([`${$('title').value}\n${new Date(state.current.created).toLocaleString()}\n\nTRANSCRIPT\n${$('transcript').value}\n\nNOTES\n${$('notes').value}\n`], { type: 'text/plain;charset=utf-8' })); download(url, `${filename()}.txt`); setTimeout(() => URL.revokeObjectURL(url), 1000); }; $('download-audio').onclick = () => { if (state?.audioURL) download(state.audioURL, `${filename()}.webm`); }; chrome.runtime.onMessage.addListener(message => { if (message.target === 'popup') render(message.state); });
async function connect() { try { const response = await chrome.runtime.sendMessage({ target: 'background', command: 'connect' }); if (response?.error) throw new Error(response.error); await send('state'); } catch (error) { showError(`Cannot connect to recorder: ${error.message}`); } } connect();


async function checkLocalAI() {
  try {
    const withImage = Boolean(noteStyle?.image && !cachedStyleGuide());
    aiAvailability = await availability(undefined, { image: withImage });
    if (aiRunning) return;
    $('ai-status').textContent = aiAvailability === 'available' ? 'Local AI ready · English notes · no API charges.'
      : aiAvailability === 'unavailable' ? withImage ? 'Local AI image reading is unavailable on this computer. Update Chrome or replace the photo with a text sample. Recording, editing, and export still work.' : 'Local AI is unavailable on this computer. Use current desktop Chrome with supported hardware. Recording, editing, and export still work.'
      : 'Generate notes will start or resume Chrome’s AI model download. English notes are generated on this device with no account or API charges.';
  } catch { if (!aiRunning) $('ai-status').textContent = 'Click Generate notes to check local AI. Chrome may need to download a model.'; }
}

async function runLocalAI() {
  if (!state?.current || aiRunning || styleLoading || figureBusy || pdfBusy) return;
  if (!$('transcript').value.trim()) { showError('Add or record a transcript before generating notes.'); return; }
  if (state.active || state.busy) { showError('Stop and save the recording before generating notes.'); return; }
  if (aiAvailability === 'unavailable') { showError($('ai-status').textContent); return; }
  const captured = { id: state.current.id, transcript: $('transcript').value, title: $('title').value, previousNotes: $('notes').value };
  aiRunning = true; aiTask = 'notes'; aiController = new AbortController();
  const controller = aiController;
  let session, completed = false, learnedStyle, sessionImage;
  const useImage = Boolean(noteStyle?.image && !cachedStyleGuide());
  showError(''); $('notes-live').textContent = ''; $('notes-live').hidden = false; $('cancel-ai').hidden = false; $('cancel-ai').disabled = false; $('ai-progress').hidden = true;
  $('ai-status').textContent = 'Preparing local AI… Chrome may need to download its model. Keep this page open; the full view lets you switch tabs.';
  render(state);
  try {
    // Start in the click's activation context; do not await storage first.
    if (warmSession && useImage && !warmImage) { warmSession.destroy(); warmSession = null; }
    sessionImage = warmSession ? warmImage : useImage;
    const starting = warmSession || createLocalSession({ signal: controller.signal, image: useImage, onProgress(percent) {
      $('ai-progress').hidden = percent >= 100; $('ai-progress').value = percent;
      $('ai-status').textContent = percent >= 100 ? 'Starting local AI…' : 'Downloading local AI model… ' + percent + '% · keep this page open.';
    } });
    session = await starting;
    controller.signal.throwIfAborted(); $('ai-progress').hidden = true;
    const notes = await generateLocalNotes(session, { ...captured, sample: noteStyle?.sample || '', sampleImage: useImage ? sampleImageBlob(noteStyle.image) : undefined, styleGuide: cachedStyleGuide(), signal: controller.signal, onStyleGuide(guide) { learnedStyle = guide; }, onPartial(text) { $('notes-live').textContent = text; }, onStatus(text) { $('ai-status').textContent = text; } });
    controller.signal.throwIfAborted();
    $('cancel-ai').disabled = true;
    const response = await send('applyGeneratedNotes', { ...captured, notes });
    $('ai-status').textContent = response ? 'AI notes saved locally. Review them for accuracy.' : 'Could not save AI notes. Your existing notes have been kept.';
    if (response) {
      completed = true;
      if (learnedStyle && learnedStyle.length <= 3000) {
        const cached = await send('cacheStyleGuide', { image: noteStyle?.image || '', sample: noteStyle?.sample || '', guide: learnedStyle });
        if (cached) noteStyle = { ...noteStyle, styleGuide: learnedStyle, styleGuideVersion: 2 };
      }
      try { $('ai-status').textContent = 'Creating your PDF…'; await downloadCurrentPDF(); $('ai-status').textContent = 'PDF downloaded. Editable notes and attached images are saved locally.'; }
      catch (error) { showError('Notes were saved, but the PDF could not be created: ' + error.message); }
    }
    aiAvailability = 'available';
  } catch (error) { const text = explainAIError(error); showError(text); $('ai-status').textContent = text; }
  finally {
    if (completed) { warmSession = session; warmImage = sessionImage; } else { session?.destroy(); warmSession = null; }
    aiRunning = false; aiTask = null; aiController = null; $('notes-live').hidden = true;
    $('cancel-ai').hidden = true; $('ai-progress').hidden = true;
    if (state) render(state);
  }
}
async function runLocalFlashcards() {
  if (!state?.current || aiRunning || figureBusy || pdfBusy) return;
  const transcript = $('transcript').value, notes = $('notes').value;
  if (!transcript.trim()) { showError('Add or record a transcript before generating flashcards.'); return; }
  if (!notes.trim()) { showError('Generate or write notes before generating flashcards.'); return; }
  if (state.active || state.busy) { showError('Stop and save the recording before generating flashcards.'); return; }
  const captured = { id: state.current.id, transcript, notes, title: $('title').value };
  aiRunning = true; aiTask = 'flashcards'; aiController = new AbortController();
  const controller = aiController;
  let session, sessionImage = false, completed = false;
  showError(''); $('cancel-ai').hidden = false; $('cancel-ai').disabled = false; $('ai-progress').hidden = true;
  $('flashcards-status').textContent = 'Preparing local AI. This page can stay open in a tab while you work elsewhere.';
  render(state);
  try {
    if (warmSession) { session = warmSession; sessionImage = warmImage; warmSession = null; warmImage = false; }
    else {
      // Create directly from the click so Chrome can start or download its model.
      const starting = createLocalSession({ task: 'flashcards', signal: controller.signal, onProgress(percent) {
        $('ai-progress').hidden = percent >= 100; $('ai-progress').value = percent;
        const status = percent >= 100 ? 'Starting local AI…' : 'Downloading local AI model… ' + percent + '% · keep this page open.';
        $('flashcards-status').textContent = status;
      } });
      session = await starting;
    }
    controller.signal.throwIfAborted(); $('ai-progress').hidden = true;
    const flashcards = await generateLocalFlashcards(session, { ...captured, signal: controller.signal,
      onStatus(text) { $('flashcards-status').textContent = text; } });
    controller.signal.throwIfAborted(); $('cancel-ai').disabled = true;
    const response = await send('applyGeneratedFlashcards', { ...captured, flashcards });
    if (response) {
      $('flashcards-status').textContent = `${flashcards.length} flashcards created. Click a card to reveal its answer.`;
      completed = true;
    }
    aiAvailability = 'available';
  } catch (error) {
    const text = explainAIError(error); showError(text);
    $('flashcards-status').textContent = text;
  } finally {
    if (completed) { warmSession = session; warmImage = sessionImage; } else session?.destroy();
    aiRunning = false; aiTask = null; aiController = null; $('cancel-ai').hidden = true; $('ai-progress').hidden = true;
    if (state) render(state);
  }
}
async function runLocalQuiz() {
  if (!state?.current || aiRunning || figureBusy || pdfBusy) return;
  const transcript = $('transcript').value, notes = $('notes').value;
  if (!transcript.trim()) { showError('Add or record a transcript before generating a quiz.'); return; }
  if (!notes.trim()) { showError('Generate or write notes before generating a quiz.'); return; }
  if (state.active || state.busy) { showError('Stop and save the recording before generating a quiz.'); return; }
  const captured = { id: state.current.id, transcript, notes, title: $('title').value };
  aiRunning = true; aiTask = 'quiz'; aiController = new AbortController();
  const controller = aiController;
  let session, sessionImage = false, completed = false;
  showError(''); $('cancel-ai').hidden = false; $('cancel-ai').disabled = false; $('ai-progress').hidden = true;
  $('quiz-status').textContent = 'Preparing local AI. This page can stay open in a tab while you work elsewhere.';
  render(state);
  try {
    if (warmSession) { session = warmSession; sessionImage = warmImage; warmSession = null; warmImage = false; }
    else {
      // Create directly from the click so Chrome can start or download its model.
      const starting = createLocalSession({ task: 'quiz', signal: controller.signal, onProgress(percent) {
        $('ai-progress').hidden = percent >= 100; $('ai-progress').value = percent;
        const status = percent >= 100 ? 'Starting local AI…' : 'Downloading local AI model… ' + percent + '% · keep this page open.';
        $('quiz-status').textContent = status;
      } });
      session = await starting;
    }
    controller.signal.throwIfAborted(); $('ai-progress').hidden = true;
    const questions = await generateLocalQuiz(session, { ...captured, signal: controller.signal,
      onStatus(text) { $('quiz-status').textContent = text; } });
    controller.signal.throwIfAborted(); $('cancel-ai').disabled = true;
    const response = await send('applyGeneratedQuiz', { ...captured, questions });
    if (response) {
      $('quiz-status').textContent = `${questions.length} questions created. Select an answer and choose Check answer to see feedback.`;
      completed = true;
    }
    aiAvailability = 'available';
  } catch (error) {
    const text = explainAIError(error); showError(text);
    $('quiz-status').textContent = text;
  } finally {
    if (completed) { warmSession = session; warmImage = sessionImage; } else session?.destroy();
    aiRunning = false; aiTask = null; aiController = null;
    $('cancel-ai').hidden = true; $('ai-progress').hidden = true;
    if (state) render(state);
  }
}
$('cancel-ai').onclick = () => aiController?.abort();
window.addEventListener('pagehide', () => { aiController?.abort(); warmSession?.destroy(); warmSession = null; });
loadStyleSample();

function renderStyleSample() {
  const image = noteStyle?.image;
  $('sample-preview').hidden = !isSampleImage(image);
  if (image && isSampleImage(image)) $('sample-image').src = image;
  else $('sample-image').removeAttribute('src');
  $('sample-caption').textContent = noteStyle?.name || 'Notebook photo';
  $('clear-style').hidden = !image && !noteStyle?.sample;
  $('style-status').textContent = cachedStyleGuide() ? 'Photo style is cached locally and will be reused for faster generation.' : image ? 'Photo saved locally. Generate notes will inspect its headings, lists and drawing structure. Use a clear, well-lit photo of one page.'
    : noteStyle?.sample ? 'Sample saved: ' + (noteStyle.name || 'Text notes') + '. Generate notes will use its structure.'
    : 'Upload a JPG, PNG, or WebP notebook photo, drawing, or text-based PDF/TXT/Markdown sample. Notes remain editable text; handwriting and drawings are approximated with text structure.';
}
async function loadStyleSample() {
  try {
    const response = await chrome.runtime.sendMessage({ target: 'background', command: 'storageGet', key: 'noteStyle' });
    if (!response || response.error) throw new Error(response?.error || 'Could not load your saved sample. Reopen the popup to retry.');
    noteStyle = response.data.noteStyle || null;
    if (noteStyle?.image && !isSampleImage(noteStyle.image)) throw new Error('Your saved photo could not be read. Replace or remove the sample.');
    renderStyleSample(); await checkLocalAI();
  } catch (error) { renderStyleSample(); showError(error.message); }
  finally { styleLoading = false; if (state) render(state); }
}
$('clear-style').onclick = async () => {
  if (aiRunning || styleLoading || figureBusy || pdfBusy) return;
  styleLoading = true; if (state) render(state);
  try { if (await send('setStyle', { sample: '' })) { noteStyle = null; renderStyleSample(); await checkLocalAI(); } }
  finally { styleLoading = false; if (state) render(state); }
};

let startingRecording = false;
async function startBackgroundRecording() {
  if (!state?.current || state.active || state.busy || aiRunning || figureBusy || pdfBusy || startingRecording) return;
  startingRecording = true; $('record').disabled = true; showError('');
  try {
    const response = await chrome.runtime.sendMessage({ target: 'background', command: 'startRecording', id: state.current.id });
    if (!response || response.error) throw new Error(response?.error || 'Background recorder did not respond.');
    if (response.state) render(response.state);
    if (response.permissionPending) showError('Approve Chrome’s microphone prompt in the small permission window. Background recording will start automatically.');
  } catch (error) { showError(error.message); }
  finally { startingRecording = false; if (state) render(state); }
}

function cachedStyleGuide() { return noteStyle?.styleGuideVersion === 2 ? noteStyle.styleGuide || '' : ''; }
async function downloadCurrentPDF() {
  if (!state?.current.notes?.trim()) throw new Error('Generate or write notes first.');
  const current = { ...structuredClone(state.current), notes: $('notes').value, title: $('title').value || 'Conversation notes' };
  const { makeNotesPDF } = await import('./notes-pdf.mjs');
  const blob = await makeNotesPDF({ title: current.title || 'Conversation notes', notes: current.notes, figures: current.figures || [], created: current.created, styleProfile: cachedStyleGuide() });
  const url = URL.createObjectURL(blob); download(url, filename() + '-notes.pdf');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('download-pdf').onclick = async () => {
  if (pdfBusy || aiRunning || figureBusy) return;
  pdfBusy = true; render(state);
  try { await downloadCurrentPDF(); } catch (error) { showError(error.message); }
  finally { pdfBusy = false; if (state) render(state); }
};
$('add-figure').onclick = () => $('figure-file').click();
$('figure-file').onchange = async event => {
  const file = event.target.files[0]; if (!file || !state || aiRunning || figureBusy) return;
  const id = state.current.id, figures = state.current.figures || [];
  if (figures.length >= 4) { showError('Attach up to four images per conversation.'); event.target.value = ''; return; }
  figureBusy = true; render(state);
  try {
    if (file.size > 10000000) throw new Error('Choose an image smaller than 10 MB.');
    const image = await prepareSampleImage(file);
    await send('setFigures', { id, figures: [...figures, { image, caption: file.name.replace(/\.[^.]+$/, '').slice(0, 240) }] });
  } catch (error) { showError(error.message); }
  finally { figureBusy = false; event.target.value = ''; if (state) render(state); }
};
function renderFigures() {
  const figures = state.current.figures || [];
  const locked = aiRunning || figureBusy || pdfBusy || state.active || state.busy;
  const key = JSON.stringify([state.current.id, figures, locked]);
  if (key === figureKey) return; figureKey = key;
  $('figures').replaceChildren();
  figures.forEach((figure, index) => {
    const wrapper = document.createElement('figure'); wrapper.className = 'note-figure';
    const image = document.createElement('img'); image.src = figure.image; image.alt = figure.caption || 'Attached figure';
    const caption = document.createElement('input'); caption.value = figure.caption; caption.maxLength = 240; caption.disabled = locked;
    caption.setAttribute('aria-label', 'Figure ' + (index + 1) + ' caption');
    caption.onchange = () => send('setFigures', { id: state.current.id, figures: figures.map((item, i) => i === index ? { ...item, caption: caption.value } : item) });
    const remove = document.createElement('button'); remove.textContent = 'Remove image'; remove.className = 'small danger'; remove.disabled = locked;
    remove.onclick = () => send('setFigures', { id: state.current.id, figures: figures.filter((_, i) => i !== index) });
    wrapper.append(image, caption, remove); $('figures').append(wrapper);
  });
}
