import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import { REQUIRED_REFERENCE_CHECKS } from './video-service.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export class VideoSemanticQaError extends Error {
  constructor(message, { code = 'VIDEO_AUTOMATIC_QA_FAILED', cause } = {}) {
    super(message, { cause });
    this.name = 'VideoSemanticQaError';
    this.code = code;
  }
}

async function extractJpeg(commandRunner, videoPath, seconds, outputPath) {
  await commandRunner('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', seconds.toFixed(3), '-i', videoPath,
    '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '2', outputPath,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const bytes = await readFile(outputPath);
  return { path: outputPath, sha256: sha256(bytes) };
}

async function contactSheet(framePaths, outputPath) {
  const width = 256;
  const height = 455;
  const columns = 4;
  const rows = Math.ceil(framePaths.length / columns);
  const composites = await Promise.all(framePaths.map(async (filename, index) => ({
    input: await sharp(filename).resize(width, height, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer(),
    left: (index % columns) * width,
    top: Math.floor(index / columns) * height,
  })));
  await sharp({
    create: { width: width * columns, height: height * rows, channels: 3, background: '#111111' },
  }).composite(composites).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(outputPath);
  return outputPath;
}

function reviewCuts(clip, videoReference) {
  if (clip.salvage?.status === 'NEEDS_QA' && Array.isArray(clip.salvage.segments)) {
    let outputStart = 0;
    return clip.salvage.segments.map((segment, index) => {
      const duration = segment.end_ms - segment.start_ms;
      const cut = {
        cut_index: index,
        start_ms: outputStart,
        end_ms: outputStart + duration,
        reference_start_ms: segment.start_ms,
        reference_end_ms: segment.end_ms,
      };
      outputStart += duration;
      return cut;
    });
  }
  const referenceCuts = videoReference?.cut_sheet?.cuts ?? [];
  const referenceDurationMs = referenceCuts.at(-1)?.end_ms;
  const outputDurationMs = Math.round(
    (clip.deliveryDurationSeconds ?? clip.durationSeconds) * 1000,
  );
  const scale = Number.isInteger(referenceDurationMs) && referenceDurationMs > 0
    && Number.isFinite(outputDurationMs) && outputDurationMs > 0
    ? outputDurationMs / referenceDurationMs
    : 1;
  return referenceCuts.map((cut) => ({
    cut_index: cut.cut_index,
    start_ms: Math.round(cut.start_ms * scale),
    end_ms: Math.round(cut.end_ms * scale),
    reference_start_ms: cut.start_ms,
    reference_end_ms: cut.end_ms,
  }));
}

function checkMap(result) {
  return new Map((result?.checks ?? []).map((check) => [check.name, check]));
}

function videoPromptText(cutCount) {
  const global = REQUIRED_REFERENCE_CHECKS.join(', ');
  const perCut = Array.from({ length: cutCount }, (_, index) =>
    `CUT_${index}_APPROVED_AVATAR_ONLY and CUT_${index}_REFERENCE_PERFORMER_ABSENT`).join(', ');
  return `Fashion Video QA contract. IDENTITY_REFERENCE and OUTFIT_REFERENCE are the exact approved person and complete outfit. GENERATED_CANDIDATE is an ordered output contact sheet with two samples per cut. QUALITY_REFERENCE_1 is the corresponding ordered source-video contact sheet with the same two samples per cut. Preserve the reference environment, light, grade, camera, pose timing, shot sequence and transitions, but replace the reference performer and clothing everywhere. Return checks with these exact unique names: ${global}, ${perCut}. A CUT_*_APPROVED_AVATAR_ONLY check passes only when both output samples visibly contain the approved person and outfit, or the cut intentionally contains no person. CUT_*_REFERENCE_PERFORMER_ABSENT passes only when neither output sample contains the source-video performer, their face, body or clothing. Every global check is blocking. Do not omit or rename checks.`;
}

/**
 * Produces immutable service receipts from real output/reference frame samples.
 * Pixel-identical reference copies are rejected deterministically without a
 * model call; all other results require the configured visual evaluator.
 */
export function createVideoSemanticQaEvaluator({
  evaluator,
  fashionVideoReferenceResolver,
  commandRunner,
} = {}) {
  if (!evaluator || typeof evaluator.evaluateQa !== 'function') {
    throw new VideoSemanticQaError('Video semantic evaluator is not configured', {
      code: 'VIDEO_AUTOMATIC_QA_MISCONFIGURED',
    });
  }
  if (typeof fashionVideoReferenceResolver !== 'function' || typeof commandRunner !== 'function') {
    throw new VideoSemanticQaError('Video reference resolver and ffmpeg runner are required', {
      code: 'VIDEO_AUTOMATIC_QA_MISCONFIGURED',
    });
  }

  return async function evaluateVideoClip(clip) {
    const reference = await fashionVideoReferenceResolver({
      motionMode: clip.mode,
      referenceId: clip.motionReferenceBinding?.referenceId,
    });
    if (reference?.state !== 'READY'
      || reference.reference_sha256 !== clip.motionReferenceBinding?.sha256) {
      throw new VideoSemanticQaError('Video QA reference changed after generation', {
        code: 'VIDEO_AUTOMATIC_QA_REFERENCE_MISMATCH',
      });
    }
    const clipDir = path.dirname(clip.videoPath);
    const sourcePath = path.join(clipDir, 'source.png');
    const referencePath = path.join(clipDir, clip.motionReferenceBinding.audioSourceFile ?? 'style-reference.mp4');
    const [sourceBytes, referenceBytes] = await Promise.all([
      readFile(sourcePath), readFile(referencePath),
    ]);
    if (sha256(sourceBytes) !== clip.sourceSha256 || sha256(referenceBytes) !== reference.reference_sha256) {
      throw new VideoSemanticQaError('Video QA evidence failed its immutable hash binding', {
        code: 'VIDEO_AUTOMATIC_QA_EVIDENCE_MISMATCH',
      });
    }

    const cuts = reviewCuts(clip, reference);
    if (cuts.length < 1 || cuts.length > 24) {
      throw new VideoSemanticQaError('Video QA has no valid cut plan', {
        code: 'VIDEO_AUTOMATIC_QA_CUT_PLAN_INVALID',
      });
    }
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-video-qa-'));
    try {
      const sampled = [];
      for (const cut of cuts) {
        const outputDuration = cut.end_ms - cut.start_ms;
        const referenceDuration = cut.reference_end_ms - cut.reference_start_ms;
        const outputHashes = [];
        const referenceHashes = [];
        const outputFrames = [];
        const referenceFrames = [];
        for (const [sampleIndex, fraction] of [1 / 3, 2 / 3].entries()) {
          const outputSeconds = (cut.start_ms + outputDuration * fraction) / 1000;
          const referenceSeconds = (cut.reference_start_ms + referenceDuration * fraction) / 1000;
          const output = await extractJpeg(
            commandRunner, clip.videoPath, outputSeconds,
            path.join(temporaryRoot, `output-${cut.cut_index}-${sampleIndex}.jpg`),
          );
          const referenceFrame = await extractJpeg(
            commandRunner, referencePath, referenceSeconds,
            path.join(temporaryRoot, `reference-${cut.cut_index}-${sampleIndex}.jpg`),
          );
          outputHashes.push(output.sha256);
          referenceHashes.push(referenceFrame.sha256);
          outputFrames.push(output.path);
          referenceFrames.push(referenceFrame.path);
        }
        sampled.push({ cut, outputHashes, referenceHashes, outputFrames, referenceFrames });
      }

      const exactReferenceCopy = sampled.every((sample) =>
        sample.outputHashes.every((hash, index) => hash === sample.referenceHashes[index]));
      let result = null;
      if (!exactReferenceCopy) {
        const outputSheet = await contactSheet(
          sampled.flatMap((sample) => sample.outputFrames),
          path.join(temporaryRoot, 'output-contact.jpg'),
        );
        const referenceSheet = await contactSheet(
          sampled.flatMap((sample) => sample.referenceFrames),
          path.join(temporaryRoot, 'reference-contact.jpg'),
        );
        result = await evaluator.evaluateQa({
          phase: 'scene',
          idempotencyKey: `video-qa:${clip.clipId}:${clip.videoSha256}`,
          evidence_manifest_sha256: sha256(Buffer.from(JSON.stringify({
            clip: clip.videoSha256,
            reference: reference.reference_sha256,
            output_frames: sampled.flatMap((sample) => sample.outputHashes),
            reference_frames: sampled.flatMap((sample) => sample.referenceHashes),
          }))),
          evidence: {
            identity: { artifact: { path: sourcePath } },
            outfit: { artifact: { path: sourcePath }, facts: { text: videoPromptText(cuts.length) } },
            candidate: { artifact: { path: outputSheet } },
            quality_references: [referenceSheet],
          },
        });
      }
      const checks = checkMap(result);
      if (!exactReferenceCopy) {
        const expectedNames = [
          ...REQUIRED_REFERENCE_CHECKS,
          ...cuts.flatMap((cut) => [
            `CUT_${cut.cut_index}_APPROVED_AVATAR_ONLY`,
            `CUT_${cut.cut_index}_REFERENCE_PERFORMER_ABSENT`,
          ]),
        ];
        if (expectedNames.some((name) => typeof checks.get(name)?.pass !== 'boolean')) {
          throw new VideoSemanticQaError('Visual evaluator omitted required Fashion Video checks', {
            code: 'VIDEO_AUTOMATIC_QA_RECEIPT_INVALID',
          });
        }
      }

      const cutCoverage = sampled.map((sample) => {
        const approved = !exactReferenceCopy
          && checks.get(`CUT_${sample.cut.cut_index}_APPROVED_AVATAR_ONLY`).pass === true;
        const referenceAbsent = !exactReferenceCopy
          && checks.get(`CUT_${sample.cut.cut_index}_REFERENCE_PERFORMER_ABSENT`).pass === true;
        return {
          cut_index: sample.cut.cut_index,
          start_ms: sample.cut.start_ms,
          end_ms: sample.cut.end_ms,
          sample_count: sample.outputHashes.length,
          output_frame_sha256s: sample.outputHashes,
          reference_frame_sha256s: sample.referenceHashes,
          reference_performer_visible: !referenceAbsent,
          visible_people: approved && referenceAbsent
            ? 'APPROVED_AVATAR_ONLY'
            : exactReferenceCopy || !referenceAbsent
              ? 'REFERENCE_PERFORMER'
              : 'MIXED_OR_UNKNOWN',
          decision: approved && referenceAbsent ? 'PASS' : 'FAIL',
        };
      });
      const firstPass = cutCoverage[0].decision === 'PASS';
      const lastPass = cutCoverage.at(-1).decision === 'PASS';
      const evaluatorReceipt = exactReferenceCopy
        ? 'deterministic/exact-reference-copy-v1'
        : result.evaluator;
      const outputBinding = clip.salvage?.status === 'NEEDS_QA'
        ? { output_sha256: clip.videoSha256 }
        : {};
      return {
        identityReceipt: {
          clip_id: clip.clipId,
          job_id: clip.jobId,
          source_sha256: clip.sourceSha256,
          ...outputBinding,
          evaluator: evaluatorReceipt,
          results: {
            first: { decision: firstPass ? 'PASS' : 'RETRY' },
            last: { decision: lastPass ? 'PASS' : 'RETRY' },
          },
        },
        referenceReceipt: {
          clip_id: clip.clipId,
          job_id: clip.jobId,
          source_sha256: clip.sourceSha256,
          motion_reference_sha256: clip.motionReferenceBinding.sha256,
          ...outputBinding,
          evaluator: evaluatorReceipt,
          cut_coverage: { sample_rate_fps: 2, cuts: cutCoverage },
          checks: REQUIRED_REFERENCE_CHECKS.map((name) => ({
            name,
            decision: exactReferenceCopy
              ? (name === 'cut_coverage_complete'
                  || ['motion_and_pose_timing', 'camera_and_framing', 'environment_and_lighting',
                    'grade_and_optical_effects', 'shot_sequence_and_transitions'].includes(name)
                    ? 'PASS' : 'FAIL')
              : checks.get(name).pass ? 'PASS' : 'FAIL',
          })),
        },
        exactReferenceCopy,
      };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  };
}
