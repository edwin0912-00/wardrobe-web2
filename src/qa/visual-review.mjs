import { readFile } from 'node:fs/promises';
import { QA_SCHEMA_VERSION, STATUS, VISUAL_CRITERION_IDS } from './constants.mjs';

const ALLOWED_VISUAL_STATUS = new Set([STATUS.PASS, STATUS.FAIL, STATUS.NEEDS_REVIEW]);
const SHA256 = /^[a-f0-9]{64}$/;

export async function loadVisualReview(filePath) {
  if (!filePath) return null;
  const fixture = JSON.parse(await readFile(filePath, 'utf8'));
  if (fixture.schema_version !== QA_SCHEMA_VERSION) {
    throw new Error(`Visual review schema_version must be ${QA_SCHEMA_VERSION}`);
  }
  if (!fixture.reviews || typeof fixture.reviews !== 'object' || Array.isArray(fixture.reviews)) {
    throw new Error('Visual review fixture must contain an object at reviews');
  }
  return fixture;
}

export function visualDecision(fixture, subjectId, artifactName, criterionId, artifactSha256) {
  if (!VISUAL_CRITERION_IDS.includes(criterionId)) {
    throw new Error(`Criterion ${criterionId} is not a visual gate`);
  }
  const artifactReview = fixture?.reviews?.[subjectId]?.[artifactName];
  if (!artifactReview) {
    return {
      status: STATUS.NEEDS_REVIEW,
      source: 'missing_visual_review',
      artifact_sha256: artifactSha256 ?? null,
      reviewed_artifact_sha256: null,
      notes: 'No explicit human/VLM visual review fixture was supplied for this semantic gate.',
    };
  }
  const reviewedArtifactSha256 = artifactReview?.artifact_sha256 ?? null;
  if (reviewedArtifactSha256 !== null && !SHA256.test(reviewedArtifactSha256)) {
    throw new Error(
      `Invalid artifact_sha256 for ${subjectId}/${artifactName}: ${reviewedArtifactSha256}`,
    );
  }
  if (!reviewedArtifactSha256) {
    return {
      status: STATUS.NEEDS_REVIEW,
      source: 'unbound_visual_review',
      artifact_sha256: artifactSha256 ?? null,
      reviewed_artifact_sha256: null,
      notes: 'The semantic review is not bound to the exact reviewed artifact SHA-256.',
    };
  }
  if (!artifactSha256 || reviewedArtifactSha256 !== artifactSha256) {
    return {
      status: STATUS.NEEDS_REVIEW,
      source: 'visual_review_hash_mismatch',
      artifact_sha256: artifactSha256 ?? null,
      reviewed_artifact_sha256: reviewedArtifactSha256,
      notes: 'The reviewed artifact SHA-256 does not match the current output.',
    };
  }
  const decision = artifactReview?.[criterionId];
  if (!decision) {
    return {
      status: STATUS.NEEDS_REVIEW,
      source: 'missing_visual_review',
      artifact_sha256: artifactSha256,
      reviewed_artifact_sha256: reviewedArtifactSha256,
      notes: 'No explicit human/VLM visual review fixture was supplied for this semantic gate.',
    };
  }
  if (!ALLOWED_VISUAL_STATUS.has(decision.status)) {
    throw new Error(
      `Invalid visual status for ${subjectId}/${artifactName}/${criterionId}: ${decision.status}`,
    );
  }
  return {
    status: decision.status,
    source: 'explicit_visual_review_fixture',
    artifact_sha256: artifactSha256,
    reviewed_artifact_sha256: reviewedArtifactSha256,
    reviewer: decision.reviewer ?? fixture.reviewer ?? null,
    reviewed_at: decision.reviewed_at ?? fixture.reviewed_at ?? null,
    notes: decision.notes ?? null,
  };
}
