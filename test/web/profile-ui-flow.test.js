import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const flow = await import('../../web/public/add-items-flow.js');

const appSource = await readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8');
const sceneUiSource = await readFile(new URL('../../web/public/scene-ui.js', import.meta.url), 'utf8');

function profileFixture() {
  const avatar = { avatar_id: 'avatar-a' };
  const newerLook = {
    look_id: 'look-a-new',
    avatar_id: 'avatar-a',
    created_at: '2026-07-27T01:20:00.000Z',
  };
  const olderLook = {
    look_id: 'look-a-old',
    avatar_id: 'avatar-a',
    created_at: '2026-07-27T01:10:00.000Z',
  };
  const foreignLook = {
    look_id: 'look-b',
    avatar_id: 'avatar-b',
    created_at: '2026-07-27T01:30:00.000Z',
  };
  return {
    avatar,
    newerLook,
    olderLook,
    foreignLook,
    // Deliberately not API order: the transition must use persisted creation
    // time, not whichever browser array element happens to be first.
    profile: { avatars: [avatar], looks: [olderLook, foreignLook, newerLook] },
  };
}

test('saved-avatar transition shows the look grid when avatar has multiple looks', () => {
  const { avatar, newerLook, profile } = profileFixture();
  assert.strictEqual(flow.latestLookForAvatar(profile, avatar), newerLook);

  const transition = flow.resolveSavedAvatarTransition(profile, avatar);
  assert.equal(transition.action, 'FILTER_AVATAR',
    'multiple looks must show the grid, not auto-open the newest');
  assert.strictEqual(transition.selection.avatar, avatar);
  assert.strictEqual(transition.selection.look, newerLook);
  assert.equal(transition.selection.avatarId, 'avatar-a');
  assert.equal(transition.selection.lookId, 'look-a-new');
});

test('saved-avatar transition auto-opens the look when avatar has exactly one look', () => {
  const avatar = { avatar_id: 'avatar-single' };
  const look = {
    look_id: 'look-single',
    avatar_id: 'avatar-single',
    created_at: '2026-07-27T01:00:00.000Z',
  };
  const profile = { avatars: [avatar], looks: [look] };

  const transition = flow.resolveSavedAvatarTransition(profile, avatar);
  assert.equal(transition.action, 'OPEN_LOOK',
    'exactly one look must auto-open without showing the grid');
  assert.strictEqual(transition.selection.avatar, avatar);
  assert.strictEqual(transition.selection.look, look);
  assert.equal(transition.selection.avatarId, 'avatar-single');
  assert.equal(transition.selection.lookId, 'look-single');
});

test('selected saved look becomes the in-product Live reference without upload input', () => {
  assert.equal(
    flow.selectedLookLiveUrl({ look_id: 'look / exact' }),
    '/post-shoot-mvp.html?look=look%20%2F%20exact&embed=1',
  );
  assert.throws(() => flow.selectedLookLiveUrl({}), /saved look id/i);
  assert.match(appSource, /profile-look-live/);
  assert.match(appSource, /selectedLookLiveUrl\(selectedProfileLook\)/);
  assert.doesNotMatch(indexSource, />Video \/ Live MVP</);
});

test('saved look exposes one primary action plus four truthful next directions', () => {
  for (const id of [
    'profile-look-background-primary',
    'profile-look-refine',
    'profile-look-background',
    'profile-look-photoshoot',
    'profile-look-video',
    'profile-look-live',
  ]) {
    assert.match(indexSource, new RegExp(`id="${id}"`));
  }
  assert.match(indexSource, /Fashion video не підміняється mock-роликом/);
  assert.match(indexSource, /id="profile-look-refine"[^>]*disabled/);
  assert.match(indexSource, /id="profile-look-video"[^>]*disabled/);
  assert.match(indexSource, /aria-label="Відкрити Real-time Look"/);
  assert.match(indexSource, /aria-label="Додати стандартний фон"/);
  assert.match(appSource, /openSelectedLookScene\('standard'\)/);
  assert.match(appSource, /openSelectedLookScene\('editorial'\)/);
  assert.match(sceneUiSource, /async openForLook\(look, \{ initialTab = 'standard' \} = \{\}\)/);
  assert.match(sceneUiSource, /this\.pickerTab = initialTab === 'editorial' \? 'editorial' : 'standard';/);
  assert.match(appSource, /profile-look-video/);
  assert.match(appSource, /Seedance 2 transport, QA і збереження кліпу/);
});

