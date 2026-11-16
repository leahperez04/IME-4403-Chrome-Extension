import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSampleImage, sampleImageBlob, isSampleImage } from '../sample-image.mjs';

test('stored images accept bounded JPEG data only and decode locally', async () => {
  const value = 'data:image/jpeg;base64,/9j/';
  assert.equal(isSampleImage(value), true);
  assert.equal(isSampleImage('https://example.com/photo.jpg'), false);
  assert.equal(isSampleImage('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isSampleImage('data:image/jpeg;base64,' + 'a'.repeat(2000000)), false);
  const blob = sampleImageBlob(value);
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [255, 216, 255]);
  assert.throws(() => sampleImageBlob('bad'), /invalid/);
});

test('photos are resized, flattened and re-encoded with decoder resources released', async () => {
  let closed = false, drawn = false, filled = false;
  const oldDocument = globalThis.document, oldDecoder = globalThis.createImageBitmap;
  const canvas = { getContext() { return { fillRect() { filled = true; }, drawImage() { drawn = true; } }; }, toDataURL(type) { assert.equal(type, 'image/jpeg'); return 'data:image/jpeg;base64,/9j/'; } };
  globalThis.createImageBitmap = async (_, options) => { assert.equal(options.imageOrientation, 'from-image'); return { width: 3200, height: 2400, close() { closed = true; } }; };
  globalThis.document = { createElement(name) { assert.equal(name, 'canvas'); return canvas; } };
  try {
    assert.equal(await prepareSampleImage({ type: 'image/png' }), 'data:image/jpeg;base64,/9j/');
    assert.equal(canvas.width, 1600); assert.equal(canvas.height, 1200);
    assert.ok(filled && drawn && closed);
    await assert.rejects(prepareSampleImage({ type: 'image/heic' }), /Convert HEIC/);
  } finally { globalThis.document = oldDocument; globalThis.createImageBitmap = oldDecoder; }
});
