import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNotes, isGenericSummary } from '../notes-content.mjs';
import { makeNotesPDF } from '../notes-pdf.mjs';
import { PDFDocument } from '../vendor/pdf-lib.min.mjs';

test('invented remote image links are removed and generic speaker summaries are detected', () => {
  const poor = '## Learning Guitar\n\n![Top](https://example.com/a.png)\n![Bottom](https://example.com/b.png)\n\n* The lecture is about guitar.\n* The speaker is a professor.\n* The speaker mentions strings on a guitar.\n* The speaker notes the guitar is a way of human expression.';
  assert.ok(!cleanNotes(poor).includes('http'));
  assert.equal(isGenericSummary(poor), true);
  assert.equal(isGenericSummary('## Guitar\n- Six strings span the fingerboard.\n- Each fret raises pitch by one semitone.'), false);
});

test('PDF export creates a real multipage document with a title and no link annotations', async () => {
  const blob = await makeNotesPDF({ title: 'Study notes', notes: Array.from({ length: 90 }, (_, i) => '## Concept ' + i + '\n- Detailed explanation with an example and concrete reasoning.').join('\n\n') + '\n![fake](https://example.com/fake.png)' });
  assert.equal(blob.type, 'application/pdf');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(), 'Study notes');
  assert.ok(doc.getPageCount() > 1);
  assert.ok(doc.getPages().every(page => !page.node.Annots()?.size()));
});
