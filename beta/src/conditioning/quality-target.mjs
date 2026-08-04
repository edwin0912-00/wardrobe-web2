import sharp from 'sharp';

import { canonicalJson } from './hash-lineage.mjs';
import { readInputBytes } from './input.mjs';

const FIELD_ALIASES = Object.freeze({
  background: 'background_color',
  backgroundColor: 'background_color',
  background_color: 'background_color',
  framing: 'framing',
  pose: 'pose',
  lighting: 'lighting',
  whiteBalance: 'white_balance',
  white_balance: 'white_balance',
  finish: 'finish',
  detail: 'detail',
});

function rgbToHex(rgb) {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Measures corner pixels only; it does not infer the semantic scene background. */
export async function measureSampleBackground(input, { maxAnalysisEdge = 512, cornerFraction = 0.08 } = {}) {
  const bytes = await readInputBytes(input);
  const { data, info } = await sharp(bytes, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .removeAlpha()
    .resize({ width: maxAnalysisEdge, height: maxAnalysisEdge, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const patchWidth = Math.max(1, Math.floor(info.width * cornerFraction));
  const patchHeight = Math.max(1, Math.floor(info.height * cornerFraction));
  const origins = [
    [0, 0],
    [info.width - patchWidth, 0],
    [0, info.height - patchHeight],
    [info.width - patchWidth, info.height - patchHeight],
  ];
  const cornerRgb = origins.map(([originX, originY]) => {
    const channels = [[], [], []];
    for (let y = originY; y < originY + patchHeight; y += 1) {
      for (let x = originX; x < originX + patchWidth; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        channels[0].push(data[offset]);
        channels[1].push(data[offset + 1]);
        channels[2].push(data[offset + 2]);
      }
    }
    return channels.map(median);
  });
  const rgb = [0, 1, 2].map((channel) => median(cornerRgb.map((corner) => corner[channel])));
  const maxSpread = Math.max(...[0, 1, 2].map((channel) => {
    const values = cornerRgb.map((corner) => corner[channel]);
    return Math.max(...values) - Math.min(...values);
  }));
  return {
    background_color: rgbToHex(rgb),
    background_rgb: rgb.map(Math.round),
    corner_rgb: cornerRgb.map((corner) => corner.map(Math.round)),
    corner_spread: maxSpread,
    confidence: Number(Math.max(0, 1 - maxSpread / 255).toFixed(6)),
    method: 'MEDIAN_OF_FOUR_CORNER_PATCHES',
  };
}

function parseWrittenText(text) {
  const values = {};
  const normalized = text.normalize('NFKC');
  const lower = normalized.toLowerCase();
  const backgroundHex = normalized.match(/(?:background|фон)[^#\n]{0,60}(#[a-fA-F0-9]{6})/i);
  if (backgroundHex) values.background_color = backgroundHex[1].toUpperCase();
  else if (/(?:background|фон)[^\n]{0,50}(?:pure|exact|solid|чист\w*|точн\w*)?\s*(?:white|білий|білого)/i.test(normalized)) {
    values.background_color = '#FFFFFF';
  }
  // Half-body wording is deliberately left unmatched: the shipped avatar contract renders
  // the figure head to soles, so a written rule asking for head-to-hips describes a frame
  // no stage produces, and matching it would carry that frame into a conditioning report.
  if (/full[- ]?(?:body|length)|head\s+to\s+(?:toe|toes|feet|soles)|повн\w*\s+зріст|весь\s+зріст|від\s+голови\s+до\s+ст[оу]п/.test(lower)) {
    values.framing = 'FULL_LENGTH_HEAD_TO_SOLES';
  }
  if (/(?:neutral|нейтральн\w*)[^.\n]{0,30}(?:frontal|front[- ]facing|фронтальн\w*)|(?:frontal|фронтальн\w*)[^.\n]{0,30}(?:neutral|нейтральн\w*)/.test(lower)) {
    values.pose = 'NEUTRAL_FRONTAL';
  }
  if (/(?:soft|м.?як\w*)[^.\n]{0,30}(?:diffused|studio|розсіян\w*|студійн\w*)/.test(lower)) {
    values.lighting = 'SOFT_DIFFUSED_STUDIO';
  }
  if (/neutral\s+white\s+balance|neutral\s+wb|нейтральн\w*\s+баланс\w*\s+біл/.test(lower)) {
    values.white_balance = 'NEUTRAL';
  }
  if (/photoreal(?:istic|ism)?|фотореаліст/.test(lower)) values.finish = 'PHOTOREALISTIC';
  if (/(?:natural|природн\w*)[^.\n]{0,60}(?:skin|hair|fabric|шкір|волосс|тканин)/.test(lower)) {
    values.detail = 'NATURAL_SKIN_HAIR_FABRIC';
  }
  return values;
}

function normalizeWrittenRules(writtenRules) {
  if (typeof writtenRules === 'string') return parseWrittenText(writtenRules);
  if (Array.isArray(writtenRules)) return parseWrittenText(writtenRules.join('\n'));
  if (writtenRules == null) return {};
  if (typeof writtenRules !== 'object') throw new TypeError('writtenRules must be text, string[], object, or null.');
  const values = {};
  for (const [inputField, value] of Object.entries(writtenRules)) {
    const field = FIELD_ALIASES[inputField];
    if (field && value !== undefined && value !== null) values[field] = value;
  }
  return values;
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

/** Applies precedence WRITTEN_RULE > SAMPLE_MEASUREMENT > DEFAULT. */
export async function extractQualityTarget({
  writtenRules,
  sampleImage = null,
  sampleEvidence = null,
  defaults = {},
} = {}) {
  const values = {};
  const provenance = {};
  const conflicts = [];
  const assign = (sourceValues, source) => {
    for (const [field, value] of Object.entries(sourceValues ?? {})) {
      const normalizedField = FIELD_ALIASES[field] ?? field;
      if (values[normalizedField] !== undefined && !sameValue(values[normalizedField], value)) {
        conflicts.push({
          field: normalizedField,
          lower_priority_value: values[normalizedField],
          lower_priority_source: provenance[normalizedField],
          selected_value: value,
          selected_source: source,
          resolution: `${source}_WINS`,
        });
      }
      values[normalizedField] = value;
      provenance[normalizedField] = source;
    }
  };

  assign(defaults, 'DEFAULT');
  const measured = sampleEvidence ?? (sampleImage ? await measureSampleBackground(sampleImage) : null);
  if (measured?.background_color) assign({ background_color: measured.background_color }, 'SAMPLE_MEASUREMENT');
  assign(normalizeWrittenRules(writtenRules), 'WRITTEN_RULE');

  return {
    schema_version: '1.0.0',
    values,
    provenance,
    conflicts,
    sample_measurement: measured,
    precedence: ['WRITTEN_RULE', 'SAMPLE_MEASUREMENT', 'DEFAULT'],
  };
}
