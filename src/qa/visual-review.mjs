import { readFile } from 'node:fs/promises';
import { QA_SCHEMA_VERSION, STATUS, VISUAL_CRITERION_IDS } from './constants.mjs';

const ALLOWED_VISUAL_STATUS = new Set([STATUS.PASS, STATUS.FAIL, STATUS.NEEDS_REVIEW]);

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

export function visualDecision(fixture, subjectId, artifactName, criterionId) {
  if (!VISUAL_CRITERION_IDS.includes(criterionId)) {
    throw new Error(`Criterion ${criterionId} is not a visual gate`);
  }
  const decision = fixture?.reviews?.[subjectId]?.[artifactName]?.[criterionId];
  if (!decision) {
    return {
      status: STATUS.NEEDS_REVIEW,
      source: 'missing_visual_review',
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
    reviewer: decision.reviewer ?? fixture.reviewer ?? null,
    reviewed_at: decision.reviewed_at ?? fixture.reviewed_at ?? null,
    notes: decision.notes ?? null,
  };
}

