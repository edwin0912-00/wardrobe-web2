/*
 * Canonical-film identity lock.
 *
 * `seg1.mp4` used to be a movable filename: A, B, C, the original and the
 * approved D master all used it at different times. That made a perfectly
 * valid deploy capable of silently showing the rejected camera move. This
 * test pins the approved D bytes and the direct-entry wiring. It does not
 * inspect an arbitrary preview or make a network request, so it remains
 * useful before every deployment.
 *
 * If — and only if — the owner approves a new master, update the four facts
 * below in the same reviewable commit: SHA-256, byte size, duration and the
 * dated cache key. Never replace the binary underneath this test by accident.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const assetPath = new URL('../b/assets/seg1.mp4', import.meta.url);
const journeyPath = new URL('../b/index.html', import.meta.url);
const entryPath = new URL('../index.html', import.meta.url);

const CANONICAL_D = Object.freeze({
  sha256: '5f13fb155eee8affa416fbf7689326b8abcbfc9570417c1ce74932fddfa0d424',
  bytes: 18_730_562,
  cacheKey: 'seg1-d-20260730',
  legs: [
    'assets/seg1.mp4?v=seg1-d-20260730',
    'assets/seg2.mp4',
    'assets/seg3.mp4',
    'assets/seg4.mp4'
  ]
});

test('the selected D master is the exact first room asset', async () => {
  const [bytes, info] = await Promise.all([readFile(assetPath), stat(assetPath)]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  assert.equal(info.size, CANONICAL_D.bytes);
  assert.equal(sha256, CANONICAL_D.sha256);
});

test('the direct-entry journey is wired only to the approved D route', async () => {
  const [journey, entry] = await Promise.all([
    readFile(journeyPath, 'utf8'),
    readFile(entryPath, 'utf8')
  ]);

  for (const video of CANONICAL_D.legs) assert.ok(journey.includes(video), video);
  assert.ok(journey.includes('variant D'));
  assert.ok(journey.includes(CANONICAL_D.cacheKey));
  assert.match(
    journey,
    /data-leg="0" data-src="assets\/seg1\.mp4\?v=seg1-d-20260730"/,
    'leg zero must mount the selected D master directly'
  );
  assert.doesNotMatch(journey, /assets\/seg1-[ABC]\.mp4/, 'archived candidate masters must stay unreachable');
  assert.doesNotMatch(journey, /(?:location\.search|URLSearchParams)/, 'a runtime candidate switch must not return');
  assert.match(entry, /(?:location\.replace|location\.href)\(['\"]\.\/b\/?['\"]\)/);
});
