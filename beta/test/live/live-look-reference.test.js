import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import {
  LIVE_REFERENCE_HEIGHT,
  LIVE_REFERENCE_WIDTH,
  buildLiveLookReferenceCard,
} from '../../src/web/live-look-reference.js';
import { sha256 } from '../../src/web/scene-contract.js';

async function cutout(colour, { width = 400, height = 500 } = {}) {
  // An RGBA cutout: an opaque coloured block inside a fully transparent margin,
  // which is the shape removeBorderConnectedWhiteToAlpha produces.
  const block = await sharp({
    create: {
      width: Math.round(width * 0.6),
      height: Math.round(height * 0.6),
      channels: 4,
      background: { ...colour, alpha: 1 },
    },
  }).png().toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: block, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function evidenceWith(categories) {
  const palette = [
    { r: 22, g: 84, b: 44 },
    { r: 18, g: 18, b: 20 },
    { r: 140, g: 92, b: 40 },
    { r: 60, g: 70, b: 120 },
  ];
  const items = [];
  for (const [index, category] of categories.entries()) {
    const data = await cutout(palette[index % palette.length]);
    items.push({
      order: index,
      role: `item_${index}`,
      category,
      media_type: 'image/png',
      sha256: sha256(data),
      data,
    });
  }
  return {
    schema_version: '1.0.0',
    kind: 'APPROVED_ITEM_EVIDENCE',
    source_run_id: 'run_live_ref',
    items,
  };
}

test('a complete locked look composites into one opaque exact-white card', async () => {
  const evidence = await evidenceWith(['top', 'bottom', 'footwear']);
  const card = await buildLiveLookReferenceCard(evidence);

  assert.equal(card.kind, 'LIVE_LOOK_REFERENCE');
  assert.equal(card.width, LIVE_REFERENCE_WIDTH);
  assert.equal(card.height, LIVE_REFERENCE_HEIGHT);
  assert.equal(card.sha256, sha256(card.image));
  assert.equal(card.source_run_id, 'run_live_ref');
  assert.deepEqual(card.items.map((item) => item.category), ['top', 'bottom', 'footwear']);

  const metadata = await sharp(card.image).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.hasAlpha, false, 'the provider must receive an opaque card');
  assert.equal(String(metadata.space).toLowerCase(), 'srgb');
});

test('the card corners are exact #FFFFFF', async () => {
  const evidence = await evidenceWith(['top', 'bottom', 'footwear']);
  const card = await buildLiveLookReferenceCard(evidence);
  const { data, info } = await sharp(card.image).raw().toBuffer({ resolveWithObject: true });
  const corners = [
    0,
    (info.width - 1) * info.channels,
    (info.width * (info.height - 1)) * info.channels,
    ((info.width * info.height) - 1) * info.channels,
  ];
  for (const offset of corners) {
    assert.deepEqual(
      [data[offset], data[offset + 1], data[offset + 2]],
      [255, 255, 255],
    );
  }
});

test('the same evidence always produces the same bytes', async () => {
  const evidence = await evidenceWith(['top', 'bottom', 'footwear']);
  const first = await buildLiveLookReferenceCard(evidence);
  const second = await buildLiveLookReferenceCard(evidence);
  assert.equal(first.sha256, second.sha256);
});

test('a one_piece plus footwear look is complete', async () => {
  const evidence = await evidenceWith(['one_piece', 'footwear']);
  const card = await buildLiveLookReferenceCard(evidence);
  assert.equal(card.items.length, 2);
});

test('an incomplete look is refused, not padded out', async () => {
  const evidence = await evidenceWith(['top']);
  await assert.rejects(
    () => buildLiveLookReferenceCard(evidence),
    (error) => {
      assert.equal(error.code, 'LIVE_REFERENCE_INCOMPLETE_LOOK');
      assert.equal(error.status, 422);
      assert.match(error.message, /bottom or one_piece/);
      assert.match(error.message, /footwear/);
      return true;
    },
  );
});

test('swapped bytes are refused even though the producer already checked them', async () => {
  const evidence = await evidenceWith(['top', 'bottom', 'footwear']);
  evidence.items[1].data = await cutout({ r: 200, g: 30, b: 30 });
  await assert.rejects(
    () => buildLiveLookReferenceCard(evidence),
    (error) => {
      assert.equal(error.code, 'LIVE_REFERENCE_HASH_MISMATCH');
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test('evidence of the wrong kind is refused', async () => {
  const evidence = await evidenceWith(['top', 'bottom', 'footwear']);
  evidence.kind = 'APPROVED_LOOK';
  await assert.rejects(
    () => buildLiveLookReferenceCard(evidence),
    /Expected APPROVED_ITEM_EVIDENCE/,
  );
});

test('an unknown category is refused rather than silently placed', async () => {
  const evidence = await evidenceWith(['top', 'bottom', 'footwear']);
  evidence.items[0].category = 'jetpack';
  await assert.rejects(
    () => buildLiveLookReferenceCard(evidence),
    /unknown category: jetpack/,
  );
});

test('an empty item list is refused', async () => {
  const evidence = await evidenceWith([]);
  await assert.rejects(
    () => buildLiveLookReferenceCard(evidence),
    (error) => {
      assert.equal(error.code, 'LIVE_REFERENCE_NO_ITEMS');
      return true;
    },
  );
});
