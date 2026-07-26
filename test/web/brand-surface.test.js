import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Brand is a user-visible contract, so it gets a gate.
 *
 * This exists because a rename shipped once as a hand patch on a deployed
 * release: every visible string was correct in the browser, yet nothing in the
 * repo knew about it, so the next build would have silently restored the old
 * brand with no failing check anywhere. Asserting what the user actually sees
 * makes that class of drift loud.
 *
 * Deliberately scoped to the visible layer. Internal identifiers (ZEELY_* env
 * vars, zeely_* cookie/localStorage keys, the zeely-demo-session-v1 token salt,
 * .zeely-* runtime paths) are NOT brand and must never be swept into a rename:
 * changing the salt logs every session out, and changing the storage keys
 * orphans saved drafts.
 */

const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', '..', 'web', 'public');
const BRAND = 'WARDROBE';
const RETIRED_BRAND = /ZEELY/i;

async function publicFile(name) {
  return readFile(path.join(PUBLIC_DIR, name), 'utf8');
}

test('index.html presents the current brand in every visible slot', async () => {
  const html = await publicFile('index.html');

  assert.match(html, new RegExp(`<title>${BRAND}[^<]*</title>`), 'document title carries the brand');
  assert.match(html, new RegExp(`<meta name="description" content="${BRAND}`), 'meta description carries the brand');
  assert.match(html, new RegExp(`<span>${BRAND}</span>`), 'header wordmark carries the brand');
  assert.match(html, /class="brand-mark">W</, 'brand mark letter matches the wordmark');
  assert.match(html, new RegExp(`YOUR ${BRAND} AVATAR`), 'result kicker carries the brand');
  assert.match(html, new RegExp(`<span>${BRAND} AI ENGINEERING TEST</span>`), 'footer carries the brand');
});

test('no retired brand name survives anywhere a user can read it', async () => {
  const html = await publicFile('index.html');

  // Storage keys legitimately keep the old prefix; strip them before scanning so
  // the assertion covers copy only and never pressures anyone into renaming a
  // key that would break returning sessions.
  const visible = html.replace(/localStorage\.getItem\('[^']*'\)/g, '');

  const leaks = visible.split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => RETIRED_BRAND.test(entry.line));

  assert.deepEqual(
    leaks,
    [],
    `retired brand still visible in index.html:\n${leaks.map((l) => `  line ${l.number}: ${l.line}`).join('\n')}`,
  );
});

test('the download filename offered to the user carries the brand', async () => {
  const client = await publicFile('profile-client.js');
  assert.match(client, /`wardrobe-\$\{/, 'saved-avatar file is named for the current brand');
});

test('the live evidence frame shows the whole subject, never a crop', async () => {
  const visualizer = await publicFile('live-visualizer.js');

  // A tall portrait drawn with `cover` fills the stage by cutting the head off.
  // The foreground of an evidence frame must stay `contain`; the low-alpha
  // backdrop underneath is the only place `cover` belongs.
  assert.match(visualizer, /const fit = 'contain';/, 'foreground subject is fitted, not cropped');
});
