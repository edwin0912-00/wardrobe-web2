import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_UPLOAD_FILE_BYTES, prepareImageFile } from '../../web/public/image-upload.js';

test('browser upload preparation leaves an already bounded image unchanged', async () => {
  const file = new File([Buffer.from('small fixture')], 'small.jpg', { type: 'image/jpeg' });
  const result = await prepareImageFile(file);
  assert.equal(result.file, file);
  assert.equal(result.changed, false);
  assert.equal(MAX_UPLOAD_FILE_BYTES, 18 * 1024 * 1024);
});

test('browser upload preparation repairs a missing MIME type from a known extension', async () => {
  const file = new File([Buffer.from('small fixture')], 'phone-photo.JPG', { type: '' });
  const result = await prepareImageFile(file);
  assert.notEqual(result.file, file);
  assert.equal(result.file.type, 'image/jpeg');
  assert.equal(result.file.name, 'phone-photo.JPG');
  assert.equal(result.changed, true);
});
