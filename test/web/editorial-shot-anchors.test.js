import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EDITORIAL_BLOCKING_DIRECTORY,
  editorialBlockingReference,
} from '../../src/web/editorial-blocking-reference.js';
import {
  EditorialSceneExecutor,
  editorialSceneIdForIdempotencyKey,
} from '../../src/web/editorial-scene-executor.js';
import {
  EDITORIAL_QA_GATES,
  EDITORIAL_SHOT_SLOTS,
  sha256,
} from '../../src/web/editorial-shoot-contract.js';

// Copied from editorial-shoot-bible.js SLOT_CONTENT, the same way the diagram labels
// were. The copy is the declared side of the drift guard: when a slot's lens or crop
// token moves and the drawn diagram does not, the last test below is what says so.
const SHOT_CAMERA = Object.freeze({
  clean_identity_hero: { lens_mm: 50, framing: 'three_quarter' },
  environmental_hero: { lens_mm: 50, framing: 'three_quarter' },
  sculptural_three_quarter: { lens_mm: 65, framing: 'three_quarter' },
  interference_frame: { lens_mm: 55, framing: 'three_quarter' },
  material_or_accessory_detail: { lens_mm: 85, framing: 'detail' },
  wide_campaign_coda: { lens_mm: 35, framing: 'three_quarter' },
});

function gates() {
  return EDITORIAL_QA_GATES.map((id) => ({ id, decision: 'PASS', evidence: `${id} verified`, defects: [] }));
}

function executorFixture({ heroFrame = null, heroOutput = null } = {}) {
  const calls = [];
  const sceneService = {
    async createScene(input) {
      calls.push(input);
      return { scene_id: editorialSceneIdForIdempotencyKey(input.idempotencyKey), status: 'QUEUED' };
    },
    async waitForIdle(sceneId) {
      return { scene_id: sceneId, status: 'COMPLETED' };
    },
    async verifiedExecutionResult(sceneId) {
      return {
        decision: 'PASS',
        candidate_sha256: '3'.repeat(64),
        gates: gates(),
        reviewer: { id: 'scene-judge', version: 'scene-judge-v1', request_id: 'internal-request' },
        completed_at: '2026-07-26T03:30:00.000Z',
        output: {
          resource_id: sceneId,
          sha256: '3'.repeat(64),
          receipt_sha256: '4'.repeat(64),
          width: 1024,
          height: 1280,
          media_type: 'image/png',
        },
      };
    },
    async getScene(sceneId) {
      if (heroOutput && sceneId === heroOutput.resource_id) {
        return {
          scene_id: sceneId,
          status: 'COMPLETED',
          output: { sha256: heroOutput.sha256, qa_receipt_sha256: heroOutput.receipt_sha256 },
        };
      }
      return { scene_id: sceneId, status: 'COMPLETED' };
    },
    async outputFile() {
      return heroFrame;
    },
  };
  const presetResolver = {
    async editorialShotPresetReference() {
      return {
        preset_id: 'editorial.fixture.slot',
        preset_version: '1.0.0',
        preset_sha256: '5'.repeat(64),
        reference_pack_id: 'pack.editorial.fixture',
        reference_pack_version: '1.1.0',
        reference_pack_sha256: '6'.repeat(64),
        prompt_sha256: '7'.repeat(64),
      };
    },
  };
  return { calls, executor: new EditorialSceneExecutor({ sceneService, presetResolver }) };
}

function shotContext(slot, { heroOutput = null } = {}) {
  return {
    idempotency_key: sha256(`editorial-anchor-${slot}`),
    approved_look: {
      look_id: 'look_fixture',
      image_sha256: '8'.repeat(64),
      receipt_sha256: '9'.repeat(64),
    },
    shoot_bible: {
      bible_id: 'bible_editorial_fixture_1_0_0',
      mode_id: 'editorial.edwin_novak.organic_contrast',
      mode_version: '1.0.0',
      sha256: 'a'.repeat(64),
    },
    shot_spec: { slot, camera: SHOT_CAMERA[slot] },
    shot_spec_sha256: 'b'.repeat(64),
    hero_output: heroOutput,
    signal: new AbortController().signal,
  };
}

