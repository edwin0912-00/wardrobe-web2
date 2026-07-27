export const SOURCE_AVATAR_KEY = 'zeely_source_avatar_id';
export const SOURCE_LOOK_KEY = 'zeely_source_look_id';

export function idOfAvatar(avatar) {
  return avatar?.id ?? avatar?.avatar_id ?? null;
}

export function idOfLook(look) {
  return look?.id ?? look?.look_id ?? null;
}

function lookAvatarId(look) {
  return look?.avatar_id ?? look?.avatarId ?? null;
}

export function looksForProfile(profile) {
  if (Array.isArray(profile?.looks)) return profile.looks;
  return (profile?.avatars ?? []).flatMap((avatar) => (
    (avatar.looks ?? []).map((look) => ({ ...look, avatar_id: idOfAvatar(avatar) }))
  ));
}

export function looksForAvatar(profile, avatar) {
  const avatarId = idOfAvatar(avatar);
  if (!avatarId) return [];
  return looksForProfile(profile).filter((look) => lookAvatarId(look) === avatarId);
}

export function formatLookCount(value) {
  const count = Math.max(0, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14
    ? 'образів'
    : last === 1
      ? 'образ'
      : last >= 2 && last <= 4
        ? 'образи'
        : 'образів';
  return `${count} ${noun}`;
}

export function scenesForLook(look) {
  return Array.isArray(look?.scenes) ? look.scenes : [];
}

export function sceneStatusLabel(value) {
  const status = String(value ?? '').trim().toUpperCase();
  if (status === 'COMPLETED') return 'Готова';
  if (status === 'FAILED') return 'Не вдалося';
  if (status === 'CANCELLED') return 'Скасована';
  if (status === 'QUEUED') return 'У черзі';
  if (['RUNNING', 'PROCESSING', 'GENERATING'].includes(status)) return 'Генерується';
  return status ? 'Перевіряємо стан' : 'Стан невідомий';
}

export function createSceneActionLabel(look) {
  return scenesForLook(look).length ? 'Створити ще одну сцену' : 'Створити сцену';
}

export function scenePresetLabel(preset) {
  const presetId = String(preset?.preset_id ?? '');
  return preset?.ui_name_uk || ({
    'std.city.golden_hour_gloss': 'Місто — золота година',
    'std.studio.white_window_honeycomb': 'Біла студія — віконне світло',
    'std.studio.taupe_rembrandt_gloss': 'Драматична студія — Рембрандт',
    'std.interior.gallery_morning_gloss': 'Сучасна галерея — ранок',
    'std.nature_architecture.concrete_grass_golden_hour': 'Архітектура й трави — золота година',
  })[presetId] || 'Збережена сцена';
}

function createdAtMilliseconds(look) {
  const value = Date.parse(look?.created_at ?? '');
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function isNewerLook(candidate, current) {
  const candidateCreatedAt = createdAtMilliseconds(candidate);
  const currentCreatedAt = createdAtMilliseconds(current);
  if (candidateCreatedAt !== currentCreatedAt) return candidateCreatedAt > currentCreatedAt;
  return String(idOfLook(candidate) ?? '').localeCompare(String(idOfLook(current) ?? '')) < 0;
}

export function latestLookForAvatar(profile, avatar) {
  return looksForAvatar(profile, avatar).reduce(
    (latest, candidate) => (!latest || isNewerLook(candidate, latest) ? candidate : latest),
    null,
  );
}

export function resolveAddItemsSelection({ avatar, look = null }) {
  const avatarId = idOfAvatar(avatar);
  if (!avatarId) throw new Error('Збережений аватар не знайдено');
  const lookId = idOfLook(look);
  if (lookId && lookAvatarId(look) !== avatarId) {
    throw new Error('Збережений образ належить іншому аватару');
  }
  return { avatar, look, avatarId, lookId };
}

/**
 * Pure UI transition: choosing an avatar opens its newest saved look when
 * exactly one look exists.  When there are multiple looks, the transition
 * filters the look grid so the user can pick, instead of auto-navigating
 * to the latest look and hiding the rest.  It never starts, clears, or
 * resets a draft.
 */
export function resolveSavedAvatarTransition(profile, avatar) {
  const avatarLooks = looksForAvatar(profile, avatar);
  const selection = resolveAddItemsSelection({
    avatar,
    look: latestLookForAvatar(profile, avatar),
  });
  return {
    action: avatarLooks.length === 1 ? 'OPEN_LOOK' : 'FILTER_AVATAR',
    selection,
  };
}

/**
 * Executes only a saved-avatar navigation effect. The explicit effect surface
 * deliberately excludes draft creation, clearing, and reset operations.
 */
export async function executeSavedAvatarTransition(transition, {
  openLook,
  filterAvatar,
}) {
  if (typeof openLook !== 'function' || typeof filterAvatar !== 'function') {
    throw new TypeError('Saved-avatar transition requires navigation callbacks');
  }
  if (transition?.action === 'OPEN_LOOK') {
    await openLook(transition.selection.look);
    return transition.selection;
  }
  if (transition?.action === 'FILTER_AVATAR') {
    await filterAvatar(transition.selection.avatarId);
    return transition.selection;
  }
  throw new Error('Unknown saved-avatar transition');
}

/**
 * Runs one explicit add-items continuation from a previously resolved
 * selection. The caller owns all draft persistence and UI side effects.
 */
export async function continueAddItemsFromSelection(selection, startAddItems) {
  if (typeof startAddItems !== 'function') throw new TypeError('startAddItems must be a function');
  const exact = resolveAddItemsSelection(selection);
  await startAddItems({ avatar: exact.avatar, look: exact.look });
  return exact;
}

/**
 * Restores only the captured view state when leaving the profile. Draft
 * storage is deliberately not part of this transition.
 */
export function restoreProfileReturnState(profileReturnState, {
  restorePanel,
  setWorkflowActive,
  setView,
}) {
  if (typeof restorePanel !== 'function'
    || typeof setWorkflowActive !== 'function'
    || typeof setView !== 'function') {
    throw new TypeError('Profile return transition requires UI callbacks');
  }
  const target = profileReturnState?.view && profileReturnState.view !== 'profile'
    ? profileReturnState
    : { view: 'empty', workflowActive: false };
  restorePanel(target);
  setWorkflowActive(Boolean(target.workflowActive));
  setView(target.view);
  return target;
}

export function resolveProfileLookSelection(profile, look) {
  const lookId = idOfLook(look);
  const ownerAvatarId = lookAvatarId(look);
  if (!lookId || !ownerAvatarId) {
    throw new Error('Збережений образ не має точної прив’язки до аватара');
  }
  const avatar = (profile?.avatars ?? [])
    .find((item) => idOfAvatar(item) === ownerAvatarId) ?? null;
  if (!avatar) {
    throw new Error('Аватар цього збереженого образу не знайдено');
  }
  return resolveAddItemsSelection({ avatar, look });
}

export function storeAddItemsSelection(storage, selection) {
  storeAddItemsLineage(storage, {
    sourceAvatarId: selection.avatarId,
    sourceLookId: selection.lookId,
  });
}

export function storeAddItemsLineage(storage, {
  sourceAvatarId,
  sourceLookId = null,
}) {
  if (!sourceAvatarId) {
    clearAddItemsSelection(storage);
    return;
  }
  storage.setItem(SOURCE_AVATAR_KEY, sourceAvatarId);
  if (sourceLookId) storage.setItem(SOURCE_LOOK_KEY, sourceLookId);
  else storage.removeItem(SOURCE_LOOK_KEY);
}

export function clearAddItemsSelection(storage) {
  storage.removeItem(SOURCE_AVATAR_KEY);
  storage.removeItem(SOURCE_LOOK_KEY);
}

export function lineageFromStorage(storage) {
  const sourceAvatarId = storage.getItem(SOURCE_AVATAR_KEY);
  const sourceLookId = storage.getItem(SOURCE_LOOK_KEY);
  return {
    sourceAvatarId,
    sourceLookId: sourceAvatarId ? sourceLookId : null,
  };
}

export function resolveStoredAddItemsLineage(storage, serverDraft = null) {
  const serverSourceAvatarId = serverDraft && Object.hasOwn(serverDraft, 'source_avatar_id')
    ? serverDraft.source_avatar_id
    : null;
  const hasBoundServerSelection = typeof serverSourceAvatarId === 'string'
    && serverSourceAvatarId.length > 0;
  const stored = lineageFromStorage(storage);
  const sourceAvatarId = hasBoundServerSelection
    ? serverSourceAvatarId
    : stored.sourceAvatarId;
  const sourceLookId = hasBoundServerSelection
    ? (Object.hasOwn(serverDraft, 'source_look_id') ? serverDraft.source_look_id : null)
    : stored.sourceLookId;
  return {
    sourceAvatarId,
    sourceLookId: sourceAvatarId ? sourceLookId : null,
  };
}

export function restoreAddItemsSelection(profile, storage, serverDraft = null) {
  const { sourceAvatarId, sourceLookId } = resolveStoredAddItemsLineage(storage, serverDraft);
  const avatar = (profile?.avatars ?? []).find((item) => idOfAvatar(item) === sourceAvatarId) ?? null;
  if (!avatar) {
    clearAddItemsSelection(storage);
    return null;
  }
  const look = sourceLookId
    ? looksForProfile(profile).find((item) => idOfLook(item) === sourceLookId && lookAvatarId(item) === sourceAvatarId) ?? null
    : null;
  storeAddItemsSelection(storage, resolveAddItemsSelection({ avatar, look }));
  return resolveAddItemsSelection({ avatar, look });
}

export function resolveResultAddItemsSelection(profile, {
  currentAvatarId,
  currentLookId = null,
} = {}) {
  const guidance = 'Відкрий «Мій профіль» і вибери потрібний аватар.';
  if (!currentAvatarId) {
    throw new Error(`Не вдалося визначити аватар цього результату. ${guidance}`);
  }
  const avatar = (profile?.avatars ?? [])
    .find((item) => idOfAvatar(item) === currentAvatarId) ?? null;
  if (!avatar) {
    throw new Error(`Аватар цього результату не знайдено у профілі. ${guidance}`);
  }
  const look = currentLookId
    ? looksForProfile(profile).find((item) => (
      idOfLook(item) === currentLookId && lookAvatarId(item) === currentAvatarId
    )) ?? null
    : null;
  if (currentLookId && !look) {
    throw new Error(`Образ цього результату не знайдено у профілі. ${guidance}`);
  }
  return resolveAddItemsSelection({ avatar, look });
}

export async function finalizeConsumedRunState(storage, {
  runId,
  activeRunKey,
  pendingFinalizationKey,
  resetPendingKey,
  clearRunLocation = () => {},
  clearLocalDraft,
  clearServerDraft,
}) {
  storage.setItem(resetPendingKey, 'true');

  if (storage.getItem(activeRunKey) === runId) storage.removeItem(activeRunKey);
  if (storage.getItem(pendingFinalizationKey) === runId) storage.removeItem(pendingFinalizationKey);

  let runLocationCleared = true;
  try {
    clearRunLocation(runId);
  } catch {
    runLocationCleared = false;
  }

  clearAddItemsSelection(storage);
  const [localDraft, serverDraft] = await Promise.allSettled([
    clearLocalDraft(),
    clearServerDraft(),
  ]);
  const localDraftCleared = localDraft.status === 'fulfilled';
  const serverDraftCleared = serverDraft.status === 'fulfilled';
  const fullyCleared = runLocationCleared && localDraftCleared && serverDraftCleared;
  if (fullyCleared) storage.removeItem(resetPendingKey);

  return {
    fullyCleared,
    runLocationCleared,
    localDraftCleared,
    serverDraftCleared,
  };
}

export async function saveCompletedProfileRun({
  runId,
  lineage,
  claimRun,
  saveRun,
  finalizeConsumedState,
}) {
  await claimRun(runId, lineage);
  const response = await saveRun(runId);
  const cleanup = await finalizeConsumedState();
  return { response, cleanup };
}

export function addItemsScreenState(selection) {
  return {
    mode: 'add-items',
    showNewAvatarInputs: false,
    showSourceAvatarContext: true,
    title: 'Новий окремий образ',
    divider: 'НОВИЙ ОКРЕМИЙ ОБРАЗ ДЛЯ ЦЬОГО АВАТАРА',
    submit: 'Створити окремий образ',
    sourceName: selection.avatar?.name || 'Збережений аватар',
    sourceDetail: selection.lookId
      ? 'Повторно використовуємо лише зовнішність і пропорції тіла цього аватара. Вибраний образ залишається збереженим без змін; нові речі створять окремий образ.'
      : 'Повторно використовуємо зовнішність і пропорції тіла цього збереженого аватара. Нові речі створять окремий образ; попередні образи не зміняться.',
  };
}
