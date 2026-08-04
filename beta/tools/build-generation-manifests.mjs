#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const model = Object.freeze({
  display_name: 'GPT Image 2',
  job_set_type: 'gpt_image_2',
  provider_internal_model: 'videotape-alpha',
});
const parameters = Object.freeze({ aspect_ratio: '3:4', quality: 'high', resolution: '2k' });
const jobs = Object.freeze({
  '001': {
    avatar: '019375a0-4c90-4f8d-adac-37daba061336',
    outfit: '9be680fc-1b51-432e-a8cb-a168f4080d86',
    outfitReferences: [
      ['IDENTITY_PRIMARY', 'artifacts/conditioning/humans/001/normalized.png'],
      ['IDENTITY_FACE_DETAIL', 'artifacts/conditioning/humans/001/face.png'],
      ['GARMENT_PRIMARY', 'artifacts/conditioning/garments/hoodie-green/cutout.png'],
      ['GARMENT_REFERENCE_CARD', 'artifacts/conditioning/garments/hoodie-green/reference-card.png'],
    ],
  },
  '002': {
    avatar: '8342e4d4-daf7-44ed-a824-8a784e240115',
    outfit: '2a0be1b4-57fb-4445-8c84-19b27d3d368a',
    outfitReferences: [
      ['IDENTITY_PRIMARY', 'artifacts/conditioning/humans/002/normalized.png'],
      ['IDENTITY_FACE_DETAIL', 'artifacts/conditioning/humans/002/face.png'],
    ],
  },
  '003': {
    avatar: 'a90b6cb5-5376-4e06-bd16-9b23828eae3a',
    outfit: '022a55de-4798-4a75-81ad-66e5e000cad7',
    outfitReferences: [
      ['IDENTITY_PRIMARY', 'artifacts/conditioning/humans/003/normalized.png'],
      ['IDENTITY_FACE_DETAIL', 'artifacts/conditioning/humans/003/face.png'],
    ],
  },
});
const submissionSubjects = [];

async function sha256(relativePath) {
  return createHash('sha256')
    .update(await readFile(path.join(projectRoot, relativePath)))
    .digest('hex');
}

async function descriptor(order, role, relativePath) {
  return { order, role, path: relativePath, sha256: await sha256(relativePath) };
}

