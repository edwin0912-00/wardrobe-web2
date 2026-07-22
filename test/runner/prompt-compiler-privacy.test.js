import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileAvatarPrompt, compileOutfitPrompt, compileRepairPrompt } from '../../src/runner/prompt-compiler.js';

async function templates() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prompt-privacy-test-'));
  const avatar = path.join(root, 'avatar.txt');
  const outfit = path.join(root, 'outfit.txt');
  const repair = path.join(root, 'repair.txt');
  await writeFile(avatar, 'refs={{REFERENCE_BINDINGS}} identity={{IDENTITY_REFERENCE}}');
  await writeFile(outfit, 'refs={{REFERENCE_BINDINGS}} identity={{ORIGINAL_IDENTITY_REFERENCE}} avatar={{APPROVED_AVATAR_REFERENCE}} outfit={{OUTFIT_REFERENCE}} text={{OUTFIT_TEXT}} locks={{MUST_MATCH}}');
  await writeFile(repair, 'Repair ATTACHMENT_1 using {{DEFECT_DESCRIPTION}} within {{REPAIR_REGION}}.');
  return { avatar, outfit, repair };
}

const artifact = (filename) => ({ artifact: { path: filename } });

test('compiled generation prompts use ordered logical attachment labels and never filesystem paths', async () => {
  const prompts = await templates();
  const job = {
    prompts,
    outfit: {
      text: 'Use /Users/jarvis1/private/item.webp from the ZEELY workspace',
      must_match: ['navy wool', 'C:\\Users\\jarvis1\\private\\logo.png'],
    },
  };
  const identity = artifact('/Users/jarvis1/runtime/identity.png');
  const outfit = artifact('/Users/jarvis1/runtime/outfit.png');
  const avatar = artifact('/Users/jarvis1/runtime/avatar.png');
  const references = { ordered: [
    { order: 1, scope: 'avatar', role: 'AVATAR_BASE', path: avatar.artifact.path },
    { order: 2, scope: 'identity', role: 'IDENTITY_PRIMARY', path: identity.artifact.path },
    { order: 3, scope: 'outfit', role: 'GARMENT_PRIMARY', path: outfit.artifact.path },
  ] };

  const compiledAvatar = await compileAvatarPrompt(job, identity, { ordered: references.ordered.slice(1, 2) });
  const compiledOutfit = await compileOutfitPrompt(job, { conditionedIdentity: identity, conditionedOutfit: outfit, avatar, references });
  assert.match(compiledAvatar, /ATTACHMENT_1 \[IDENTITY_PRIMARY\]/);
  assert.match(compiledOutfit, /ATTACHMENT_1 \[AVATAR_BASE\]/);
  assert.match(compiledOutfit, /ATTACHMENT_2 \[IDENTITY_PRIMARY\]/);
  assert.match(compiledOutfit, /ATTACHMENT_3 \[GARMENT_PRIMARY\]/);
  for (const prompt of [compiledAvatar, compiledOutfit]) {
    assert.doesNotMatch(prompt, /\/Users\/|C:\\Users|jarvis1|\bzeely\b/i);
  }
});

test('repair compiler uses fixed attachment roles and sanitizes defect text', async () => {
  const prompts = await templates();
  const prompt = await compileRepairPrompt({ prompts }, {
    defectDescription: 'Zeely artifact at /Users/jarvis1/private/candidate.png',
    repairRegion: 'left sleeve',
  });
  assert.match(prompt, /ATTACHMENT_1/);
  assert.match(prompt, /ATTACHED_REFERENCE/);
  assert.doesNotMatch(prompt, /\/Users\/|jarvis1|\bzeely\b/i);
});
