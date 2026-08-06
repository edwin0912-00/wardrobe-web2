import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  loadBetaThreadOwnerMap,
  validateBetaBlockOwner,
} from '../../tools/coordination/beta-thread-owner-map.mjs';

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
  const ownerMap = await loadBetaThreadOwnerMap();
  for (const [index, branch] of branches.entries()) {
    assert.match(contract, new RegExp(branch));
    const handoffPath = path.join(root, 'docs/coordination/blocks', handoffs[index]);
    await access(handoffPath);
    const handoff = await readFile(handoffPath, 'utf8');
    assert.match(handoff, new RegExp(`Owner: \`${ownerMap.blocks[index + 1].owner_agent_id}\``));
  }
  assert.match(contract, /Only `chat-00-master` integrates/);
  assert.match(contract, /Code.*Beta.*Journey/s);
});

test('thread identity is exact and remains separate from technical block ownership', async () => {
  const ownerMap = await loadBetaThreadOwnerMap();
  const expected = [
    ['00', '019fb036-e055-7923-b5f4-27392115460b', '00 Master', 'chat-00-master', []],
    ['01', '019f7c40-26c1-7252-acf6-396296d0a42d', '01 - Cloth to avatar in ENV Block', 'codex-main', [1]],
    ['02', '019fadc7-2130-7af2-8e30-856036930a3c', '02 Pipeline LIFE Block', 'chat-2', [2]],
    ['03', '019f8a76-36d5-71e2-a2fa-0c1a98d5fe5f', '03 - BetaSite Block', 'chat-3', [3]],
    ['04', '019faf41-db3e-7d00-a591-5b0851017af9', '04 - Shoot-Back-Block', 'chat-4', [4, 5]],
    ['05', '019faf52-0a8b-7de0-a123-7cea87d3124b', '05 - Video Block', 'chat-5', [6]],
    ['06', '019f8eb8-9755-7e72-b844-2bbfd57ed283', '06 - Main Site Block', 'chat-6', []],
    ['07', '019fa3f3-63d1-76b0-9735-631f96c28ed2', '07 LiveCam Block', 'chat-7', [7]],
  ];
  assert.deepEqual(
    ownerMap.threads.map((thread) => [
      thread.chat_label,
      thread.thread_id,
      thread.title,
      thread.agent_id,
      thread.beta_blocks,
    ]),
    expected,
  );
  assert.equal(ownerMap.threads.find(({ agent_id }) => agent_id === 'chat-6').role, 'MAIN_SITE_ONLY');
});

test('block ownership and reports are agent-ID-bound, including the non-numeric mappings', async () => {
  const ownerMap = await loadBetaThreadOwnerMap();
  assert.deepEqual(
    Object.fromEntries(Object.entries(ownerMap.blocks).map(([block, value]) => [
      block,
      [value.owner_agent_id, value.report],
    ])),
    {
      1: ['codex-main', 'updates/codex-main.md'],
      2: ['chat-2', 'updates/chat-2.md'],
      3: ['chat-3', 'updates/chat-3.md'],
      4: ['chat-4', 'updates/chat-4.md'],
      5: ['chat-4', 'updates/chat-4.md'],
      6: ['chat-5', 'updates/chat-5.md'],
      7: ['chat-7', 'updates/chat-7.md'],
    },
  );
  assert.doesNotThrow(() => validateBetaBlockOwner(ownerMap, 'chat-4', 4));
  assert.doesNotThrow(() => validateBetaBlockOwner(ownerMap, 'chat-4', 5));
  assert.doesNotThrow(() => validateBetaBlockOwner(ownerMap, 'chat-5', 6));
  for (const [agent, block] of [['chat-4', 6], ['chat-5', 5], ['chat-6', 6], ['chat-6', 7]]) {
    assert.throws(
      () => validateBetaBlockOwner(ownerMap, agent, block),
      /BETA_BLOCK_OWNER_MISMATCH/,
    );
  }
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
  const ownerMap = await loadBetaThreadOwnerMap();
  assert.deepEqual(Object.values(ownerMap.blocks).map(({ branch }) => branch), branches);
  assert.match(source, /Commit subject must start: \[agent:\$agent_id\] \[block:\$block_number\]/);
  assert.match(source, /node "\$owner_map_tool" validate "\$agent_id" "\$block_number"/);
  assert.match(source, /field "\$block_number" report/);
  assert.doesNotMatch(source, /updates\/chat-\$block_number\.md/);
  assert.doesNotMatch(source, /git push origin beta(?:\s|$)/);
  assert.match(source, /git push origin "\$branch"/);
});

