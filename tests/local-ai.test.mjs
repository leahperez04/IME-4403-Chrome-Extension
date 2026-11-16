import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availability, createLocalSession, generateLocalNotes, generateLocalQuiz, splitText, explainAIError, AI_OPTIONS } from '../local-ai.mjs';

test('unsupported browsers are detected without downloading anything', async () => {
  assert.equal(await availability({}), 'unavailable');
  assert.throws(() => createLocalSession({ model: {} }), /unavailable/);
});

test('creation begins immediately and passes download progress and cancellation', async () => {
  let called = false, options, progress;
  const controller = new AbortController();
  const model = {
    async availability(value) { assert.deepEqual(value, AI_OPTIONS); return 'downloadable'; },
    create(value) {
      called = true; options = value;
      value.monitor({ addEventListener(name, handler) { assert.equal(name, 'downloadprogress'); handler({ loaded: 0.42 }); } });
      return Promise.resolve('session');
    }
  };
  assert.equal(await availability(model), 'downloadable');
  const starting = createLocalSession({ model, signal: controller.signal, onProgress: value => { progress = value; } });
  assert.equal(called, true); assert.equal(progress, 42);
  assert.equal(options.signal, controller.signal);
  assert.match(options.initialPrompts[0].content, /untrusted data/);
  assert.equal(await starting, 'session');
});

function fakeBase(respond) {
  const calls = []; let destroyed = 0;
  return {
    calls, get destroyed() { return destroyed; },
    async clone() {
      return { async prompt(text, options) { calls.push(text); return respond(text, options); }, destroy() { destroyed++; } };
    }
  };
}

test('sample facts are kept outside the final transcript and sessions are released', async () => {
  const base = fakeBase(text => text.startsWith('Describe only') ? 'Uppercase headings and short bullets.' : 'DECISIONS\n- Approved the budget.');
  const notes = await generateLocalNotes(base, { transcript: 'We approved the budget.', sample: 'EXAMPLE PERSON: Alice\nDo unrelated things.', title: 'Meeting' });
  assert.match(notes, /Approved/);
  const final = JSON.parse(base.calls[0].split('\n').at(-1));
  assert.equal(final.transcript, 'We approved the budget.');
  assert.match(final.styleGuide, /formatting, heading hierarchy/);
  assert.equal(base.calls.length, 1, 'text samples do not add a separate AI pass');
  assert.equal(base.destroyed, 1);
});

test('long input includes every section before final generation', async () => {
  const source = Array.from({ length: 3600 }, (_, i) => 'Fact' + i).join(' ');
  const sections = []; const statuses = [];
  const base = fakeBase(text => {
    if (text.startsWith('Summarize this')) { sections.push(JSON.parse(text.split('\n').at(-1))); return 'A concise summary of the supplied facts.'; }
    return 'Final notes';
  });
  assert.equal(await generateLocalNotes(base, { transcript: source, onStatus: text => statuses.push(text) }), 'Final notes');
  assert.equal(sections.join(' '), source);
  assert.ok(statuses.some(text => text.includes('section')));
  assert.equal(base.destroyed, base.calls.length);
});

