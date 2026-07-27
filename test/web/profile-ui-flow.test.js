import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { latestLookForAvatar } from '../../web/public/add-items-flow.js';

const appSource = await readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = appSource.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(end, -1, `missing boundary function ${nextName}`);
  return appSource.slice(start, end);
}

function eventSource(selector, nextSelector) {
  const start = appSource.indexOf(`document.querySelector('${selector}').addEventListener('click'`);
  assert.notEqual(start, -1, `missing click wiring for ${selector}`);
  const end = appSource.indexOf(`document.querySelector('${nextSelector}').addEventListener('click'`, start + 1);
  assert.notEqual(end, -1, `missing boundary click wiring for ${nextSelector}`);
  return appSource.slice(start, end);
}

test('choosing a saved avatar opens its latest exact saved look instead of only filtering the library', () => {
  const avatar = { avatar_id: 'avatar-a' };
  const firstLook = { look_id: 'look-a-new', avatar_id: 'avatar-a' };
  const olderLook = { look_id: 'look-a-old', avatar_id: 'avatar-a' };
  const foreignLook = { look_id: 'look-b', avatar_id: 'avatar-b' };
  const profile = { avatars: [avatar], looks: [firstLook, olderLook, foreignLook] };
  assert.strictEqual(latestLookForAvatar(profile, avatar), firstLook);

  const source = functionSource('selectProfileAvatar', 'openProfileLook');
  assert.match(source, /const look = latestLookForAvatar\(profile, avatar\);/);
  assert.match(source, /if \(look\) \{\s*await openProfileLook\(profile, look\);\s*return;\s*\}/);
  assert.doesNotMatch(source, /beginDraft\(|clearDraft|clearServerDraft|uploads\.reset|form\.reset/);
});

test('Add items carries the selected avatar and look into the existing add-items draft path', () => {
  const source = eventSource('#profile-look-add', '#profile-look-scene');
  assert.match(source, /if \(!selectedProfileLookSelection\) return;/);
  assert.match(
    source,
    /beginDraft\(\{\s*avatar: selectedProfileLookSelection\.avatar,\s*look: selectedProfileLookSelection\.look,\s*\}\)/,
  );

  const beginDraft = functionSource('beginDraft', 'captureProfileReturnState');
  assert.match(beginDraft, /const selection = avatar \? resolveAddItemsSelection\(\{ avatar, look \}\) : null;/);
  assert.match(beginDraft, /if \(selection\) storeAddItemsSelection\(localStorage, selection\);/);
  assert.match(beginDraft, /setAvatarDraftMode\(selection\?\.avatar \?\? null, selection\?\.look \?\? null\);/);
});

test('Back out of the profile restores the existing draft view without clearing draft state', () => {
  const source = functionSource('restoreProfileReturnView', 'selectProfileAvatar');
  assert.match(source, /setWorkflowActive\(Boolean\(target\.workflowActive\)\)/);
  assert.match(source, /setView\(target\.view\)/);
  assert.doesNotMatch(source, /beginDraft|clearDraft|clearServerDraft|uploads\.reset|form\.reset/);
});