test('all-block watcher observes beta and every block branch without writes', async () => {
  const source = await readFile(path.join(root, 'tools/watch-beta-blocks.sh'), 'utf8');
  for (const branch of branches) assert.match(source, new RegExp(branch));
  assert.match(source, /beta-block-08-antigravity-qa/);
  assert.match(source, /updates\/antigravity-qa\.md/);
  assert.match(source, /field "\$block_index" owner_agent_id/);
  assert.match(source, /field "\$block_index" report/);
  assert.doesNotMatch(source, /updates\/chat-\$block_index\.md/);
  assert.match(source, /sleep 20/);
  assert.doesNotMatch(source, /^\s*git (?:add|commit|push|switch|merge(?:\s|$)|rebase)\b/m);
});

test('the old Chat 06 video report is preserved but explicitly historical', async () => {
  const report = await readFile(path.join(root, 'updates/chat-6.md'), 'utf8');
  assert.match(report, /HISTORICAL \/ MISASSIGNED/);
  assert.match(report, /Chat 06 is MAIN_SITE-only/);
  assert.match(report, /updates\/chat-5\.md/);
});

test('Antigravity QA is browser-evidence-only and cannot edit product code', async () => {
  const handoff = await readFile(path.join(root, 'docs/coordination/blocks/08-antigravity-qa.md'), 'utf8');
  const join = await readFile(path.join(root, 'tools/join-antigravity-qa.sh'), 'utf8');
  const loop = await readFile(path.join(root, 'ops/loops/antigravity-beta-qa/loop.yaml'), 'utf8');
  assert.match(handoff, /real public beta/i);
  assert.match(handoff, /Browser procedure/);
  assert.match(handoff, /Never edit product code/);
  assert.match(handoff, /GitHub observer/);
  assert.match(handoff, /Browser operator/);
  assert.match(handoff, /Evidence critic/);
  assert.match(join, /beta-block-08-antigravity-qa/);
  assert.match(join, /\[agent:\$agent_id\] \[qa\]/);
  assert.match(join, /nohup bash tools\/watch-beta-blocks\.sh/);
  assert.match(join, /Continue in this agent session with RUN_IN_SESSION\.md/);
  assert.doesNotMatch(join, /exec bash tools\/watch-beta-blocks\.sh/);
  assert.match(loop, /host:\n  cli: gemini/);
  assert.match(loop, /max_iterations: 8/);
  assert.match(loop, /wall_clock_min: 45/);
  assert.match(loop, /max_stalled_iterations: 2/);
});

test('Handoff Cloud Code is a distinct browser-QA writer with no product authority', async () => {
  const ownerMap = await loadBetaThreadOwnerMap();
  const handoff = await readFile(
    path.join(root, 'docs/coordination/blocks/09-handoff-cloud-code-qa.md'),
    'utf8',
  );
  const join = await readFile(path.join(root, 'tools/join-handoff-cloud-code-qa.sh'), 'utf8');
  assert.deepEqual(ownerMap.observers.map(({ agent_id, branch, report }) => [
    agent_id, branch, report,
  ]), [
    ['antigravity-qa', 'beta-block-08-antigravity-qa', 'updates/antigravity-qa.md'],
    [
      'handoff-cloud-code-qa',
      'beta-block-09-handoff-cloud-code-qa',
      'updates/handoff-cloud-code-qa.md',
    ],
  ]);
  assert.match(handoff, /clean browser/i);
  assert.match(handoff, /Everything else is read-only/);
  assert.match(join, /agent_id="\$\{1:-handoff-cloud-code-qa\}"/);
  assert.match(join, /beta-block-09-handoff-cloud-code-qa/);
  assert.match(join, /\[agent:\$agent_id\] \[qa\]/);
  assert.doesNotMatch(join, /git push origin beta/);
});
