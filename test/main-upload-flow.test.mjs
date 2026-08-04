import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [ui, upload, drop, css] = await Promise.all([
  readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../image-upload.js', import.meta.url), 'utf8'),
  readFile(new URL('../drop-upload.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
]);

test('main site accepts beta image formats and prepares HEIC through same-origin conversion', () => {
  assert.match(ui, /image\/heic,image\/heif/);
  assert.match(ui, /import\('\.\/image-upload\.js'\)/);
  assert.match(upload, /\/api\/uploads\/heic-to-jpeg/);
  assert.match(upload, /MAX_UPLOAD_FILE_BYTES = 18 \* 1024 \* 1024/);
  assert.match(upload, /MIN_UPLOAD_EDGE = 256/);
  assert.match(upload, /shortest >= MIN_UPLOAD_EDGE/);
  assert.match(upload, /MIN_UPLOAD_EDGE \/ shortest/);
  assert.match(upload, /export async function prepareImageFile/);
  assert.match(upload, /image\/jpeg/);
});

test('main site uses beta-style drag validation, depth-safe highlights, and five-item cap', () => {
  assert.match(ui, /addEventListener\('dragenter'/);
  assert.match(ui, /addEventListener\('dragleave'/);
  assert.match(ui, /is-dragover/);
  assert.match(ui, /acceptedDroppedImages/);
  assert.match(ui, /MAX_ITEMS = 5/);
  assert.match(drop, /Перетягніть фото у форматі PNG, JPEG, WEBP, AVIF або HEIC/);
  assert.match(drop, /У це поле можна додати лише одне фото/);
  assert.match(css, /\.slot--drop\.is-dragover/);
  assert.match(css, /\.pslot\.is-dragover/);
});

test('upload preparation gates generation and exposes a recoverable presentation message', () => {
  assert.match(ui, /preparingFiles/);
  assert.match(ui, /Не вдалося підготувати це фото/);
  assert.match(ui, /role="alert"/);
  assert.match(ui, /if \(!hasMain\(\) \|\| !hasItems\(\) \|\| pending \|\| preparingFiles\) return/);
});

test('prepared local uploads survive a reload without being sent to beta early', () => {
  assert.match(ui, /import\('\.\/draft-media-store\.js'\)/);
  assert.match(ui, /function persistDraftMedia\(\)/);
  assert.match(ui, /function restorePersistedDraftMedia\(\)/);
  assert.match(ui, /restorePersistedDraftMedia\(\);/);
  assert.match(ui, /clearPersistedDraftMedia\(\);/);
  assert.match(ui, /not sent to beta/);
});
