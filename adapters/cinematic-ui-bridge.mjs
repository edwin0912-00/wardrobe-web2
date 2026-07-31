/**
 * The cinematic bridge is the small presentation policy layer between
 * ZeelyClient and the fabric-world mirrors.
 *
 * It has no DOM, CSS, scroll, storage, hostname, or beta-dashboard copy.  A
 * presentation owns the words and the surfaces; this module only makes sure a
 * presentation never invents a completed result when its same-origin engine is
 * unavailable.
 */
import { createZeelyClient, phaseFor } from './zeely-client.mjs';

const HEALTHY = new Set(['ready', 'ok']);
const ACTIVE_PHASES = new Set([
  'uploading',
  'running',
  'needs_input',
  'waiting_for_approval',
  'recovering',
]);

export const MIRROR_COPY = Object.freeze({
  checking: 'Відкриваємо дзеркало',
  unavailable: 'Ця частина простору ще готується',
  uploading: 'Приймаємо матеріали',
  running: 'Збираємо образ',
  needs_input: 'Оберіть речі',
  waiting_for_approval: 'Готуємо наступний кадр',
  recovering: 'Повертаємося до образу',
  completed: 'Образ готовий',
  failed: 'Не вдалося завершити',
});

export class CinematicUiBridgeError extends Error {
  constructor(code, message = MIRROR_COPY.unavailable) {
    super(message);
    this.name = 'CinematicUiBridgeError';
    this.code = code;
  }
}

function clone(value) {
  return structuredClone(value);
}

function availabilityFor(health) {
  return HEALTHY.has(String(health?.status ?? '').toLowerCase()) ? 'ready' : 'unavailable';
}

function choicesFor(run) {
  return (run?.conflicts ?? [])
    .filter((conflict) => conflict?.type === 'DUPLICATE_SLOT')
    .map((conflict) => ({
      category: String(conflict.category ?? ''),
      options: (conflict.reference_set_ids ?? []).map((id) => String(id)),
    }))
    .filter((choice) => choice.category && choice.options.length > 0);
}

function outputFor(run) {
  const url = run?.outputs?.avatar_outfit;
  return typeof url === 'string' && url.startsWith('/') ? url : null;
}

function initialState() {
  return {
    availability: 'checking',
    phase: 'idle',
    run: null,
    savedLook: null,
    choices: [],
    result: null,
    error: null,
    health: null,
    updatedAt: null,
  };
}

/**
 * @param {object} options
 * @param {object} [options.client] a ZeelyClient-compatible transport
 * @param {boolean} [options.autoProbe=true]
 */