test('the hero shot binds only its own blocking diagram and no continuity anchor', async () => {
  const { calls, executor } = executorFixture();
  await executor.executeShot(shotContext('clean_identity_hero'));
  const declared = await editorialBlockingReference({
    shotSpec: { slot: 'clean_identity_hero', camera: SHOT_CAMERA.clean_identity_hero },
  });
  assert.deepEqual(calls[0].shotAnchorReferences.map((anchor) => anchor.role), ['blocking_topdown']);
  assert.equal(calls[0].shotAnchorReferences[0].sha256, declared.sha256);
  assert.equal(calls[0].shotAnchorReferences[0].reference_id, 'blocking.v1.clean_identity_hero');
});

test('each of the five post-hero shots binds its own blocking diagram plus the approved hero frame', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-hero-anchor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const heroBytes = await readFile(path.join(EDITORIAL_BLOCKING_DIRECTORY, 'clean_identity_hero.png'));
  const heroFrame = path.join(root, 'hero.png');
  await writeFile(heroFrame, heroBytes);
  const heroOutput = {
    resource_id: 'scene_hero_fixture',
    sha256: sha256(heroBytes),
    receipt_sha256: 'c'.repeat(64),
    width: 1024,
    height: 1280,
    media_type: 'image/png',
  };
  const blockingHashes = new Set();
  for (const slot of EDITORIAL_SHOT_SLOTS.slice(1)) {
    const { calls, executor } = executorFixture({ heroFrame, heroOutput });
    await executor.executeShot(shotContext(slot, { heroOutput }));
    const anchors = calls[0].shotAnchorReferences;
    assert.deepEqual(anchors.map((anchor) => anchor.role), ['blocking_topdown', 'hero_continuity_anchor']);
    const declared = await editorialBlockingReference({
      shotSpec: { slot, camera: SHOT_CAMERA[slot] },
    });
    assert.equal(anchors[0].sha256, declared.sha256);
    assert.equal(anchors[0].reference_id, `blocking.v1.${slot}`);
    assert.equal(anchors[1].sha256, heroOutput.sha256);
    assert.equal(sha256(anchors[1].data), heroOutput.sha256);
    assert.equal(anchors[1].reference_id, 'hero.scene_hero_fixture');
    blockingHashes.add(anchors[0].sha256);
  }
  // Six slots, six different diagrams: one shared drawing would silently give five
  // shots the geometry of a sixth.
  assert.equal(blockingHashes.size, EDITORIAL_SHOT_SLOTS.length - 1);
  const heroDiagram = await editorialBlockingReference({
    shotSpec: { slot: 'clean_identity_hero', camera: SHOT_CAMERA.clean_identity_hero },
  });
  assert.equal(blockingHashes.has(heroDiagram.sha256), false);
});

test('a post-hero shot refuses to run when the approved hero frame cannot be read', async () => {
  const { executor } = executorFixture({ heroFrame: null });
  await assert.rejects(
    () => executor.executeShot(shotContext('environmental_hero', {
      heroOutput: {
        resource_id: 'scene_missing_hero',
        sha256: 'd'.repeat(64),
        receipt_sha256: 'e'.repeat(64),
        width: 1024,
        height: 1280,
        media_type: 'image/png',
      },
    })),
    /Approved editorial hero frame is unavailable for continuity conditioning/,
  );
});

test('a blocking diagram whose drawn numbers no longer match the slot is refused', async () => {
  await assert.rejects(
    () => editorialBlockingReference({
      shotSpec: { slot: 'wide_campaign_coda', camera: { lens_mm: 50, framing: 'three_quarter' } },
    }),
    /Editorial blocking diagram wide_campaign_coda no longer states the lock it was drawn from/,
  );
  await assert.rejects(
    () => editorialBlockingReference({ shotSpec: { slot: 'not_a_slot' } }),
    /Editorial blocking diagram requires one canonical shot slot/,
  );
});
