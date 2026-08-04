import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOURCE_AVATAR_KEY,
  SOURCE_LOOK_KEY,
  addItemsScreenState,
  createSceneActionLabel,
  finalizeConsumedRunState,
  formatLookCount,
  lineageFromStorage,
  looksForAvatar,
  resolveAddItemsSelection,
  resolveProfileLookSelection,
  resolveResultAddItemsSelection,
  resolveStoredAddItemsLineage,
  restoreAddItemsSelection,
  saveCompletedProfileRun,
  scenePresetLabel,
  scenesForLook,
  sceneStatusLabel,
  storeAddItemsLineage,
  storeAddItemsSelection,
} from '../../web/public/add-items-flow.js';

const AVATAR_ID = '7df0e252-7045-4721-9b95-7bb4935fe79d';
const LOOK_ID = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
const OTHER_AVATAR_ID = '41cf6522-43fd-40ad-a8db-615bcdf80e07';
const ACTIVE_RUN_KEY = 'zeely_active_run_id';
const PENDING_FINALIZATION_KEY = 'zeely_pending_finalization_id';
const RESET_PENDING_KEY = 'zeely_draft_reset_pending';

function storage(initial = {}, events = []) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      events.push(`set:${key}`);
      values.set(key, String(value));
    },
    removeItem: (key) => {
      events.push(`remove:${key}`);
      values.delete(key);
    },
    values,
  };
}

test('saved-avatar add-items mode hides avatar creation and shows the bound avatar context', () => {
  const avatar = { avatar_id: AVATAR_ID, name: 'Avatar 01' };
  const look = { look_id: LOOK_ID, avatar_id: AVATAR_ID };
  const selection = resolveAddItemsSelection({ avatar, look });
  const screen = addItemsScreenState(selection);

  assert.equal(screen.mode, 'add-items');
  assert.equal(screen.showNewAvatarInputs, false);
  assert.equal(screen.showSourceAvatarContext, true);
  assert.equal(screen.title, 'Новий окремий образ');
  assert.equal(screen.submit, 'Створити окремий образ');
  assert.match(screen.sourceDetail, /лише зовнішність і пропорції тіла/);
  assert.match(screen.sourceDetail, /образ залишається збереженим без змін/);
  assert.match(screen.sourceDetail, /окремий образ/);

  const browserStorage = storage();
  storeAddItemsSelection(browserStorage, selection);
  assert.deepEqual(lineageFromStorage(browserStorage), {
    sourceAvatarId: AVATAR_ID,
    sourceLookId: LOOK_ID,
  });
});

test('saved-look scene summary is honest about existing scenes and their server status', () => {
  const scenes = [
    { scene_id: 'scene-1', status: 'COMPLETED' },
    { scene_id: 'scene-2', status: 'RUNNING' },
  ];
  assert.deepEqual(scenesForLook({ scenes }), scenes);
  assert.deepEqual(scenesForLook({}), []);
  assert.equal(sceneStatusLabel('COMPLETED'), 'Готова');
  assert.equal(sceneStatusLabel('RUNNING'), 'Генерується');
  assert.equal(sceneStatusLabel('QUEUED'), 'У черзі');
  assert.equal(sceneStatusLabel('FAILED'), 'Не вдалося');
  assert.equal(createSceneActionLabel({ scenes }), 'Створити ще одну сцену');
  assert.equal(createSceneActionLabel({ scenes: [] }), 'Створити сцену');
});

test('saved scene projections retain understandable preset names without extra API fields', () => {
  assert.equal(
    scenePresetLabel({ preset_id: 'std.city.golden_hour_gloss' }),
    'Місто — золота година',
  );
  assert.equal(
    scenePresetLabel({ preset_id: 'std.studio.taupe_rembrandt_gloss' }),
    'Драматична студія — Рембрандт',
  );
  assert.equal(
    scenePresetLabel({ preset_id: 'custom.future.scene' }),
    'Збережена сцена',
  );
});

