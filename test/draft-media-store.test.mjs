import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deserializeDraftMedia,
  fileFromStored,
  serializeDraftMedia,
  storedFile,
} from '../draft-media-store.js';

test('serializes a local-only draft without changing original file bytes', async () => {
  const main = new File(['person-bytes'], 'me.webp', { type: 'image/webp', lastModified: 12 });
  const item = new File(['shoe-bytes'], 'shoe.png', { type: 'image/png', lastModified: 34 });
  const record = serializeDraftMedia({ main, items: [{ name: 'Черевики', file: item }] });

  assert.equal(record.schemaVersion, 1);
  assert.equal(record.main.name, 'me.webp');
  assert.equal(record.items[0].file.name, 'shoe.png');
  assert.equal(await record.main.blob.text(), 'person-bytes');
  assert.equal(await record.items[0].file.blob.text(), 'shoe-bytes');
});

test('recreates submit-ready Files and retains named choices without files', async () => {
  const main = new File(['person'], 'me.jpg', { type: 'image/jpeg', lastModified: 44 });
  const record = serializeDraftMedia({
    main,
    items: [
      { name: 'Капелюх', file: new File(['hat'], 'hat.jpg', { type: 'image/jpeg' }) },
      { name: 'Лляні штани', file: null },
    ],
  });
  const restored = deserializeDraftMedia(record);

  assert.ok(restored.main instanceof File);
  assert.equal(restored.main.name, 'me.jpg');
  assert.equal(await restored.main.text(), 'person');
  assert.equal(restored.items.length, 2);
  assert.equal(restored.items[0].file.name, 'hat.jpg');
  assert.equal(restored.items[1].name, 'Лляні штани');
  assert.equal(restored.items[1].file, null);
});

test('invalid file records fail closed rather than producing a fake upload', () => {
  assert.equal(storedFile({ name: 'not-a-file' }), null);
  assert.equal(fileFromStored({ blob: 'not-a-blob' }), null);
  assert.equal(deserializeDraftMedia({ schemaVersion: 99, items: [] }), null);
});
