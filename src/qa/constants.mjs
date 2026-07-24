export const QA_SCHEMA_VERSION = '1.1.0';

export const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
});

export const NOTION_CRITERIA = Object.freeze([
  {
    id: 'white_background',
    label: 'Exact #FFFFFF studio background',
    evaluation_mode: 'automatic',
  },
  {
    id: 'identity_preservation',
    label: 'Identity preserved: face, hair, skin tone and body build',
    evaluation_mode: 'visual',
  },
  {
    id: 'frontal_half_body_composition',
    label: 'Frontal half-body composition',
    evaluation_mode: 'visual',
  },
  {
    id: 'studio_lighting',
    label: 'Even professional studio lighting',
    evaluation_mode: 'visual',
  },
  {
    id: 'neutral_white_balance',
    label: 'Neutral white balance',
    evaluation_mode: 'hybrid',
  },
  {
    id: 'face_hair_detail',
    label: 'Sharp natural face and hair detail',
    evaluation_mode: 'visual',
  },
  {
    id: 'photorealism',
    label: 'Photorealistic result without plastic skin',
    evaluation_mode: 'visual',
  },
  {
    id: 'outfit_fidelity',
    label: 'Outfit text/reference fidelity',
    evaluation_mode: 'visual',
  },
  {
    id: 'anatomy',
    label: 'Correct anatomy, including hands when visible',
    evaluation_mode: 'visual',
  },
  {
    id: 'no_residue_or_bleed',
    label: 'No source-background residue, bleed or generation artifacts',
    evaluation_mode: 'hybrid',
  },
]);

export const VISUAL_CRITERION_IDS = Object.freeze(
  NOTION_CRITERIA
    .filter((criterion) => criterion.evaluation_mode !== 'automatic')
    .map((criterion) => criterion.id),
);
