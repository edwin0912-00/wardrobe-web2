import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const branches = [
  'beta-block-1-core-look',
  'beta-block-2-profile-ui',
  'beta-block-3-backgrounds',
  'beta-block-4-universe',
  'beta-block-5-fashion-shoot',
  'beta-block-6-fashion-video',
  'beta-block-7-realtime-look',
];
const handoffs = [
  '01-core-look.md',
  '02-profile-ui.md',
  '03-backgrounds.md',
  '04-universe.md',
  '05-fashion-shoot.md',
  '06-fashion-video.md',
  '07-realtime-look.md',
];

test('seven beta blocks have unique branches and committed handoffs', async () => {
  assert.equal(new Set(branches).size, 7);
  const contract = await readFile(path.join(root, 'docs/coordination/BETA_BLOCKS_2026-07-29.md'), 'utf8');
  for (const [index, branch] of branches.entries()) {
    assert.match(contract, new RegExp(branch));
    await access(path.join(root, 'docs/coordination/blocks', handoffs[index]));
  }
  assert.match(contract, /Only `codex-main` integrates/);
  assert.match(contract, /Code.*Beta.*Journey/s);
});

test('block one owns the complete input-to-master path and background QA', async () => {
  const block = await readFile(path.join(root, 'docs/coordination/blocks/01-core-look.md'), 'utf8');
  assert.match(block, /person\/clothing inputs to the first approved/);
  assert.match(block, /identity\/item\/framing\/anatomy QA/);
  assert.match(block, /standard background/);
  assert.match(block, /surface microtexture may be\s+advisory/i);
  assert.match(block, /silhouette, colour, logo\/text/);
});

test('join script maps each block to its exact branch and never pushes beta', async () => {
  const source = await readFile(path.join(root, 'tools/join-beta-block-agent.sh'), 'utf8');
  for (const branch of branches) assert.match(source, new RegExp(branch));
  assert.match(source, /Commit subject must start: \[agent:\$agent_id\] \[block:\$block_number\]/);
  assert.doesNotMatch(source, /git push origin beta(?:\s|$)/);
  assert.match(source, /git push origin "\$branch"/);
});

test('all-block watcher observes beta and every block branch without writes', async () => {
  const source = await readFile(path.join(root, 'tools/watch-beta-blocks.sh'), 'utf8');
  for (const branch of branches) assert.match(source, new RegExp(branch));
  assert.match(source, /sleep 20/);
  assert.doesNotMatch(source, /^\s*git (?:add|commit|push|switch|merge(?:\s|$)|rebase)\b/m);
});
