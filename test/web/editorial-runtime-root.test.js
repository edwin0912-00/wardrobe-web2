import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { adoptLegacyEditorialShootRoot } from '../../src/web/editorial-shoot-service.js';

const SHOOT_ID = 'shoot_1f2e3d4c5b6a79880123456789abcdef0123456789abcdef';
const OTHER_SHOOT_ID = 'shoot_a0b1c2d3e4f56789fedcba9876543210fedcba9876543210';

async function persistedShoot(root, shootId, state) {
  await mkdir(path.join(root, shootId, 'inputs'), { recursive: true });
  await writeFile(path.join(root, shootId, 'shoot.json'), state);
  await writeFile(path.join(root, shootId, 'inputs', 'shoot-bible.json'), `${state}-bible`);
}

test('a shoot left under the legacy editorial root is moved whole, not orphaned', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'editorial-runtime-root-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const legacyRoot = path.join(base, 'project', 'runtime', 'editorial-shoots');
  const root = path.join(base, 'configured', 'editorial-shoots');
  await persistedShoot(legacyRoot, SHOOT_ID, 'legacy-state');
  await mkdir(path.join(legacyRoot, '.locks'), { recursive: true });
  await mkdir(path.join(legacyRoot, 'not a shoot id'), { recursive: true });

  assert.deepEqual(
    await adoptLegacyEditorialShootRoot({ from: legacyRoot, to: root }),
    [SHOOT_ID],
  );
  assert.equal(await readFile(path.join(root, SHOOT_ID, 'shoot.json'), 'utf8'), 'legacy-state');
  assert.equal(
    await readFile(path.join(root, SHOOT_ID, 'inputs', 'shoot-bible.json'), 'utf8'),
    'legacy-state-bible',
  );
  assert.deepEqual((await readdir(legacyRoot)).sort(), ['.locks', 'not a shoot id']);
  assert.deepEqual(await adoptLegacyEditorialShootRoot({ from: legacyRoot, to: root }), []);
});

test('adoption never overwrites a configured shoot and never moves a root onto itself', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'editorial-runtime-root-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const legacyRoot = path.join(base, 'legacy');
  const root = path.join(base, 'configured');
  await persistedShoot(legacyRoot, SHOOT_ID, 'legacy-state');
  await persistedShoot(legacyRoot, OTHER_SHOOT_ID, 'legacy-other');
  await persistedShoot(root, SHOOT_ID, 'configured-state');

  assert.deepEqual(
    await adoptLegacyEditorialShootRoot({ from: legacyRoot, to: root }),
    [OTHER_SHOOT_ID],
  );
  assert.equal(
    await readFile(path.join(root, SHOOT_ID, 'shoot.json'), 'utf8'),
    'configured-state',
  );
  assert.equal(
    await readFile(path.join(legacyRoot, SHOOT_ID, 'shoot.json'), 'utf8'),
    'legacy-state',
  );

  assert.deepEqual(await adoptLegacyEditorialShootRoot({ from: root, to: root }), []);
  assert.ok((await stat(path.join(root, SHOOT_ID))).isDirectory());
});

test('a default runtime root with nothing to adopt is not an error', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'editorial-runtime-root-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  assert.deepEqual(
    await adoptLegacyEditorialShootRoot({
      from: path.join(base, 'never-existed', 'editorial-shoots'),
      to: path.join(base, 'configured', 'editorial-shoots'),
    }),
    [],
  );
});

test('start.js derives the editorial shoot root from the same runtime root as scenes', async () => {
  // The wiring lives in a boot script that listens on a port and starts the generation
  // provider, so its source is the only thing assertable here. It is asserted at all
  // because one missing assignment put shoot state in the project tree while every
  // frame, receipt and manifest for those shoots went to ZEELY_RUNTIME_ROOT, and the
  // half that was found was reported to the user as the whole.
  const source = await readFile(new URL('../../src/web/start.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /sceneDependencies\.rootDirectory = path\.join\(runtimeRoot, 'scenes'\);/,
  );
  assert.match(
    source,
    /sceneDependencies\.editorialRootDirectory = path\.join\(runtimeRoot, 'editorial-shoots'\);/,
  );
  assert.match(source, /adoptLegacyEditorialShootRoot\(\{/);
});
