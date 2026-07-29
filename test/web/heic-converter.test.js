import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

import {
  convertHeicToJpeg,
  isHeicContainer,
  registerHeicConversionRoute,
} from '../../src/web/heic-converter.js';

function heicBytes(brand = 'heic') {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftyp'),
    Buffer.from(brand),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('mif1'),
    Buffer.from('heic'),
  ]);
}

test('HEIC container detection reads ISO-BMFF brands instead of trusting a filename', () => {
  assert.equal(isHeicContainer(heicBytes()), true);
  assert.equal(isHeicContainer(heicBytes('mif1')), true);
  assert.equal(isHeicContainer(Buffer.from('not an image')), false);
});

test('server HEIC conversion uses sips and returns a validated JPEG', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0xff, 0xd9]);
  const result = await convertHeicToJpeg(heicBytes(), {
    commandRunner: async (executable, args) => {
      assert.equal(executable, '/usr/bin/sips');
      assert.equal(args.includes('jpeg'), true);
      await writeFile(args.at(-1), jpeg);
    },
  });
  assert.deepEqual(result, jpeg);
});

test('server HEIC conversion refuses a renamed arbitrary file', async () => {
  await assert.rejects(
    convertHeicToJpeg(Buffer.from('plain text'), {
      commandRunner: async () => assert.fail('converter must not run'),
    }),
    (error) => error.code === 'HEIC_CONTAINER_INVALID',
  );
});

test('HEIC conversion route accepts multipart bytes and returns private JPEG', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0xff, 0xd9]);
  const app = Fastify();
  await app.register(multipart);
  await registerHeicConversionRoute(app, {
    converter: async (bytes) => {
      assert.equal(isHeicContainer(bytes), true);
      return jpeg;
    },
  });
  const form = new FormData();
  form.append('image', new Blob([heicBytes()], { type: 'image/heic' }), 'IMG_5355.HEIC');
  const encoded = new Request('http://localhost', { method: 'POST', body: form });
  const response = await app.inject({
    method: 'POST',
    url: '/api/uploads/heic-to-jpeg',
    headers: Object.fromEntries(encoded.headers),
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/jpeg');
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.deepEqual(response.rawPayload, jpeg);
  await app.close();
});
