import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeClaims,
  patternMatches,
  patternsOverlap,
  proposalConflicts,
  validateCommit
} from '../scripts/collab-board-state.mjs';

const comment = (body) => ({ body, createdAt: '2026-07-31T00:00:00Z' });
const claim = (agent, lane, files) => comment(`<!-- wardrobe-board:v1 -->\nACTION: CLAIM\nAGENT: ${agent}\nLANE: ${lane}\nFILES: ${files}\nINTERSECTS: none`);
const release = (agent) => comment(`<!-- wardrobe-board:v1 -->\nACTION: RELEASE\nAGENT: ${agent}\nSHA: abc`);

test('the last structured action controls each active agent claim', () => {
  const payload = { comments: [claim('codex', 'transport', 'engine.js'), claim('claude', 'visual', 'style.css'), release('codex')] };
  const active = activeClaims(payload);
  assert.equal(active.has('codex'), false);
  assert.equal(active.get('claude').lane, 'visual');
});

test('file and directory claims have deterministic overlap', () => {
  assert.equal(patternMatches('docs/*', 'docs/15.md'), true);
  assert.equal(patternMatches('ui.js', 'style.css'), false);
  assert.equal(patternsOverlap('docs/*', 'docs/15.md'), true);
  assert.equal(patternsOverlap('ui.js', 'style.css'), false);
});

test('a proposal reports another active agent before work starts', () => {
  const payload = { comments: [claim('claude', 'mirror-ui', 'ui.js, style.css')] };
  const conflicts = proposalConflicts(payload, 'codex', ['engine.js', 'ui.js']);
  assert.deepEqual(conflicts[0].overlaps, ['ui.js']);
});

test('commit validation requires an own claim and blocks staged intersections', () => {
  const payload = { comments: [
    claim('codex', 'board', 'scripts/*, test/*'),
    claim('claude', 'docs', 'docs/*')
  ] };
  assert.deepEqual(validateCommit(payload, 'codex', ['scripts/collab-board.sh']).errors, []);
  assert.match(validateCommit(payload, 'codex', ['docs/15.md']).errors.join('\n'), /outside claim/);
  assert.match(validateCommit(payload, 'codex', ['docs/15.md']).errors.join('\n'), /overlap with claude/);
  assert.match(validateCommit(payload, 'release', ['ui.js']).errors.join('\n'), /no active CLAIM/);
});