test('profile avatar selection scopes looks without changing their exact owner', () => {
  const avatar = { avatar_id: AVATAR_ID, name: 'Avatar 01' };
  const otherAvatar = { avatar_id: OTHER_AVATAR_ID, name: 'Avatar 02' };
  const look = { look_id: LOOK_ID, avatar_id: AVATAR_ID, name: 'Look 01' };
  const otherLook = {
    look_id: '30cf6522-43fd-40ad-a8db-615bcdf80e07',
    avatar_id: OTHER_AVATAR_ID,
    name: 'Look 02',
  };
  const profile = {
    avatars: [avatar, otherAvatar],
    looks: [look, otherLook],
  };

  assert.deepEqual(looksForAvatar(profile, avatar), [look]);
  assert.deepEqual(looksForAvatar(profile, otherAvatar), [otherLook]);
});

test('profile look continuation resolves the exact owner avatar and look pair', () => {
  const avatar = { avatar_id: AVATAR_ID, name: 'Avatar 01' };
  const otherAvatar = { avatar_id: OTHER_AVATAR_ID, name: 'Avatar 02' };
  const exactLook = { look_id: LOOK_ID, avatar_id: AVATAR_ID, name: 'Look 01' };
  const selection = resolveProfileLookSelection({
    avatars: [otherAvatar, avatar],
    looks: [exactLook],
  }, exactLook);

  assert.equal(selection.avatar, avatar);
  assert.equal(selection.look, exactLook);
  assert.equal(selection.avatarId, AVATAR_ID);
  assert.equal(selection.lookId, LOOK_ID);
});

test('profile look continuation rejects orphaned or unbound looks', () => {
  assert.throws(
    () => resolveProfileLookSelection({
      avatars: [{ avatar_id: OTHER_AVATAR_ID }],
      looks: [{ look_id: LOOK_ID, avatar_id: AVATAR_ID }],
    }, { look_id: LOOK_ID, avatar_id: AVATAR_ID }),
    /аватар/i,
  );
  assert.throws(
    () => resolveProfileLookSelection({
      avatars: [{ avatar_id: AVATAR_ID }],
      looks: [{ look_id: LOOK_ID }],
    }, { look_id: LOOK_ID }),
    /прив’язки/i,
  );
});

test('saved-avatar look count uses correct Ukrainian grammar', () => {
  assert.equal(formatLookCount(0), '0 образів');
  assert.equal(formatLookCount(1), '1 образ');
  assert.equal(formatLookCount(2), '2 образи');
  assert.equal(formatLookCount(4), '4 образи');
  assert.equal(formatLookCount(5), '5 образів');
  assert.equal(formatLookCount(11), '11 образів');
  assert.equal(formatLookCount(21), '21 образ');
  assert.equal(formatLookCount(24), '24 образи');
});

test('server draft restores add-items lineage when browser storage is empty', () => {
  const browserStorage = storage();
  const profile = {
    avatars: [{ avatar_id: AVATAR_ID }],
    looks: [{ look_id: LOOK_ID, avatar_id: AVATAR_ID }],
  };
  const restored = restoreAddItemsSelection(profile, browserStorage, {
    source_avatar_id: AVATAR_ID,
    source_look_id: LOOK_ID,
  });

  assert.equal(restored.avatarId, AVATAR_ID);
  assert.equal(restored.lookId, LOOK_ID);
  assert.equal(browserStorage.values.get(SOURCE_AVATAR_KEY), AVATAR_ID);
  assert.equal(browserStorage.values.get(SOURCE_LOOK_KEY), LOOK_ID);
});

test('an empty server draft does not erase a valid local saved-avatar selection', () => {
  const browserStorage = storage({
    [SOURCE_AVATAR_KEY]: AVATAR_ID,
    [SOURCE_LOOK_KEY]: LOOK_ID,
  });
  const profile = {
    avatars: [{ avatar_id: AVATAR_ID }],
    looks: [{ look_id: LOOK_ID, avatar_id: AVATAR_ID }],
  };

  const restored = restoreAddItemsSelection(profile, browserStorage, {
    source_avatar_id: null,
    source_look_id: null,
  });

  assert.equal(restored.avatarId, AVATAR_ID);
  assert.equal(restored.lookId, LOOK_ID);
});

