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

test('saved-avatar transition opens that avatar’s newest look by persisted create time', () => {
  const { avatar, newerLook, profile } = profileFixture();
  assert.strictEqual(flow.latestLookForAvatar(profile, avatar), newerLook);

  const transition = flow.resolveSavedAvatarTransition(profile, avatar);
  assert.equal(transition.action, 'OPEN_LOOK');
  assert.strictEqual(transition.selection.avatar, avatar);
  assert.strictEqual(transition.selection.look, newerLook);
  assert.equal(transition.selection.avatarId, 'avatar-a');
  assert.equal(transition.selection.lookId, 'look-a-new');
});

test('selected saved look consumes the fail-closed full-viewport Live capability', () => {
  assert.match(appSource, /profile-look-live/);
  assert.match(appSource, /\/api\/post-shoot\/realtime-look-capability\?look_id=/);
  assert.match(appSource, /payload\?\.launch\?\.presentation === 'FULL_VIEWPORT'/);
  assert.match(appSource, /payload\?\.launch\?\.target === '_self'/);
  assert.match(appSource, /payload\?\.launch\?\.nested === false/);
  assert.match(appSource, /payload\?\.launch\?\.internal_scroll === false/);
  assert.match(appSource, /window\.location\.assign\(realtimeLookCapability\.href\)/);
  assert.doesNotMatch(appSource, /selectedLookLiveUrl/);
  assert.doesNotMatch(indexSource, /id="profile-live-frame"/);
  assert.doesNotMatch(indexSource, /id="profile-live-overlay"/);
  assert.doesNotMatch(indexSource, />Video \/ Live MVP</);
});

test('saved look exposes actionable branches and their honest pipeline explanations', () => {
  assert.match(
    appSource,
    /idOfAvatar,\s*idOfLook,\s*lineageFromStorage,/,
    'capability refresh must import the shared saved-look id resolver it executes at runtime',
  );
  for (const id of [
    'profile-look-background-primary',
    'profile-look-refine',
    'profile-look-photoshoot',
    'profile-look-video',
    'profile-look-live',
  ]) {
    assert.match(indexSource, new RegExp(`id="${id}"`));
  }
  assert.match(indexSource, /Fashion video не підміняється mock-роликом/);
  assert.match(indexSource, /id="profile-look-action-status"/);
  assert.doesNotMatch(indexSource, /class="profile-action-guide"/);
  assert.doesNotMatch(indexSource, /class="profile-branch-brief/);
  assert.doesNotMatch(indexSource, /id="profile-background-video-brief"/);
  assert.doesNotMatch(indexSource, /id="profile-pipeline-explainer"/);
  assert.match(indexSource, /aria-label="Відкрити Real-time Look"/);
  assert.match(indexSource, /Додати фон<\/strong><small>16 стандартних сцен/);
  assert.match(indexSource, /Покращити образ<\/strong><small>Скоро/);
  assert.match(indexSource, /Fashion Shoot<\/strong><small>5 fashion-кадрів/);
  assert.match(indexSource, /Fashion Video<\/strong><small id="profile-look-video-state">Перевіряємо доступність/);
  assert.match(indexSource, /id="profile-look-video"[^>]*disabled/);
  assert.match(indexSource, /без другого референсу ролик не стартує/);
  assert.match(indexSource, /Real-time Look<\/strong><small id="profile-look-live-state">Перевіряємо доступність/);
  assert.match(appSource, /openSelectedLookScene\('standard'\)/);
  assert.match(appSource, /openSelectedLookScene\('editorial'\)/);
  assert.doesNotMatch(appSource, /document\.querySelector\('#profile-look-background'\)/);
  assert.match(appSource, /п’ять унікальних fashion-кадрів/);
  assert.match(sceneUiSource, /async openForLook\(look, \{ initialTab = 'standard' \} = \{\}\)/);
  assert.match(sceneUiSource, /this\.pickerTab = initialTab === 'editorial' \? 'editorial' : 'standard';/);
  assert.match(appSource, /profile-look-video/);
  assert.match(appSource, /\/api\/profile\/looks\/\$\{encodeURIComponent\(lookId\)\}\/video-capability/);
  assert.match(appSource, /payload\?\.available === true/);
  assert.match(appSource, /payload\?\.requirements\?\.verified_style_reference === true/);
  assert.match(appSource, /payload\?\.requirements\?\.verified_motion_reference === true/);
  assert.match(appSource, /Fashion Video: обери формат кадру й подачу/);
  assert.match(appSource, /Потрібні 2 референси/);
  assert.doesNotMatch(appSource, /function showLookBrief/);
  assert.doesNotMatch(appSource, /function hideLookBriefs/);
  assert.match(appSource, /Покращити: master і вибрані речі locked/);
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

test('saved-avatar selection executes only the open-look effect, never a draft action', async () => {
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

  assert.equal(transition.action, 'OPEN_LOOK');
  assert.deepEqual(calls, [['open-look', 'look-a-new']]);
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
