import { assertExternalPromptPrivacy } from './provider-prompt-privacy.js';

// Fashion video transport: Higgsfield CLI, model `seedance_2_0`, driven the same
// two-phase way as the image route — create returns a job id, wait polls it —
// so a restart resumes a recorded remote job instead of paying twice.
//
// Three decisions are encoded here rather than left to a caller, because each one
// has already cost real money or a bad delivery somewhere in this project:
//
// 1. Aspect and duration are provider parameters, never prompt prose. A model
//    asked in words for a frame shape returns the shape it likes.
// 2. `generate_audio` is forced off. The model invents a soundtrack by default,
//    and invented audio must never reach a delivery. Music is laid in afterwards.
// 3. The aspect is 16:9 by operator decision (2026-07-28). Seedance offers no
//    4:5, so a 4:5 delivery would mean cropping a generated frame — that is a
//    separate, declared post step, not something this provider hides.

export const SEEDANCE_MODEL = 'seedance_2_0';
export const SEEDANCE_MINI_MODEL = 'seedance_2_0_mini';

// Measured with `higgsfield model get seedance_2_0` on 2026-07-28. Note the
// absence of 4:5 — that absence is the reason rule 3 above exists.
export const SEEDANCE_SPEC = Object.freeze({
  aspectRatios: Object.freeze(['auto', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9']),
  resolutions: Object.freeze(['480p', '720p', '1080p', '4k']),
  modes: Object.freeze(['std', 'fast']),
  bitrateModes: Object.freeze(['standard', 'high']),
  genres: Object.freeze(['auto', 'action', 'horror', 'comedy', 'noir', 'drama', 'epic']),
  durationSeconds: Object.freeze({ minimum: 3, maximum: 15 }),
});

export const DEFAULT_VIDEO_REQUEST = Object.freeze({
  model: SEEDANCE_MODEL,
  aspectRatio: '16:9',
  resolution: '720p',
  durationSeconds: 5,
  mode: 'std',
  bitrateMode: 'standard',
  genre: 'auto',
});

const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DURATION_FLAG = /^\d+(?:ms|s|m|h)$/;

export class VideoProviderError extends Error {
  constructor(message, { code = 'VIDEO_PROVIDER_ERROR', retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'VideoProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

function assertChoice(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new VideoProviderError(`${label} is not supported: ${String(value)}`, {
      code: 'INVALID_VIDEO_OPTION',
    });
  }
}

function assertModel(model) {
  if (model !== SEEDANCE_MODEL && model !== SEEDANCE_MINI_MODEL) {
    throw new VideoProviderError(`Unsupported video model: ${String(model)}`, {
      code: 'INVALID_VIDEO_OPTION',
    });
  }
}

function assertDuration(seconds) {
  const { minimum, maximum } = SEEDANCE_SPEC.durationSeconds;
  if (!Number.isInteger(seconds) || seconds < minimum || seconds > maximum) {
    throw new VideoProviderError(
      `duration must be a whole number of seconds between ${minimum} and ${maximum}`,
      { code: 'INVALID_VIDEO_OPTION' },
    );
  }
}

function assertPrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new VideoProviderError('A motion prompt is required', { code: 'MISSING_VIDEO_PROMPT' });
  }
  // Same guard the image route uses: a local path or a runtime identifier must
  // never leave this machine inside a prompt.
  try {
    assertExternalPromptPrivacy(prompt);
  } catch (cause) {
    throw new VideoProviderError('Motion prompt contains private local metadata', {
      code: 'UNSAFE_PROVIDER_PROMPT',
      cause,
    });
  }
  // The three things that belong in parameters. Catching them here is what stops
  // a caller from quietly re-introducing prompt-driven geometry.
  const forbidden = [
    [/\b(?:16:9|9:16|4:5|3:4|4:3|21:9|1:1)\b/, 'an aspect ratio'],
    [/\b\d+\s*(?:seconds?|sec|s)\b/i, 'a duration'],
    [/\b(?:480p|720p|1080p|4k)\b/i, 'a resolution'],
  ];
  for (const [pattern, what] of forbidden) {
    if (pattern.test(prompt)) {
      throw new VideoProviderError(
        `The motion prompt names ${what}; that belongs in the provider parameters`,
        { code: 'GEOMETRY_IN_PROMPT' },
      );
    }
  }
}

/**
 * Exact argv for creating a Seedance job. Does not wait: the job id is recorded
 * first so a crash between create and wait cannot orphan a paid job.
 */
export function buildVideoCreateArgs({
  model = DEFAULT_VIDEO_REQUEST.model,
  prompt,
  mediaPaths = [],
  videoPaths = [],
  aspectRatio = DEFAULT_VIDEO_REQUEST.aspectRatio,
  resolution = DEFAULT_VIDEO_REQUEST.resolution,
  durationSeconds = DEFAULT_VIDEO_REQUEST.durationSeconds,
  mode = DEFAULT_VIDEO_REQUEST.mode,
  bitrateMode = DEFAULT_VIDEO_REQUEST.bitrateMode,
  genre = DEFAULT_VIDEO_REQUEST.genre,
} = {}) {
  assertModel(model);
  assertPrompt(prompt);
  assertChoice(aspectRatio, SEEDANCE_SPEC.aspectRatios, 'aspect_ratio');
  assertChoice(resolution, SEEDANCE_SPEC.resolutions, 'resolution');
  assertChoice(mode, SEEDANCE_SPEC.modes, 'mode');
  assertChoice(bitrateMode, SEEDANCE_SPEC.bitrateModes, 'bitrate_mode');
  assertChoice(genre, SEEDANCE_SPEC.genres, 'genre');
  assertDuration(durationSeconds);
  if (!Array.isArray(mediaPaths) || mediaPaths.length === 0) {
    throw new VideoProviderError('A locked source frame is required', {
      code: 'MISSING_VIDEO_SOURCE',
    });
  }
  if (!Array.isArray(videoPaths)
    || videoPaths.some((videoPath) => typeof videoPath !== 'string' || videoPath.length === 0)) {
    throw new VideoProviderError('Video references must be local file paths', {
      code: 'INVALID_VIDEO_REFERENCE',
    });
  }

  const args = [
    'generate', 'create', model,
    '--prompt', prompt,
    '--aspect_ratio', aspectRatio,
    '--resolution', resolution,
    '--duration', String(durationSeconds),
    '--mode', mode,
    '--bitrate_mode', bitrateMode,
    '--genre', genre,
    // Never negotiable: invented audio does not ship.
    '--generate_audio', 'false',
  ];
  // Video must be the first ordered medium. Fashion V2V prompts refer to it as
  // Video 1 (temporal/scene authority) and the following images as Image 1–3
  // (appearance authority). Reversing this order made the white-background
  // approved look the dominant start frame and reduced Fashion Video to a
  // passport-photo animation.
  for (const videoPath of videoPaths) args.push('--video', videoPath);
  for (const mediaPath of mediaPaths) args.push('--image', mediaPath);
  args.push('--json', '--no-color');
  return args;
}

/** Exact argv for polling an existing job. */
export function buildVideoWaitArgs({ jobId, waitTimeout = '20m', waitInterval = '5s' }) {
  if (typeof jobId !== 'string' || !SAFE_JOB_ID.test(jobId)) {
    throw new VideoProviderError('Video job id is unsafe or invalid', {
      code: 'INVALID_VIDEO_JOB_ID',
    });
  }
  for (const [value, label] of [[waitTimeout, 'waitTimeout'], [waitInterval, 'waitInterval']]) {
    if (typeof value !== 'string' || !DURATION_FLAG.test(value)) {
      throw new VideoProviderError(`${label} must be a bounded CLI duration`, {
        code: 'INVALID_VIDEO_OPTION',
      });
    }
  }
  return ['generate', 'wait', jobId, '--timeout', waitTimeout, '--interval', waitInterval, '--json', '--no-color'];
}

function parseJson(stdout, what) {
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new VideoProviderError(`Provider ${what} response is not JSON`, {
      code: 'PROVIDER_RESPONSE_INVALID',
      retryable: true,
      cause,
    });
  }
}

function providerCommandFailure(cause, phase) {
  const detail = [cause?.message, cause?.stderr, cause?.stdout]
    .filter((value) => typeof value === 'string')
    .join('\n');
  if (/\bjob not found\b/i.test(detail)) {
    return new VideoProviderError('The persisted Higgsfield job no longer exists', {
      code: 'PROVIDER_JOB_NOT_FOUND',
      retryable: false,
      cause,
    });
  }
  return new VideoProviderError(`Higgsfield ${phase} command failed`, {
    code: 'PROVIDER_COMMAND_FAILED',
    retryable: true,
    cause,
  });
}

function findJobId(payload) {
  const queue = [payload];
  const seen = new Set();
  while (queue.length > 0) {
    const value = queue.shift();
    // Higgsfield CLI 1.1.20 returns a successful create as a bare JSON array
    // of UUID strings (`["job-id"]`), not an object envelope.  Treat a safe
    // string as a job id before looking for object fields.
    if (typeof value === 'string' && SAFE_JOB_ID.test(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const candidates = [
      value.job_id,
      value.job_set_id,
      value.id,
      value.job?.id,
      value.job_ids?.[0],
      value.jobs?.[0]?.id,
    ];
    const match = candidates.find(
      (candidate) => typeof candidate === 'string' && SAFE_JOB_ID.test(candidate),
    );
    if (match) return match;
    // Higgsfield CLI envelopes have changed between releases (`data`,
    // `job_set`, batched arrays). Traverse every nested value instead of
    // treating an accepted create as failed and accidentally paying for a
    // duplicate retry when the id is merely wrapped one level deeper.
    queue.push(...Object.values(value));
  }
  return null;
}

const OUTPUT_CONTAINER_FIELDS = new Set(['output', 'outputs', 'result', 'results', 'artifacts']);
// Higgsfield has emitted both `result_url` (the image-style CLI envelope) and
// the more explicit video keys over time. Keep the generic `url` key scoped to
// an output container below so an input/reference URL can never be selected.
const OUTPUT_URL_FIELDS = new Set([
  'url', 'video_url', 'output_url', 'result_url', 'download_url', 'file_url',
]);
const ROOT_OUTPUT_URL_FIELDS = new Set([
  'video_url', 'output_url', 'result_url', 'download_url', 'file_url',
]);
const NON_OUTPUT_FIELDS = new Set(['input', 'inputs', 'request', 'source', 'sources', 'reference', 'references']);

function pointerPart(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function isVideoUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && /\.(?:mp4|mov|webm)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Select only an explicit completed-result media field from the envelope that
 * answered for the persisted job. Provider payloads also contain input media
 * URLs; scanning arbitrary JSON strings can therefore bind Video 1 itself as
 * the generated output. Ambiguous explicit outputs fail closed.
 */
function findExplicitVideoOutput(payload) {
  const candidates = [];
  const seen = new Set();

  function walk(value, parts, insideOutputContainer = false) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (NON_OUTPUT_FIELDS.has(key)) continue;
      const nextParts = [...parts, key];
      const nextInside = insideOutputContainer || OUTPUT_CONTAINER_FIELDS.has(key);
      const explicitRootOutput = parts.length === 0 && ROOT_OUTPUT_URL_FIELDS.has(key);
      if ((nextInside || explicitRootOutput)
        && (OUTPUT_URL_FIELDS.has(key) || OUTPUT_CONTAINER_FIELDS.has(key))
        && isVideoUrl(child)) {
        candidates.push({
          url: child,
          selectedFieldPath: `/${nextParts.map(pointerPart).join('/')}`,
        });
      }
      if (nextInside && Array.isArray(child)) {
        child.forEach((entry, index) => walk(entry, [...nextParts, index], true));
      } else if (nextInside || OUTPUT_CONTAINER_FIELDS.has(key)) {
        walk(child, nextParts, nextInside);
      }
    }
  }

  walk(payload, []);
  const unique = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  if (unique.size === 1) return [...unique.values()][0];
  if (unique.size > 1) {
    throw new VideoProviderError('Provider returned multiple explicit video outputs', {
      code: 'AMBIGUOUS_VIDEO_OUTPUT',
      retryable: false,
    });
  }
  return null;
}

/**
 * Two-phase video transport over the CLI.
 *
 * `commandRunner` receives (binary, argv) and resolves { stdout, stderr }; tests
 * pass a stub so the whole contract is provable without spending a credit.
 * `onJobCreated` is awaited before the wait phase begins — that is the hook a
 * caller uses to persist the job id, which is what makes a resume possible.
 */
export class HiggsfieldVideoProvider {
  #binary;

  #run;

  constructor({ binary = 'higgsfield', commandRunner } = {}) {
    if (typeof commandRunner !== 'function') {
      throw new VideoProviderError('A commandRunner is required', { code: 'PROVIDER_MISCONFIGURED' });
    }
    this.#binary = binary;
    this.#run = commandRunner;
  }

  async createJob(request) {
    const args = buildVideoCreateArgs(request);
    const { stdout } = await this.#run(this.#binary, args);
    const payload = parseJson(stdout, 'create');
    const jobId = findJobId(payload);
    if (!jobId) {
      throw new VideoProviderError('Provider did not return a job id', {
        // The provider may already have accepted and billed the create. An
        // unparseable acknowledgement is an unknown outcome that must be
        // reconciled against provider history, never paid again automatically.
        code: 'CREATE_OUTCOME_UNKNOWN',
        retryable: false,
      });
    }
    return { jobId, request: { ...DEFAULT_VIDEO_REQUEST, ...request }, argv: args, raw: payload };
  }

  async waitForJob({ jobId, waitTimeout, waitInterval }) {
    const args = buildVideoWaitArgs({ jobId, waitTimeout, waitInterval });
    let stdout;
    try {
      ({ stdout } = await this.#run(this.#binary, args));
    } catch (cause) {
      throw providerCommandFailure(cause, 'wait');
    }
    const payload = parseJson(stdout, 'wait');
    const returnedId = findJobId(payload);
    if (returnedId !== jobId) {
      throw new VideoProviderError('Provider wait answered about a different job', {
        code: 'PROVIDER_JOB_MISMATCH',
      });
    }
    const selected = findExplicitVideoOutput(payload);
    if (!selected) {
      throw new VideoProviderError('Provider finished without a video URL', {
        code: 'MISSING_VIDEO_OUTPUT',
        retryable: true,
      });
    }
    return { jobId, url: selected.url, selectedFieldPath: selected.selectedFieldPath, raw: payload };
  }

  /** Create, hand the job id to the caller for persistence, then wait. */
  async generate(request, { onJobCreated, waitTimeout, waitInterval } = {}) {
    const created = await this.createJob(request);
    if (typeof onJobCreated === 'function') await onJobCreated(created);
    const finished = await this.waitForJob({ jobId: created.jobId, waitTimeout, waitInterval });
    return { ...created, ...finished };
  }
}
