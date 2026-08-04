import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('the full-look fixture locks the observed sneaker and one declared synthetic trouser item', async () => {
  const [sneakerBytes, trousersBytes, trousersSource, trousersCutout] = await Promise.all([
    readFile('artifacts/conditioning/garments/sneaker-black/reference-pack.json'),
    readFile('artifacts/conditioning/garments/trousers-black/reference-pack.json'),
    readFile('inputs/zeely-test/outfits/locked-black-trousers.png'),
    readFile('artifacts/conditioning/garments/trousers-black/cutout.png'),
  ]);
  const sneaker = JSON.parse(sneakerBytes.toString('utf8'));
  const trousers = JSON.parse(trousersBytes.toString('utf8'));

  assert.equal(sneaker.extraction.provenance, 'OBSERVED');
  assert.equal(sneaker.extraction.category, 'FOOTWEAR');
  assert.equal(sneaker.source.sha256, '5075f38ef46f9811640c2e0d22849e72f042f43f91d3cc706ae107fa8a62c346');
  assert.equal(sneaker.generation_bindings[0].sha256, sha256(await readFile('artifacts/conditioning/garments/sneaker-black/cutout.png')));

  assert.equal(trousers.extraction.provenance, 'SYNTHETIC_LOCKED');
  assert.equal(trousers.extraction.synthetic_lock.policy, 'ONE_TIME_OPERATOR_APPROVED_SYNTHESIS');
  assert.equal(trousers.extraction.synthetic_lock.immutable_after_approval, true);
  assert.equal(trousers.source.sha256, sha256(trousersSource));
  assert.equal(trousers.generation_bindings[0].sha256, sha256(trousersCutout));
  assert.deepEqual(trousers.extraction.observed_facts.material, ['opaque mid-weight cotton denim']);
  assert.deepEqual(trousers.extraction.observed_facts.pattern, ['plain washed-black denim weave']);
});

test('the wide editorial coda keeps its full-length framing while item locks are maintained separately', async () => {
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.resolve('assets/scene-presets'),
    projectRoot: path.resolve('.'),
  });
  await resolver.initialize();
  const bible = await resolver.compileEditorialShootBible({
    modeId: 'editorial.edwin_novak.organic_contrast',
    version: '1.0.0',
  });
  const coda = bible.shots.find((shot) => shot.slot === 'wide_campaign_coda');
  assert.equal(coda.camera.framing, 'wide_full_body');
});
