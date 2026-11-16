import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { availability, createLocalSession, generateLocalNotes, generateLocalQuiz, explainAIError } from '../local-ai.mjs';

import { prepareSampleImage, sampleImageBlob, isSampleImage } from '../sample-image.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

async function popup(model, style = null) {
  const elements = new Map();
  const element = () => ({ value: '', textContent: '', hidden: false, disabled: false, children: [], classList: { toggle() {}, add() {}, remove() {} },
    append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; },
    setAttribute() {}, removeAttribute() {}, load() {}, setSelectionRange() {}, click() {} });
  const html = fs.readFileSync('popup.html', 'utf8');
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  const saved = [];
  const state = { current: { id: 'one', title: 'Meeting', text: 'We approved the budget.', notes: 'Original notes', flashcards: [], flashcardsRevision: -1, quiz: [], quizRevision: -1, studyRevision: 0, language: 'en-US', created: 0 }, folders: [], sessions: [], active: false, busy: false, status: 'Ready', duration: 0, saved: 'Saved locally', interim: '', warning: '', transcriptRevision: 0 };
  const document = { getElementById: id => { assert.ok(elements.has(id), 'unknown ID ' + id); return elements.get(id); }, createElement: element, body: { classList: { toggle() {} } } };
  const context = vm.createContext({
    document, window: { addEventListener() {} }, console, Date, setTimeout, clearTimeout, AbortController, URL, Blob,
    pdfjsLib: { GlobalWorkerOptions: {} },
    availability: (_, options) => availability(model, options),
    prepareSampleImage, sampleImageBlob, isSampleImage,
    createLocalSession: options => createLocalSession({ ...options, model }),
    generateLocalNotes, generateLocalQuiz, explainAIError,
    chrome: { runtime: { getURL: path => path, onMessage: { addListener() {} }, async sendMessage(message) {
      if (message.command === 'connect') return { ok: true };
      if (message.command === 'storageGet') return { data: { noteStyle: style } };
      if (message.command === 'setStyle') style = message.image ? { image: message.image, name: message.name } : { sample: message.sample, name: message.name };
      if (message.command === 'applyGeneratedNotes') { saved.push(message); state.current.notes = message.notes; }
      if (message.command === 'applyGeneratedQuiz') { saved.push(message); state.current.quiz = message.questions; state.current.quizRevision = state.current.studyRevision; }
      return { state: structuredClone(state) };
    } }, tabs: { create() {} } }
  });
  vm.runInContext(fs.readFileSync('popup.js', 'utf8').replace(/^import .*;\r?\n/gm, ''), context);
  vm.runInContext('downloadCurrentPDF = async () => {}', context);
  await tick(); await tick();
  return { elements, saved };
}

test('Generate notes starts local model, saves output, and restores controls', async () => {
  let created = 0, destroyed = 0;
  const model = { async availability() { return 'downloadable'; }, create(options) {
    created++; options.monitor({ addEventListener(_, handler) { handler({ loaded: 0.5 }); } });
    return Promise.resolve({ destroy() { destroyed++; }, async clone() { return { async prompt() { return '# Notes\n- Budget approved.'; }, destroy() {} }; } });
  } };
  const { elements, saved } = await popup(model);
  const running = elements.get('generate').onclick();
  assert.equal(created, 1, 'starts before the click handler yields');
  assert.equal(elements.get('generate').disabled, true);
  assert.equal(elements.get('ai-progress').value, 50);
  await running;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].previousNotes, 'Original notes');
  assert.equal(elements.get('notes').value, '# Notes\n- Budget approved.');
  assert.equal(elements.get('generate').disabled, false);
  assert.equal(elements.get('cancel-ai').hidden, true);
  assert.equal(destroyed, 0, 'base session stays warm for another request');
});

test('Create quiz generates only a quiz and leaves the flashcard action idle', async () => {
  let created = 0;
  const questions = [
    { type: 'multiple_choice', prompt: 'What was approved?', choices: ['Budget', 'Schedule', 'Hiring plan', 'Scope'], answerIndex: 0, explanation: 'The transcript says the budget was approved.' },
    { type: 'multiple_choice', prompt: 'Which item was approved?', choices: ['Budget', 'Schedule', 'Hiring plan', 'Scope'], answerIndex: 0, explanation: 'The transcript supports this.' },
    { type: 'true_false', prompt: 'The budget was approved.', answer: true, explanation: 'The transcript states this directly.' },
    { type: 'true_false', prompt: 'The schedule was approved.', answer: false, explanation: 'No schedule approval was mentioned.' }
  ];
  const model = { async availability() { return 'available'; }, create() {
    created++;
    return Promise.resolve({ destroy() {}, async clone() { return { destroy() {}, async prompt() { return JSON.stringify({ questions }); } }; } });
  } };
  const { elements, saved } = await popup(model);
  const running = elements.get('generate-quiz').onclick();
  assert.equal(created, 1);
  assert.equal(elements.get('generate-quiz').textContent, 'Generating quiz…');
  assert.equal(elements.get('generate-flashcards').textContent, '✦ Generate flashcards');
  await running;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].command, 'applyGeneratedQuiz');
  assert.equal(saved[0].questions.length, 4);
  assert.equal(elements.get('generate-quiz').textContent, '↻ Regenerate quiz');
  assert.equal(elements.get('generate-flashcards').textContent, '✦ Generate flashcards');
});

test('unsupported Chrome leaves ordinary editing available', async () => {
  const { elements, saved } = await popup({});
  await elements.get('generate').onclick();
  assert.match(elements.get('message').textContent, /unavailable/);
  assert.equal(elements.get('transcript').disabled, false);
  assert.equal(elements.get('notes').value, 'Original notes');
  assert.equal(saved.length, 0);
});

test('canceling a model download does not save or replace notes', async () => {
  const model = { async availability() { return 'downloadable'; }, create({ signal }) {
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } };
  const { elements, saved } = await popup(model);
  const running = elements.get('generate').onclick();
  elements.get('cancel-ai').onclick();
  await running;
  assert.equal(saved.length, 0);
  assert.equal(elements.get('notes').value, 'Original notes');
  assert.match(elements.get('ai-status').textContent, /canceled/);
  assert.equal(elements.get('generate').disabled, false);
});

test('saved notebook photo restores preview, guides generation and can be removed', async () => {
  let imageRequested = false, inspected = false;
  const model = {
    async availability(options) { imageRequested = options.expectedInputs.some(input => input.type === 'image'); return 'available'; },
    create(options) {
      assert.ok(options.expectedInputs.some(input => input.type === 'image'));
      return Promise.resolve({ destroy() {}, async clone() { return { destroy() {}, async prompt(value) {
        if (Array.isArray(value)) { inspected = true; assert.equal(value[0].content[1].value.type, 'image/jpeg'); return 'Headings and indented bullets.'; }
        return '# Notes\n- Approved the budget.';
      } }; } });
    }
  };
  const { elements, saved } = await popup(model, { image: 'data:image/jpeg;base64,/9j/', name: 'Notebook.jpg' });
  assert.equal(imageRequested, true);
  assert.equal(elements.get('sample-preview').hidden, false);
  assert.equal(elements.get('sample-caption').textContent, 'Notebook.jpg');
  await elements.get('generate').onclick();
  assert.equal(inspected, true); assert.equal(saved.length, 1);
  await elements.get('clear-style').onclick();
  assert.equal(elements.get('sample-preview').hidden, true);
  assert.equal(elements.get('clear-style').hidden, true);
  assert.equal(imageRequested, false);
});