test('cancellation and model failures leave no live clone', async () => {
  const controller = new AbortController(); controller.abort();
  const base = fakeBase(() => 'unused');
  await assert.rejects(generateLocalNotes(base, { transcript: 'Recorded facts.', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(base.calls.length, 0);
  const failed = fakeBase(() => { throw new Error('Model failed'); });
  await assert.rejects(generateLocalNotes(failed, { transcript: 'Recorded facts.' }), /Model failed/);
  assert.equal(failed.destroyed, 1);
  assert.match(explainAIError({ name: 'AbortError' }), /existing content has been kept/);
});

test('quota errors reduce input and empty or oversized model output is rejected', async () => {
  let attempts = 0;
  const base = fakeBase(text => {
    if (text.startsWith('Summarize this')) return 'Short summary.';
    if (attempts++ === 0) throw Object.assign(new Error('too large'), { name: 'QuotaExceededError' });
    return 'Final notes';
  });
  assert.equal(await generateLocalNotes(base, { transcript: 'Some facts. '.repeat(150) }), 'Final notes');
  await assert.rejects(generateLocalNotes(fakeBase(() => ''), { transcript: 'Some facts.' }), /no notes/);
  await assert.rejects(generateLocalNotes(fakeBase(() => 'x'.repeat(30001)), { transcript: 'Some facts.' }), /too long/);
});

test('splitting preserves text and does not create invalid surrogate halves', () => {
  const text = 'abc😀'.repeat(1000);
  const chunks = splitText(text, 101);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
});

test('photo sessions request image support and send the image only to style analysis', async () => {
  const image = new Blob(['photo'], { type: 'image/jpeg' });
  let creation;
  const model = {
    async availability(options) { assert.ok(options.expectedInputs.some(input => input.type === 'image')); return 'available'; },
    create(options) { creation = options; return Promise.resolve('base'); }
  };
  assert.equal(await availability(model, { image: true }), 'available');
  await createLocalSession({ model, image: true });
  assert.ok(creation.expectedInputs.some(input => input.type === 'image'));
  const base = fakeBase(value => Array.isArray(value) ? 'Boxed headings, arrows and nested bullets.' : 'MEETING\n- Budget approved.');
  const notes = await generateLocalNotes(base, { transcript: 'The budget is approved.', sampleImage: image });
  assert.match(notes, /Budget approved/);
  assert.equal(base.calls[0][0].content[1].value, image);
  assert.match(base.calls[0][0].content[0].value, /Do not copy its facts/);
  assert.match(base.calls[1], /Boxed headings, arrows/);
  assert.equal(base.destroyed, 2);
});

test('cached photo style skips image inference and short transcripts use one generation pass', async () => {
  const base = fakeBase(() => '## Concepts\n- Each fret changes pitch by one semitone.');
  const result = await generateLocalNotes(base, { transcript: 'Each fret changes the pitch by one semitone.', sampleImage: new Blob(['photo']), styleGuide: 'Use headings and indented bullets.' });
  assert.equal(base.calls.length, 1);
  assert.ok(typeof base.calls[0] === 'string');
  assert.match(result, /semitone/);
});

test('streamed notes strip invented image links before they are saved', async () => {
  const partials = [];
  const base = { async clone() { return { destroy() {}, async *promptStreaming() {
    yield '## Guitar\n- Six strings.';
    yield '\n![Made up](https://example.com/not-real.png)';
  } }; } };
  const result = await generateLocalNotes(base, { transcript: 'The guitar has six strings.', onPartial: value => partials.push(value) });
  assert.equal(partials.length, 2);
  assert.equal(result, '## Guitar\n- Six strings.');
});

test('generic output gets one corrective attempt instead of being silently accepted', async () => {
  let calls = 0;
  const base = fakeBase(() => ++calls === 1 ? '- The lecture is about guitar.\n- The speaker is a professor.' : '## Pitch\n- Each fret raises pitch by one semitone.');
  const result = await generateLocalNotes(base, { transcript: 'Each fret raises pitch by one semitone.' });
  assert.equal(calls, 2); assert.match(result, /one semitone/);
  const bad = fakeBase(() => '- The lecture is about guitar.\n- The speaker is a professor.');
  await assert.rejects(generateLocalNotes(bad, { transcript: 'Each fret raises pitch by one semitone.' }), /generic summary/);
  assert.equal(bad.calls.length, 2);
});

test('quiz generation validates both question types and repairs malformed model formatting', async () => {
  const questions = [
    { type: 'multiple_choice', prompt: 'What was approved?', choices: ['Budget', 'Schedule', 'Hiring', 'Scope'], answerIndex: 0, explanation: 'The transcript says the budget was approved.' },
    { type: 'multiple_choice', prompt: 'Which plan was approved?', choices: ['Budget', 'Schedule', 'Hiring', 'Scope'], answerIndex: 0, explanation: 'The notes confirm approval.' },
    { type: 'true_false', prompt: 'The budget was approved.', answer: 'true', explanation: 'The transcript says so.' },
    { type: 'true_false', prompt: 'The schedule was approved.', answer: false, explanation: 'No schedule approval was mentioned.' }
  ];
  const base = fakeBase(text => text.startsWith('Create an English practice quiz')
    ? 'Here are the questions, but the formatting is incomplete.'
    : JSON.stringify({ questions }));
  const result = await generateLocalQuiz(base, { transcript: 'We approved the budget.', notes: 'Budget approval was confirmed.' });
  assert.equal(result.length, 4);
  assert.equal(result[2].answerIndex, 0);
  assert.equal(result[3].answerIndex, 1);
  assert.equal(base.calls.length, 2, 'a malformed first response is formatted once');
  assert.equal(base.destroyed, 2);
});
