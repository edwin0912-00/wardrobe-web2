import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { sendPresentationImage } from '../../src/web/presentation-preview.js';

test('presentation preview is a bounded WebP while the original remains available for download', async (t) => {
  const source = await sharp({
    create: { width: 2400, height: 3200, channels: 3, background: '#884422' },
  }).png().toBuffer();
  const app = Fastify();
  app.get('/image', (request, reply) => sendPresentationImage(request, reply, {
    bytes: source,
    mediaType: 'image/png',
    downloadName: 'master.png',
  }));
  t.after(() => app.close());

  const preview = await app.inject('/image?preview=1');
  assert.equal(preview.statusCode, 200);
  assert.match(preview.headers['content-type'], /^image\/webp/);
  assert.equal(preview.headers['x-zeely-presentation'], 'webp-640');
  const dimensions = await sharp(preview.rawPayload).metadata();
  assert.equal(dimensions.width, 480);
  assert.equal(dimensions.height, 640);

  const original = await app.inject('/image');
  assert.equal(original.statusCode, 200);
  assert.match(original.headers['content-type'], /^image\/png/);
  assert.deepEqual(original.rawPayload, source);
});
