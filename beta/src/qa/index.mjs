import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NOTION_CRITERIA, QA_SCHEMA_VERSION, STATUS } from './constants.mjs';
import { inspectImage } from './image-inspector.mjs';
import { loadVisualReview, visualDecision } from './visual-review.mjs';

const ARTIFACTS = Object.freeze([
  ['avatar', 'avatar.png'],
  ['avatar_outfit', 'avatar_outfit.png'],
]);

function aggregateStatus(statuses) {
  if (statuses.includes(STATUS.FAIL)) return STATUS.FAIL;
  if (statuses.includes(STATUS.NEEDS_REVIEW)) return STATUS.NEEDS_REVIEW;
  return STATUS.PASS;
}

function automaticGateStatuses(image) {
  return Object.values(image.technical_gates ?? {}).map((gate) => gate.status);
}

function makeCriteria(image, visualFixture, subjectId, artifactName) {
  return NOTION_CRITERIA.map((criterion) => {
    if (criterion.id === 'white_background') {
      return {
        ...criterion,
        status: image.background_diagnostics?.status ?? STATUS.FAIL,
        source: 'automatic_border_diagnostics',
        evidence: image.background_diagnostics,
      };
    }
    const visual = visualDecision(
      visualFixture,
      subjectId,
      artifactName,
      criterion.id,
      image.sha256,
    );
    const automatic_evidence = criterion.id === 'neutral_white_balance'
      ? {
          conservative_background_mean_chroma: image.background_diagnostics?.mean_classified_background_chroma ?? null,
          note: 'This diagnostic cannot establish subject/lighting white balance without semantic review.',
        }
      : criterion.id === 'no_residue_or_bleed'
        ? {
            alpha_channel_absent: image.technical_gates?.no_alpha?.status === STATUS.PASS,
            note: 'Metadata cannot rule out visible residue or bleed; explicit visual review remains required.',
          }
        : undefined;
    return {
      ...criterion,
      ...visual,
      ...(automatic_evidence ? { automatic_evidence } : {}),
    };
  });
}

function pairChecks(avatar, outfit) {
  const dimensionsMatch = avatar.decoded && outfit.decoded
    && avatar.width === outfit.width && avatar.height === outfit.height;
  const aspectDelta = avatar.decoded && outfit.decoded
    ? Math.abs(avatar.aspect_ratio - outfit.aspect_ratio)
    : null;
  return {
    dimensions_match: {
      status: dimensionsMatch ? STATUS.PASS : STATUS.FAIL,
      avatar: avatar.decoded ? `${avatar.width}x${avatar.height}` : null,
      avatar_outfit: outfit.decoded ? `${outfit.width}x${outfit.height}` : null,
    },
    aspect_ratio_parity: {
      status: aspectDelta !== null && aspectDelta <= 0.000001 ? STATUS.PASS : STATUS.FAIL,
      absolute_delta: aspectDelta,
      tolerance: 0.000001,
    },
    nonduplicate: {
      status: avatar.sha256 !== outfit.sha256 ? STATUS.PASS : STATUS.FAIL,
      avatar_sha256: avatar.sha256,
      avatar_outfit_sha256: outfit.sha256,
    },
  };
}

export async function verifyOutput(options = {}) {
  const outputDir = path.resolve(options.outputDir ?? 'output');
  const visualFixture = await loadVisualReview(options.visualReviewPath);
  const entries = await readdir(outputDir, { withFileTypes: true });
  const subjectIds = entries
    .filter((entry) => entry.isDirectory() && /^\d{3}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (subjectIds.length === 0) throw new Error(`No NNN output folders found in ${outputDir}`);

  const summarySubjects = [];
  const allHashes = new Map();
  for (const subjectId of subjectIds) {
    const artifacts = {};
    for (const [artifactName, filename] of ARTIFACTS) {
      const filePath = path.join(outputDir, subjectId, filename);
      const inspected = await inspectImage(filePath, options.backgroundThresholds);
      const image = { ...inspected, path: `${subjectId}/${filename}` };
      const criteria = makeCriteria(image, visualFixture, subjectId, artifactName);
      const status = aggregateStatus([
        ...automaticGateStatuses(image),
        ...criteria.map((criterion) => criterion.status),
      ]);
      artifacts[artifactName] = { ...image, notion_criteria: criteria, status };
      if (image.sha256) {
        const previous = allHashes.get(image.sha256) ?? [];
        previous.push(`${subjectId}/${filename}`);
        allHashes.set(image.sha256, previous);
      }
    }

    const pair_checks = pairChecks(artifacts.avatar, artifacts.avatar_outfit);
    const status = aggregateStatus([
      artifacts.avatar.status,
      artifacts.avatar_outfit.status,
      ...Object.values(pair_checks).map((check) => check.status),
    ]);
    const report = {
      schema_version: QA_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      subject_id: subjectId,
      visual_review_fixture: options.visualReviewPath
        ? path.relative(outputDir, path.resolve(options.visualReviewPath))
        : null,
      status,
      pair_checks,
      artifacts,
    };
    await writeFile(
      path.join(outputDir, subjectId, 'qa-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    summarySubjects.push({
      subject_id: subjectId,
      status,
      report: `${subjectId}/qa-report.json`,
    });
  }

  const crossSubjectDuplicates = [...allHashes.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([sha256, files]) => ({ sha256, files, status: STATUS.FAIL }));
  const status = aggregateStatus([
    ...summarySubjects.map((subject) => subject.status),
    ...(crossSubjectDuplicates.length ? [STATUS.FAIL] : []),
  ]);
  const summary = {
    schema_version: QA_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    output_directory: path.relative(process.cwd(), outputDir) || '.',
    visual_review_fixture: options.visualReviewPath
      ? path.relative(outputDir, path.resolve(options.visualReviewPath))
      : null,
    status,
    subjects: summarySubjects,
    cross_subject_duplicate_check: {
      status: crossSubjectDuplicates.length ? STATUS.FAIL : STATUS.PASS,
      duplicates: crossSubjectDuplicates,
    },
    interpretation: {
      PASS: 'All automatic and explicitly reviewed visual gates passed.',
      FAIL: 'At least one automatic or explicit visual gate failed.',
      NEEDS_REVIEW: 'Automatic checks did not fail, but one or more semantic gates lack explicit review.',
    },
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'qa-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

export { diagnoseBackground, inspectImage } from './image-inspector.mjs';
export { loadVisualReview, visualDecision } from './visual-review.mjs';
export { NOTION_CRITERIA, QA_SCHEMA_VERSION, STATUS } from './constants.mjs';