export function createCinematicUiBridge({
  client = createZeelyClient(),
  autoProbe = true,
} = {}) {
  if (!client || typeof client.health !== 'function' || typeof client.subscribe !== 'function') {
    throw new TypeError('createCinematicUiBridge requires a ZeelyClient-compatible client');
  }

  const listeners = new Set();
  let state = initialState();
  let savingRunId = null;
  let disposed = false;

  const emit = (type, patch = {}) => {
    state = {
      ...state,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const event = { type, ...clone(state) };
    listeners.forEach((listener) => listener(event));
    return event;
  };

  function recordError(error, type = 'error') {
    const unavailable = error?.status === 404 || error?.status === 0 || error?.code === 'MIRROR_UNAVAILABLE';
    emit(type, {
      availability: unavailable ? 'unavailable' : state.availability,
      phase: unavailable ? 'idle' : 'failed',
      error: {
        code: unavailable ? 'MIRROR_UNAVAILABLE' : (error?.code ?? 'REQUEST_FAILED'),
      },
    });
  }

  async function persistCompletedRun(run) {
    if (!run?.run_id || run.status !== 'COMPLETED' || state.savedLook || savingRunId === run.run_id) return;
    savingRunId = run.run_id;
    try {
      const saved = await client.saveRun(run.run_id);
      if (state.run?.run_id === run.run_id) {
        emit('look:saved', { savedLook: saved?.look ?? null });
      }
    } catch (error) {
      // The visible image remains a genuine completed run.  A missing library
      // projection simply means downstream scene/shoot/live actions stay absent.
      if (state.run?.run_id === run.run_id) {
        emit('look:save-unavailable', { error: { code: 'LOOK_NOT_SAVED' } });
      }
    } finally {
      if (savingRunId === run.run_id) savingRunId = null;
    }
  }

  function syncRun(run, type = 'run:updated') {
    if (!run) return;
    const phase = phaseFor(run);
    const result = phase === 'completed'
      ? { runId: run.run_id, imageUrl: outputFor(run) }
      : null;
    const choices = phase === 'needs_input' ? choicesFor(run) : [];
    emit(type, {
      run,
      phase,
      choices,
      result,
      error: phase === 'failed' ? { code: 'RUN_FAILED' } : null,
    });
    if (phase === 'completed') void persistCompletedRun(run);
  }

  const unsubscribeClient = client.subscribe((event) => {
    if (disposed) return;
    if (event?.run) {
      syncRun(event.run, event.type ?? 'run:updated');
      return;
    }
    if (event?.type === 'error' || event?.error) recordError(event.error ?? {}, event.type ?? 'error');
  });

  async function probe() {
    if (disposed) return state;
    emit('connection:checking', { availability: 'checking', error: null });
    try {
      const health = await client.health();
      const availability = availabilityFor(health);
      emit('connection:ready', {
        availability,
        phase: availability === 'ready' ? state.phase : 'idle',
        health,
        error: availability === 'ready' ? null : { code: 'MIRROR_UNAVAILABLE' },
      });
    } catch (error) {
      recordError({ ...error, code: 'MIRROR_UNAVAILABLE' }, 'connection:unavailable');
    }
    return state;
  }

  function requireAvailable() {
    if (state.availability !== 'ready') {
      throw new CinematicUiBridgeError('MIRROR_UNAVAILABLE');
    }
  }

  const bridge = {
    client,
    state: () => clone(state),
    subscribe(listener) {
      listeners.add(listener);
      listener({ type: 'snapshot', ...clone(state) });
      return () => listeners.delete(listener);
    },
    probe,
    isReady: () => state.availability === 'ready',
    canStartLook: () => state.availability === 'ready' && !ACTIVE_PHASES.has(state.phase),
    canLeaveAttentionStation: () => !ACTIVE_PHASES.has(state.phase),
    async createLook({ person, identityDetail = null, garments = [], outfitText = '' } = {}) {
      requireAvailable();
      if (!person || !garments.length) {
        throw new CinematicUiBridgeError('INCOMPLETE_LOOK', 'Додайте себе й хоча б одну річ');
      }
      emit('look:submitting', { phase: 'uploading', error: null, choices: [], result: null });
      try {
        const run = await client.createRunFromUploads({ person, identityDetail, garments, outfitText });
        syncRun(run, 'run:created');
        return run;
      } catch (error) {
        recordError(error, 'look:failed');
        throw error;
      }
    },
    async selectGarments(selections) {
      requireAvailable();
      if (!state.run?.run_id || state.phase !== 'needs_input') {
        throw new CinematicUiBridgeError('NO_GARMENT_CHOICE');
      }
      emit('garments:submitting', { phase: 'running', error: null });
      try {
        const run = await client.selectGarments(state.run.run_id, selections);
        syncRun(run, 'run:garments_selected');
        return run;
      } catch (error) {
        recordError(error, 'garments:failed');
        throw error;
      }
    },
    async retryLook() {
      requireAvailable();
      if (!state.run?.run_id) throw new CinematicUiBridgeError('NO_RUN');
      emit('look:retrying', { phase: 'running', error: null });
      try {
        const run = await client.retryRun(state.run.run_id);
        syncRun(run, 'run:retried');
        return run;
      } catch (error) {
        recordError(error, 'look:retry-failed');
        throw error;
      }
    },
    dispose() {
      disposed = true;
      unsubscribeClient?.();
      listeners.clear();
    },
  };

  if (autoProbe) void probe();
  return Object.freeze(bridge);
}
