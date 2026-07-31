import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { EDITORIAL_SHOT_SLOTS } from '../../src/web/editorial-shoot-contract.js';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

/* The contract the runtime actually enforces. `verifiedSceneReference` compiles this exact
 * file and refuses a whole document when one fact exceeds its bound, so a test that checks
 * anything looser is not checking what production checks. */
const validateStructuredReference = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(JSON.parse(await readFile(
  path.resolve(import.meta.dirname, '../../schemas/scene-structured-reference.schema.json'),
  'utf8',
)));

/* WHY THIS FILE EXISTS.
 *
 * Fashion Shoot was failing on every slot of every style on the live host while the whole
 * shoot suite was green. The runtime record showed each slot exhausting six attempts with
 * `EXECUTOR_FAILED: Scene execution ended without a hash-bound QA candidate`, and the child
 * scene underneath showed the real cause on every attempt:
 *
 *     GENERATION_FAILED: references[0] does not match the strict structured-reference schema
 *
 * For `shoot.skylight_haze.sculptural_three_quarter` the fourth spatial cue compiled to 303
 * characters against a 240 bound. Nothing reached a provider, so no candidate existed, so no
 * QA evidence existed, so the parent could only report a generic executor failure.
 *
 * Two gaps let a total outage sit behind a green suite. `editorial-activation-backend`
 * validates every compiled asset but drives the on-disk preset branch, while the live path
 * compiles through `create_universe_assets`. `create-universe-runtime-style` drives that
 * branch but validates no schema, and resolves only `clean_identity_hero` — the one slot
 * that was CANCELLED rather than FAILED, because the five that carry composed cues are the
 * five that broke. Neither test could have caught this; together they looked like coverage.
 *
 * So: every ready style, every slot, every compiled asset, against the real schema. */
test('every compiled Fashion Shoot reference stays inside the structured-reference bounds', async () => {
  const projectRoot = path.resolve('.');
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.join(projectRoot, 'assets', 'scene-presets'),
    projectRoot,
  });
  await resolver.initialize();

  const catalog = await resolver.listEditorialModes();
  const runnable = catalog.generation_mode_ids;
  assert.ok(runnable.length > 0, 'the catalog must offer at least one runnable style');

  const byId = new Map(catalog.modes.map((mode) => [mode.mode_id, mode]));
  const failures = [];
  let assetsChecked = 0;

  for (const modeId of runnable) {
    const mode = byId.get(modeId);
    assert.ok(mode, modeId);
    const bible = await resolver.compileEditorialShootBible({ modeId, version: mode.version });
    assert.deepEqual(bible.shots.map((shot) => shot.slot), EDITORIAL_SHOT_SLOTS, modeId);

    for (const shotSpec of bible.shots) {
      const reference = await resolver.editorialShotPresetReference({
        modeId,
        version: mode.version,
        shotSpec,
      });
      const pack = await resolver.resolveScenePreset(reference);
      for (const asset of pack.assets ?? []) {
        if (asset.media_type !== 'application/json') continue;
        assetsChecked += 1;
        const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.data));
        if (validateStructuredReference(document) && document.role === asset.role) continue;
        /* Report the offending fact itself, not just "invalid". The union schema reports a
         * branch error for every role, so a raw Ajv dump buries the one real defect in noise
         * from the roles the document was never claiming to be. */
        const oversize = [];
        for (const [key, value] of Object.entries(document.facts ?? {})) {
          if (typeof value === 'string' && value.length > 240) oversize.push(`${key}=${value.length}`);
          if (Array.isArray(value)) {
            value.forEach((item, index) => {
              if (typeof item === 'string' && item.length > 240) oversize.push(`${key}[${index}]=${item.length}`);
            });
          }
        }
        failures.push(`${modeId} ${shotSpec.slot} ${asset.role}: ${oversize.join(', ') || 'schema mismatch'}`);
      }
    }
  }

  assert.ok(assetsChecked > 0, 'no structured references were compiled, so nothing was checked');
  assert.deepEqual(failures, [], `structured references outside contract:\n${failures.join('\n')}`);
});

/* The bound is enforced where the document is built, so a field added later cannot bypass it
 * by simply not being on anyone's list. This is the property that makes the fix durable
 * rather than a patch of the one cue that happened to grow. */
test('a fact longer than the bound is truncated on a word boundary, not mid-word', async () => {
  const { compileEditorialShootBible } = await import('../../src/web/editorial-shoot-bible.js');
  assert.equal(typeof compileEditorialShootBible, 'function');

  const projectRoot = path.resolve('.');
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.join(projectRoot, 'assets', 'scene-presets'),
    projectRoot,
  });
  await resolver.initialize();
  const catalog = await resolver.listEditorialModes();
  const modeId = catalog.generation_mode_ids.find((id) => id.startsWith('shoot.'));
  const mode = catalog.modes.find((item) => item.mode_id === modeId);
  const bible = await resolver.compileEditorialShootBible({ modeId, version: mode.version });

  for (const shotSpec of bible.shots) {
    const pack = await resolver.resolveScenePreset(await resolver.editorialShotPresetReference({
      modeId, version: mode.version, shotSpec,
    }));
    for (const asset of pack.assets ?? []) {
      if (asset.media_type !== 'application/json') continue;
      const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.data));
      for (const value of Object.values(document.facts ?? {})) {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
          if (typeof item !== 'string') continue;
          assert.ok(item.length <= 240, `${modeId} ${shotSpec.slot} ${asset.role}: ${item.length} characters`);
          assert.doesNotMatch(item, /\s$/, 'a truncated fact must not end on trailing whitespace');
        }
      }
    }
  }
});
