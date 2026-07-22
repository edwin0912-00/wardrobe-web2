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
