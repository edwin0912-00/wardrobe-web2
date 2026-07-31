import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class VideoQaSalvageError extends Error {
  constructor(message, { code = 'VIDEO_QA_SALVAGE_FAILED', cause } = {}) {
    super(message, { cause });
    this.name = 'VideoQaSalvageError';
    this.code = code;
  }
}
function validatedSegments(segments) {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 24) {
    throw new VideoQaSalvageError('Salvage requires one to twenty-four approved segments', {
      code: 'VIDEO_QA_SALVAGE_SEGMENTS_INVALID',
    });
  }
  let totalMs = 0;
  let previousEnd = -1;
  const normalized = segments.map((segment) => {
    const startMs = segment?.start_ms;
    const endMs = segment?.end_ms;
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs)
      || startMs < 0 || endMs - startMs < 125 || startMs < previousEnd) {
      throw new VideoQaSalvageError('Salvage segments must be ordered, disjoint millisecond spans', {
        code: 'VIDEO_QA_SALVAGE_SEGMENTS_INVALID',
      });
    }
    previousEnd = endMs;
    totalMs += endMs - startMs;
    return { start_ms: startMs, end_ms: endMs };
  });
  if (totalMs < 1_000) {
    throw new VideoQaSalvageError('Less than one second of approved hero footage remains', {
      code: 'VIDEO_QA_SALVAGE_TOO_SHORT',
    });
  }
  return { segments: normalized, totalMs };
}

/**
 * Cut a failed provider result down to QA-approved hero-only spans and lay the
 * motion-reference audio continuously under the new edit. The caller must
 * re-run technical and semantic QA on the returned bytes; this function never
 * promotes a clip to PASS by itself.
 */
export async function salvageVideoFromQa({
  sourceVideoPath,
  referenceVideoPath,
  outputVideoPath,
  segments,
}, {
  commandRunner = execFileAsync,
  probeFn,
} = {}) {
  if (![sourceVideoPath, referenceVideoPath, outputVideoPath]
    .every((value) => typeof value === 'string' && value.length > 0)) {
    throw new VideoQaSalvageError('Salvage input and output paths are required', {
      code: 'VIDEO_QA_SALVAGE_MISCONFIGURED',
    });
  }
  if (typeof probeFn !== 'function') {
    throw new VideoQaSalvageError('Salvage requires an ffprobe implementation', {
      code: 'VIDEO_QA_SALVAGE_MISCONFIGURED',
    });
  }
  const { segments: safeSegments, totalMs } = validatedSegments(segments);
  const [sourceProbe, referenceProbe] = await Promise.all([
    probeFn(sourceVideoPath),
    probeFn(referenceVideoPath),
  ]);
  if (!Number.isFinite(sourceProbe?.durationSeconds)
    || safeSegments.at(-1).end_ms > Math.round(sourceProbe.durationSeconds * 1000) + 40) {
    throw new VideoQaSalvageError('Approved segment escapes the provider result duration', {
      code: 'VIDEO_QA_SALVAGE_SEGMENTS_INVALID',
    });
  }
  const hasReferenceAudio = referenceProbe?.hasAudio === true;

  const videoFilters = safeSegments.map((segment, index) => {
    const start = (segment.start_ms / 1000).toFixed(3);
    const end = (segment.end_ms / 1000).toFixed(3);
    return `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`;
  });
  const totalSeconds = totalMs / 1000;
  const fadeSeconds = Math.min(0.2, totalSeconds / 4);
  const fadeStart = Math.max(0, totalSeconds - fadeSeconds);
  const videoFilter = [
    ...videoFilters,
    `${safeSegments.map((_, index) => `[v${index}]`).join('')}concat=n=${safeSegments.length}:v=1:a=0,format=yuv420p[v]`,
  ].join(';');
  const filter = hasReferenceAudio
    ? `${videoFilter};[1:a:0]atrim=duration=${totalSeconds.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)}[a]`
    : videoFilter;
  const audioArgs = hasReferenceAudio
    ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k']
    : ['-an'];
  try {
    await commandRunner('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', sourceVideoPath,
      '-i', referenceVideoPath,
      '-filter_complex', filter,
      '-map', '[v]', ...audioArgs,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-t', totalSeconds.toFixed(3),
      outputVideoPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
  } catch (cause) {
    throw new VideoQaSalvageError('ffmpeg could not build the hero-only delivery edit', { cause });
  }
  return {
    outputVideoPath,
    durationSeconds: totalSeconds,
    segmentCount: safeSegments.length,
    segments: safeSegments,
    audioSource: hasReferenceAudio ? 'MOTION_REFERENCE' : 'SILENT_REFERENCE',
    audioPolicy: hasReferenceAudio ? 'REFERENCE_REQUIRED' : 'SILENT_REQUIRED',
  };
}
