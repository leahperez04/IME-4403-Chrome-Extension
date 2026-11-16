// Browser smoke test with a simulated local model and real PDF generation.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const root = process.cwd(); const out = path.join(root, '..', 'previews', 'pdf-notes'); fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 440, height: 780 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const state = { current: { id: 'demo', title: 'Learning Guitar', text: 'A guitar has six strings. The frets divide the fingerboard into semitone intervals. Press a string just behind a fret. Practice moving slowly between C major and G major while keeping a steady beat.', notes: '', figures: [], language: 'en-US', created: Date.now() }, sessions: [], folders: [], active: false, busy: false, duration: 0, saved: 'Saved locally', status: 'Ready', warning: '', interim: '', transcriptRevision: 0 };
      let style = null;
      window.testMetrics = { creates: 0, prompts: 0, imagePrompts: 0 };
      window.chrome = { runtime: { getURL: file => new URL(file, location.href).href, onMessage: { addListener() {} }, async sendMessage(message) {
        if (message.command === 'connect') return { ok: true };
        if (message.command === 'storageGet') return { data: { noteStyle: style } };
        if (message.command === 'setStyle') style = message.image ? { image: message.image, name: message.name } : { sample: message.sample, name: message.name };
        if (message.command === 'cacheStyleGuide') style = { ...style, styleGuide: message.guide, styleGuideVersion: 1 };
        if (message.command === 'applyGeneratedNotes') state.current.notes = message.notes;
        if (message.command === 'setFigures') state.current.figures = message.figures;
        if (message.command === 'edit') { if (message.notes !== undefined) state.current.notes = message.notes; }
        return { state: structuredClone(state) };
      } }, tabs: { create() {} } };
      window.LanguageModel = { async availability() { return 'available'; }, async create() {
        window.testMetrics.creates++;
        return { destroy() {}, async clone() { return {
          destroy() {}, async prompt(value) { if (Array.isArray(value)) window.testMetrics.imagePrompts++; return 'Use descriptive headings, short bullets and labeled figures.'; },
          async *promptStreaming() {
            window.testMetrics.prompts++;
            yield '## Guitar fundamentals\n\n- A guitar has six strings.\n- Frets divide the fingerboard into semitone intervals.\n';
            await new Promise(resolve => setTimeout(resolve, 100));
            yield '\n## Practice\n\n1. Press each string just behind a fret.\n2. Move slowly between C major and G major while keeping a steady beat.\n\n![Invented](https://example.invalid/not-a-real-image.png)';
          }
        }; } };
      } };
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin + '/popup.html');
    await page.locator('#generate').waitFor();
    await page.waitForFunction(() => !document.getElementById('generate').disabled);
    // A real uploaded diagram, not an invented link.
    const diagram = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 380;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#faf8ff'; ctx.fillRect(0, 0, 1100, 380);
      ctx.fillStyle = '#302448'; ctx.font = 'bold 32px Arial'; ctx.fillText('Guitar fingerboard - reference illustration', 40, 48);
      ctx.strokeStyle = '#7455a3'; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(60, 100 + i * 42); ctx.lineTo(1030, 100 + i * 42); ctx.stroke(); }
      for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(60 + i * 120, 100); ctx.lineTo(60 + i * 120, 310); ctx.stroke(); }
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#figure-file').setInputFiles({ name: 'Fingerboard reference.png', mimeType: 'image/png', buffer: Buffer.from(diagram, 'base64') });
    await page.locator('.note-figure').waitFor();
    const downloading = page.waitForEvent('download');
    await page.locator('#generate').click();
    const download = await downloading; await download.saveAs(path.join(out, 'guitar-notes.pdf'));
    await page.waitForFunction(() => !document.getElementById('generate').disabled);
    assert.ok((await page.locator('#notes').inputValue()).includes('semitone'));
    assert.ok(!(await page.locator('#notes').inputValue()).includes('http'));
    assert.equal((await page.evaluate(() => window.testMetrics)).creates, 1);
    const again = page.waitForEvent('download'); await page.locator('#generate').click(); await (await again).saveAs(path.join(out, 'guitar-notes-repeat.pdf'));
    await page.waitForFunction(() => !document.getElementById('generate').disabled);
    assert.equal((await page.evaluate(() => window.testMetrics)).creates, 1, 'warm model reused');
    // A notebook photo should be inspected once, then its style guide cached.
    await page.locator('#style-file').setInputFiles({ name: 'Notebook sample.png', mimeType: 'image/png', buffer: Buffer.from(diagram, 'base64') });
    await page.locator('#sample-preview').waitFor();
    await page.waitForFunction(() => !document.getElementById('generate').disabled);
    for (let i = 0; i < 2; i++) {
      const finished = page.waitForEvent('download'); await page.locator('#generate').click(); await (await finished).saveAs(path.join(out, 'photo-style-' + i + '.pdf'));
      await page.waitForFunction(() => !document.getElementById('generate').disabled);
    }
    assert.equal((await page.evaluate(() => window.testMetrics)).imagePrompts, 1, 'photo style analyzed once');
    await page.screenshot({ path: path.join(out, 'extension.png'), fullPage: true });
    // Exercise pagination with a long document and Unicode formula fallback.
    const longPDF = await page.evaluate(async () => {
      const { makeNotesPDF } = await import('./notes-pdf.mjs');
      const notes = Array.from({ length: 22 }, (_, i) => '## Section ' + (i + 1) + '\n\n' + '- Definitions and reasoning: '.repeat(4) + 'Preserve details and concrete examples.\n\n- Formula: α → β; x² + y² = z².\n\n').join('');
      const blob = await makeNotesPDF({ title: 'Study notes layout check', notes });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    fs.writeFileSync(path.join(out, 'layout-check.pdf'), Buffer.from(longPDF));
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: actual PDF download, embedded upload, streaming, warm sessions, cached photo style, pagination and Unicode rendering. Model responses were simulated.');
    console.log(out);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