test('Add items continuation receives the exact selected avatar and look once', async () => {
  const { avatar, newerLook, profile } = profileFixture();
  const transition = flow.resolveSavedAvatarTransition(profile, avatar);
  const received = [];

  const continued = await flow.continueAddItemsFromSelection(
    transition.selection,
    async (value) => received.push(value),
  );

  assert.strictEqual(continued.avatar, avatar);
  assert.strictEqual(continued.look, newerLook);
  assert.deepEqual(received, [{ avatar, look: newerLook }]);
});

test('saved-avatar selection executes only the filter-avatar effect for multi-look avatars', async () => {
  const { avatar, profile } = profileFixture();
  const counters = { start: 0, clear: 0, reset: 0 };
  const calls = [];

  const transition = flow.resolveSavedAvatarTransition(profile, avatar);
  await flow.executeSavedAvatarTransition(transition, {
    openLook: async (look) => calls.push(['open-look', look.look_id]),
    filterAvatar: async (avatarId) => calls.push(['filter-avatar', avatarId]),
    beginDraft: () => { counters.start += 1; },
    clearDraft: () => { counters.clear += 1; },
    resetDraft: () => { counters.reset += 1; },
  });

  assert.equal(transition.action, 'FILTER_AVATAR');
  assert.deepEqual(calls, [['filter-avatar', 'avatar-a']]);
  assert.deepEqual(counters, { start: 0, clear: 0, reset: 0 });
});

test('an avatar with no saved look keeps the filter-only navigation path', async () => {
  const { profile } = profileFixture();
  const avatar = { avatar_id: 'avatar-empty' };
  const calls = [];
  const transition = flow.resolveSavedAvatarTransition(profile, avatar);

  const selection = await flow.executeSavedAvatarTransition(transition, {
    openLook: async () => calls.push('open-look'),
    filterAvatar: async (avatarId) => calls.push(['filter-avatar', avatarId]),
  });

  assert.equal(transition.action, 'FILTER_AVATAR');
  assert.equal(selection.avatarId, 'avatar-empty');
  assert.equal(selection.look, null);
  assert.deepEqual(calls, [['filter-avatar', 'avatar-empty']]);
});

test('Back restores captured draft view state through the UI transition without clearing it', () => {
  const calls = [];
  const draftCalls = { clear: 0, reset: 0 };
  const captured = {
    view: 'empty',
    workflowActive: false,
    panelTitle: 'Новий окремий образ',
    statusText: 'АВАТАР ЗАФІКСОВАНО',
    statusClass: 'status-chip idle',
  };
  const restored = flow.restoreProfileReturnState(captured, {
    restorePanel: (target) => calls.push(['panel', target]),
    setWorkflowActive: (value) => calls.push(['workflow', value]),
    setView: (value) => calls.push(['view', value]),
    clearDraft: () => { draftCalls.clear += 1; },
    resetDraft: () => { draftCalls.reset += 1; },
  });

  assert.strictEqual(restored, captured);
  assert.deepEqual(calls, [
    ['panel', captured],
    ['workflow', false],
    ['view', 'empty'],
  ]);
  assert.deepEqual(draftCalls, { clear: 0, reset: 0 });
});

test('the public profile UI delegates clicks to the executable transition helpers', () => {
  assert.match(appSource, /const transition = resolveSavedAvatarTransition\(profile, avatar\);/);
  assert.match(appSource, /await executeSavedAvatarTransition\(transition, \{/);
  assert.match(appSource, /continueAddItemsFromSelection\(selectedProfileLookSelection, beginDraft\)/);
  assert.match(appSource, /restoreProfileReturnState\(profileReturnState, \{/);
});
