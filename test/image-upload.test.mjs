import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareImageFile } from '../image-upload.js';

test('prepares a MIME-valid thumbnail before it can reach the server minimum', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  const previousDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({
    width: 197,
    height: 256,
    close() {},
  });
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return { fillStyle: '', fillRect() {}, drawImage() {} };
        },
        toBlob(callback, type) { callback(new Blob(['prepared'], { type })); },
      };
    },
  };
  try {
    const source = new File([new Uint8Array(10)], 'thumbnail.png', { type: 'image/png' });
    const prepared = await prepareImageFile(source);
    assert.equal(prepared.changed, true);
    assert.equal(prepared.file.type, 'image/jpeg');
    assert.equal(prepared.file.name, 'thumbnail-upload.jpg');
  } finally {
    if (previousBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = previousBitmap;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