test('an explicitly bound server draft wins over a different valid local selection', () => {
  const browserStorage = storage({
    [SOURCE_AVATAR_KEY]: OTHER_AVATAR_ID,
  });
  const profile = {
    avatars: [
      { avatar_id: AVATAR_ID },
      { avatar_id: OTHER_AVATAR_ID },
    ],
    looks: [{ look_id: LOOK_ID, avatar_id: AVATAR_ID }],
  };

  const restored = restoreAddItemsSelection(profile, browserStorage, {
    source_avatar_id: AVATAR_ID,
    source_look_id: LOOK_ID,
  });

  assert.equal(restored.avatarId, AVATAR_ID);
  assert.equal(restored.lookId, LOOK_ID);
  assert.equal(browserStorage.values.get(SOURCE_AVATAR_KEY), AVATAR_ID);
});

test('raw server lineage can restore the exact add-items binding before the profile loads', () => {
  const browserStorage = storage();
  const lineage = resolveStoredAddItemsLineage(browserStorage, {
    source_avatar_id: AVATAR_ID,
    source_look_id: LOOK_ID,
  });
  assert.deepEqual(lineage, {
    sourceAvatarId: AVATAR_ID,
    sourceLookId: LOOK_ID,
  });
  storeAddItemsLineage(browserStorage, lineage);
  assert.deepEqual(lineageFromStorage(browserStorage), lineage);
});

test('an empty server draft cannot erase a browser-bound add-items lineage', () => {
  const browserStorage = storage({
    [SOURCE_AVATAR_KEY]: AVATAR_ID,
    [SOURCE_LOOK_KEY]: LOOK_ID,
  });
  assert.deepEqual(resolveStoredAddItemsLineage(browserStorage, {
    source_avatar_id: null,
    source_look_id: null,
  }), {
    sourceAvatarId: AVATAR_ID,
    sourceLookId: LOOK_ID,
  });
});

test('result add-items selection never falls back to another avatar', () => {
  const profile = {
    avatars: [{ avatar_id: OTHER_AVATAR_ID, name: 'Wrong avatar' }],
    looks: [],
  };

  assert.throws(
    () => resolveResultAddItemsSelection(profile, {
      currentAvatarId: AVATAR_ID,
    }),
    /Мій профіль/,
  );

  const exactProfile = {
    avatars: [
      { avatar_id: OTHER_AVATAR_ID },
      { avatar_id: AVATAR_ID },
    ],
    looks: [{ look_id: LOOK_ID, avatar_id: AVATAR_ID }],
  };
  const selection = resolveResultAddItemsSelection(exactProfile, {
    currentAvatarId: AVATAR_ID,
    currentLookId: LOOK_ID,
  });
  assert.equal(selection.avatarId, AVATAR_ID);
  assert.equal(selection.lookId, LOOK_ID);
});

