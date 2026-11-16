import { PDFDocument, StandardFonts, rgb } from './vendor/pdf-lib.min.mjs';

import { cleanNotes } from './notes-content.mjs';
export { cleanNotes } from './notes-content.mjs';

export async function makeNotesPDF({ title = 'Conversation notes', notes, figures = [], created, styleProfile }) {
  let style = {};
  try { style = typeof styleProfile === 'string' ? JSON.parse(styleProfile) : styleProfile || {}; } catch { style = {}; }
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(title); doc.setAuthor('Conversation Notes');
  const W = 595.28, H = 841.89, margin = 48, width = W - margin * 2;
  const ink = rgb(.12, .14, .19), gray = rgb(.4, .43, .49);
  const accents = { burgundy: rgb(.49, .16, .24), purple: rgb(.35, .22, .72), blue: rgb(.18, .34, .58), green: rgb(.17, .39, .31), black: rgb(.12, .14, .19) };
  const accent = accents[style.accentColor] || accents.purple;
  let page, y;
  const pages = [];
  function newPage() {
    page = doc.addPage([W, H]); pages.push(page); y = H - margin;
    if (style.gridPaper) {
      const grid = rgb(.91, .90, .87), spacing = 18;
      for (let x = 24; x <= W - 24; x += spacing) page.drawLine({ start: { x, y: 24 }, end: { x, y: H - 24 }, thickness: .25, color: grid });
      for (let gy = 24; gy <= H - 24; gy += spacing) page.drawLine({ start: { x: 24, y: gy }, end: { x: W - 24, y: gy }, thickness: .25, color: grid });
    }
    page.drawLine({ start: { x: margin, y: H - 30 }, end: { x: W - margin, y: H - 30 }, thickness: 2, color: accent });
  }
  function ensure(height) { if (y - height < 52) newPage(); }
  // Symbols outside PDF's standard font are rendered locally as image lines,
  // preserving their appearance without silently replacing mathematical notation.
  function canEncode(text, font) { try { font.encodeText(text); return true; } catch { return false; } }
  function measure(text, size, font) {
    if (canEncode(text, font)) return font.widthOfTextAtSize(text, size);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${font === bold ? 'bold ' : ''}${size}px system-ui`; return ctx.measureText(text).width;
  }
  function wrap(text, size, font, maxWidth) {
    const lines = []; let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (measure(next, size, font) <= maxWidth) { line = next; continue; }
      if (line) { lines.push(line); line = ''; }
      let part = '';
      for (const char of word) {
        if (part && measure(part + char, size, font) > maxWidth) { lines.push(part); part = ''; }
        part += char;
      }
      line = part;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
  async function line(text, size, font, x, color) {
    if (!text) return;
    if (canEncode(text, font)) page.drawText(text, { x, y: y - size, size, font, color });
    else {
      const canvas = document.createElement('canvas'); const scale = 3;
      canvas.width = Math.ceil(measure(text, size, font) * scale + 6); canvas.height = Math.ceil(size * 1.65 * scale);
      const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
      ctx.font = `${font === bold ? 'bold ' : ''}${size}px system-ui`; ctx.fillStyle = '#202430';
      ctx.textBaseline = 'top'; ctx.fillText(text, 0, 0);
      const image = await doc.embedPng(canvas.toDataURL('image/png'));
      page.drawImage(image, { x, y: y - canvas.height / scale, width: canvas.width / scale, height: canvas.height / scale });
    }
  }
  async function paragraph(text, { size = 11, font = regular, indent = 0, color = ink, keep = 0 } = {}) {
    const fragments = String(text).split(/(\*\*[^*]+\*\*)/g);
    const lines = [[]]; let lineWidth = 0;
    for (const fragment of fragments) {
      const emphasis = fragment.startsWith('**') && fragment.endsWith('**');
      const fragmentText = emphasis ? fragment.slice(2, -2) : fragment;
      const runFont = emphasis ? bold : font;
      for (const token of fragmentText.match(/\S+|\s+/g) || []) {
        if (/^\s+$/.test(token)) {
          if (lines.at(-1).length) {
            const previous = lines.at(-1).at(-1);
            previous.text += ' ';
            lineWidth += measure(' ', size, previous.font);
          }
          continue;
        }
        const tokenWidth = measure(token, size, runFont);
        if (lineWidth + tokenWidth > width - indent && lines.at(-1).length) { lines.push([]); lineWidth = 0; }
        lines.at(-1).push({ text: token, font: runFont }); lineWidth += tokenWidth;
      }
    }
    while (lines.length && !lines.at(-1).length) lines.pop();
    ensure(Math.min(lines.length, 3) * size * 1.5 + keep);
    for (const runs of lines) {
      ensure(size * 1.5); let x = margin + indent;
      for (const run of runs) { await line(run.text, size, run.font, x, color); x += measure(run.text, size, run.font); }
      y -= size * 1.5;
    }
  }
  newPage();
  await paragraph(title || 'Conversation notes', { size: 23, font: bold, color: accent, keep: 35 }); y -= 8;
  if (created) { await paragraph(new Date(created).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), { size: 9, color: gray }); y -= 10; }
  for (const raw of cleanNotes(notes).split(/\r?\n/)) {
    if (!raw.trim()) { y -= 7; continue; }
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.+)/);
    const text = (heading ? heading[2].replace(/\*\*([^*]+)\*\*/g, '$1') : raw).replace(/`([^`]+)`/g, '$1');
    if (heading) {
      // The document title is already printed above.
      if (text.trim().toLowerCase() === title.trim().toLowerCase()) continue;
      y -= 10; await paragraph(text, { size: heading[1].length <= 2 ? 15 : 12, font: bold, color: accent, keep: 60 }); y -= 4;
    } else {
      const bullet = text.match(/^(\s*)([-*•→·▪]|\d+[.)])\s+(.+)/);
      await paragraph(bullet ? (/^\d/.test(bullet[2]) ? bullet[2] : bullet[2] === '*' ? '•' : bullet[2]) + ' ' + bullet[3] : text, { indent: bullet ? Math.min(48, 10 + bullet[1].length * 3) : 0 });
      y -= 3;
    }
  }
  if (figures.length) {
    y -= 12;
    for (const [index, figure] of figures.entries()) {
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(figure.image) || figure.image.length > 2000000) throw new Error('A figure is invalid. Remove it and upload the image again.');
      const image = await doc.embedJpg(figure.image);
      const caption = `Figure ${index + 1}${figure.caption ? ': ' + figure.caption : ''}`;
      const captionHeight = wrap(caption, 10, regular, width).length * 15 + 12;
      const scale = Math.min(1, width / image.width, (H - margin - 70 - captionHeight) / image.height, 330 / image.height);
      const displayWidth = image.width * scale, height = image.height * scale;
      ensure(height + captionHeight + 18 + (index === 0 ? 40 : 0));
      if (index === 0) { await paragraph('Figures', { size: 15, font: bold, color: accent }); y -= 10; }
      page.drawImage(image, { x: margin + (width - displayWidth) / 2, y: y - height, width: displayWidth, height }); y -= height + 8;
      await paragraph(caption, { size: 10, color: gray }); y -= 18;
    }
  }
  for (const [index, p] of pages.entries()) {
    p.drawText('Conversation Notes | Review AI-generated content for accuracy', { x: margin, y: 28, size: 8, font: regular, color: gray });
    p.drawText(`${index + 1} / ${pages.length}`, { x: W - 78, y: 28, size: 8, font: regular, color: gray });
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}