for (const [subjectId, job] of Object.entries(jobs)) {
  const outputRoot = `output/${subjectId}`;
  const identityPackPath = `artifacts/conditioning/humans/${subjectId}/reference-pack.json`;
  const avatarCandidate = `${outputRoot}/candidates/gpt-image-2-avatar-attempt-02-conditioned.png`;
  const outfitCandidate = `${outputRoot}/candidates/gpt-image-2-outfit-attempt-02-conditioned.png`;
  const avatarPrompt = `${outputRoot}/prompts/avatar.compiled.txt`;
  const outfitPrompt = `${outputRoot}/prompts/outfit.compiled.txt`;
  const identityReferences = [
    ['IDENTITY_PRIMARY', `artifacts/conditioning/humans/${subjectId}/normalized.png`],
    ['IDENTITY_FACE_DETAIL', `artifacts/conditioning/humans/${subjectId}/face.png`],
    ['IDENTITY_PERSON_CONTEXT', `artifacts/conditioning/humans/${subjectId}/person.png`],
  ];
  const avatarInputs = await Promise.all(
    identityReferences.map(([role, relativePath], index) => descriptor(index + 1, role, relativePath)),
  );
  const outfitInputs = [await descriptor(1, 'APPROVED_AVATAR_EDIT_BASE', avatarCandidate)];
  for (const [index, [role, relativePath]] of job.outfitReferences.entries()) {
    outfitInputs.push(await descriptor(index + 2, role, relativePath));
  }
  const manifest = {
    schema_version: '1.0.0',
    subject_id: subjectId,
    execution_lane: 'TASK_COMPATIBILITY',
    strict_production_preflight: {
      decision: 'NEEDS_INPUT',
      reason: 'Full body proportions are not observable in the supplied source; the test lane continues with body_build=NOT_EVALUABLE and does not claim full-body preservation.',
      reference_pack: { path: identityPackPath, sha256: await sha256(identityPackPath) },
    },
    provider: {
      transport: 'HIGGSFIELD_CLI',
      cli_version: '0.1.33',
      authenticated_live_generation: true,
    },
    stages: {
      avatar: {
        provider_job_id: job.avatar,
        model,
        parameters,
        prompt: { path: avatarPrompt, sha256: await sha256(avatarPrompt) },
        reference_pack: { path: identityPackPath, sha256: await sha256(identityPackPath) },
        inputs: avatarInputs,
        provider_output: { path: avatarCandidate, sha256: await sha256(avatarCandidate) },
        selected_output: {
          path: `${outputRoot}/avatar.png`,
          sha256: await sha256(`${outputRoot}/avatar.png`),
          postprocess: '4-connected border flood-fill; only near-white connected background pixels changed to RGB(255,255,255)',
        },
      },
      outfit: {
        provider_job_id: job.outfit,
        model,
        parameters,
        prompt: { path: outfitPrompt, sha256: await sha256(outfitPrompt) },
        reference_packs: [
          { path: identityPackPath, sha256: await sha256(identityPackPath) },
          ...(subjectId === '001' ? [{
            path: 'artifacts/conditioning/garments/hoodie-green/reference-pack.json',
            sha256: await sha256('artifacts/conditioning/garments/hoodie-green/reference-pack.json'),
          }] : []),
        ],
        inputs: outfitInputs,
        provider_output: { path: outfitCandidate, sha256: await sha256(outfitCandidate) },
        selected_output: {
          path: `${outputRoot}/avatar_outfit.png`,
          sha256: await sha256(`${outputRoot}/avatar_outfit.png`),
          postprocess: '4-connected border flood-fill; only near-white connected background pixels changed to RGB(255,255,255)',
        },
      },
    },
    qa: {
      report: `${outputRoot}/qa-report.json`,
      report_sha256: await sha256(`${outputRoot}/qa-report.json`),
      visual_review: 'reviews/visual-review.json',
      visual_review_sha256: await sha256('reviews/visual-review.json'),
    },
  };
  const manifestPath = `${outputRoot}/generation-manifest.json`;
  await writeFile(path.join(projectRoot, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  submissionSubjects.push({
    subject_id: subjectId,
    generation_manifest: { path: manifestPath, sha256: await sha256(manifestPath) },
    outputs: [
      await descriptor(1, 'CANONICAL_AVATAR', `${outputRoot}/avatar.png`),
      await descriptor(2, 'OUTFIT_RESULT', `${outputRoot}/avatar_outfit.png`),
    ],
    qa_status: 'PASS',
  });
}

const qaSummary = JSON.parse(await readFile(path.join(projectRoot, 'output/qa-summary.json'), 'utf8'));
const submissionManifest = {
  schema_version: '1.0.0',
  task: 'ZEELY_CORE_IMAGE_TEST',
  status: qaSummary.status,
  required_subject_count: 3,
  required_output_count: 6,
  subjects: submissionSubjects,
  model_policy: {
    primary: { name: 'GPT Image 2', job_set_type: 'gpt_image_2' },
    fallbacks: [
      { name: 'Nano Banana 2', job_set_type: 'nano_banana_flash' },
      { name: 'Nano Banana Pro', job_set_type: 'nano_banana_2' },
    ],
  },
  qa_summary: {
    path: 'output/qa-summary.json',
    sha256: await sha256('output/qa-summary.json'),
  },
  contact_sheet: {
    path: 'output/contact-sheet.png',
    sha256: await sha256('output/contact-sheet.png'),
  },
};
await writeFile(
  path.join(projectRoot, 'output/submission-manifest.json'),
  `${JSON.stringify(submissionManifest, null, 2)}\n`,
);

process.stdout.write(`Wrote ${Object.keys(jobs).length} generation manifests and output/submission-manifest.json.\n`);
