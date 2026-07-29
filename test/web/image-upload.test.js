import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_UPLOAD_FILE_BYTES,
  decodeBitmapForUpload,
  isHeicImage,
  prepareImageFile,
} from '../../web/public/image-upload.js';

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

test('HEIC detection accepts both phone MIME types and case-insensitive extensions', () => {
  assert.equal(isHeicImage(new File(['x'], 'IMG_0001.HEIC')), true);
  assert.equal(isHeicImage(new File(['x'], 'IMG_0002', { type: 'image/heif' })), true);
  assert.equal(isHeicImage(new File(['x'], 'IMG_0003.jpg', { type: 'image/jpeg' })), false);
});

test('HEIC falls back to the bundled browser decoder and then returns a real bitmap', async () => {
  const source = new File(['heic bytes'], 'IMG_0001.HEIC', { type: 'image/heic' });
  const decodedJpeg = new Blob(['jpeg bytes'], { type: 'image/jpeg' });
  const bitmap = { width: 1200, height: 1600, close() {} };
  const seen = [];
  const result = await decodeBitmapForUpload(source, {
    bitmapDecoder: async (value) => {
      seen.push(value);
      if (value === source) throw new Error('native HEIC unavailable');
      return bitmap;
    },
    heicDecoder: async ({ blob, toType, quality }) => {
      assert.equal(blob, source);
      assert.equal(toType, 'image/jpeg');
      assert.equal(quality, 0.92);
      return decodedJpeg;
    },
  });
  assert.equal(result, bitmap);
  assert.deepEqual(seen, [source, decodedJpeg]);
});

test('HEIC fails explicitly when neither native nor bundled decoding is available', async () => {
  const source = new File(['heic bytes'], 'IMG_0001.HEIC', { type: 'image/heic' });
  await assert.rejects(
    decodeBitmapForUpload(source, {
      bitmapDecoder: async () => { throw new Error('native HEIC unavailable'); },
      heicDecoder: null,
    }),
    /HEIC decoder не завантажився/,
  );
});