test('successful profile save clears run state, lineage, and both drafts in crash-safe order', async () => {
  const events = [];
  const runId = '37e2da28-b355-4101-ae33-695d29f29272';
  const browserStorage = storage({
    [SOURCE_AVATAR_KEY]: AVATAR_ID,
    [SOURCE_LOOK_KEY]: LOOK_ID,
    [ACTIVE_RUN_KEY]: runId,
    [PENDING_FINALIZATION_KEY]: runId,
  }, events);
  const profile = {
    avatars: [{ avatar_id: AVATAR_ID }],
    looks: [{ look_id: LOOK_ID, avatar_id: AVATAR_ID }],
  };

  const { response, cleanup } = await saveCompletedProfileRun({
    runId,
    lineage: { sourceAvatarId: AVATAR_ID, sourceLookId: LOOK_ID },
    claimRun: async () => { events.push('claim'); },
    saveRun: async () => {
      events.push('save');
      return { profile };
    },
    finalizeConsumedState: () => finalizeConsumedRunState(browserStorage, {
      runId,
      activeRunKey: ACTIVE_RUN_KEY,
      pendingFinalizationKey: PENDING_FINALIZATION_KEY,
      resetPendingKey: RESET_PENDING_KEY,
      clearRunLocation: () => { events.push('clear:location'); },
      clearLocalDraft: async () => { events.push('clear:local-draft'); },
      clearServerDraft: async () => { events.push('clear:server-draft'); },
    }),
  });

  assert.deepEqual(response, { profile });
  assert.equal(cleanup.fullyCleared, true);
  assert.deepEqual(lineageFromStorage(browserStorage), {
    sourceAvatarId: null,
    sourceLookId: null,
  });
  assert.equal(browserStorage.getItem(ACTIVE_RUN_KEY), null);
  assert.equal(browserStorage.getItem(PENDING_FINALIZATION_KEY), null);
  assert.equal(browserStorage.getItem(RESET_PENDING_KEY), null);
  assert.equal(restoreAddItemsSelection(profile, browserStorage, {
    source_avatar_id: null,
    source_look_id: null,
  }), null, 'reload must not resurrect the consumed add-items flow');

  assert.ok(events.indexOf('save') < events.indexOf(`set:${RESET_PENDING_KEY}`));
  assert.ok(events.indexOf(`set:${RESET_PENDING_KEY}`) < events.indexOf(`remove:${ACTIVE_RUN_KEY}`));
  assert.ok(events.indexOf(`remove:${ACTIVE_RUN_KEY}`) < events.indexOf('clear:location'));
  assert.ok(events.indexOf('clear:location') < events.indexOf(`remove:${SOURCE_AVATAR_KEY}`));
  assert.ok(events.indexOf(`remove:${SOURCE_AVATAR_KEY}`) < events.indexOf('clear:local-draft'));
});

test('failed profile save preserves the draft and add-items lineage for retry', async () => {
  const browserStorage = storage({
    [SOURCE_AVATAR_KEY]: AVATAR_ID,
    [SOURCE_LOOK_KEY]: LOOK_ID,
  });
  let finalized = false;

  await assert.rejects(
    saveCompletedProfileRun({
      runId: 'failed-save-run',
      lineage: { sourceAvatarId: AVATAR_ID, sourceLookId: LOOK_ID },
      claimRun: async () => {},
      saveRun: async () => { throw new Error('save failed'); },
      finalizeConsumedState: async () => { finalized = true; },
    }),
    /save failed/,
  );

  assert.equal(finalized, false);
  assert.deepEqual(lineageFromStorage(browserStorage), {
    sourceAvatarId: AVATAR_ID,
    sourceLookId: LOOK_ID,
  });
});

test('partial post-save cleanup leaves a recovery marker without resurrecting lineage', async () => {
  const runId = '37e2da28-b355-4101-ae33-695d29f29272';
  const browserStorage = storage({
    [SOURCE_AVATAR_KEY]: AVATAR_ID,
    [SOURCE_LOOK_KEY]: LOOK_ID,
    [ACTIVE_RUN_KEY]: runId,
  });

  const cleanup = await finalizeConsumedRunState(browserStorage, {
    runId,
    activeRunKey: ACTIVE_RUN_KEY,
    pendingFinalizationKey: PENDING_FINALIZATION_KEY,
    resetPendingKey: RESET_PENDING_KEY,
    clearLocalDraft: async () => {},
    clearServerDraft: async () => { throw new Error('offline'); },
  });

  assert.equal(cleanup.fullyCleared, false);
  assert.equal(cleanup.serverDraftCleared, false);
  assert.equal(browserStorage.getItem(RESET_PENDING_KEY), 'true');
  assert.deepEqual(lineageFromStorage(browserStorage), {
    sourceAvatarId: null,
    sourceLookId: null,
  });
  assert.equal(browserStorage.getItem(ACTIVE_RUN_KEY), null);
});

test('a look from another avatar cannot be attached to the add-items flow', () => {
  assert.throws(
    () => resolveAddItemsSelection({
      avatar: { avatar_id: AVATAR_ID },
      look: {
        look_id: LOOK_ID,
        avatar_id: OTHER_AVATAR_ID,
      },
    }),
    /іншому аватару/,
  );
});
