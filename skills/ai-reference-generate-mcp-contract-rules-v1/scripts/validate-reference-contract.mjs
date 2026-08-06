#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SHA256 = /^[a-f0-9]{64}$/;
const ROLE = /^[a-z][a-z0-9_.-]{1,79}$/;
const OPERATIONS = new Set(['image_generation', 'video_generation']);
const STYLE = new Set(['plain_ordinal', 'at_ordinal']);
const NAMESPACES = Object.freeze({
  images: 'Image',
  videos: 'Video',
  audio: 'Audio',
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestContract(contract) {
  const copy = structuredClone(contract);
  delete copy.manifest_sha256;
  return createHash('sha256').update(canonical(copy)).digest('hex');
}

function validateStringArray(value, field, errors) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((entry) => typeof entry !== 'string' || entry.length === 0)
    || new Set(value).size !== value.length) {
    errors.push(`${field} must be a non-empty array of unique strings`);
    return [];
  }
  return value;
}

function expectedLabel(noun, order, style) {
  return `${style === 'at_ordinal' ? '@' : ''}${noun} ${order}`;
}

function validateInput(input, { namespace, noun, index, style, prompt }, errors) {
  const field = `inputs.${namespace}[${index}]`;
  const order = index + 1;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (input.order !== order) errors.push(`${field}.order must equal ${order}`);
  const label = expectedLabel(noun, order, style);
  if (input.provider_label !== label) {
    errors.push(`${field}.provider_label must equal ${JSON.stringify(label)}`);
  }
  if (!ROLE.test(input.semantic_role ?? '')) {
    errors.push(`${field}.semantic_role must be lowercase semantic-role syntax`);
  }
  if (!SHA256.test(input.sha256 ?? '')) errors.push(`${field}.sha256 is invalid`);
  if (typeof input.media_type !== 'string' || !input.media_type.includes('/')) {
    errors.push(`${field}.media_type is invalid`);
  }
  const allows = validateStringArray(input.allows, `${field}.allows`, errors);
  const forbids = validateStringArray(input.forbids, `${field}.forbids`, errors);
  const overlap = allows.filter((item) => forbids.includes(item));
  if (overlap.length > 0) errors.push(`${field} allows and forbids ${overlap.join(', ')}`);
  if (!prompt.includes(label)) errors.push(`prompt does not bind ${label}`);
}

function validateTopology(contract, errors) {
  const images = contract.inputs.images;
  const videos = contract.inputs.videos;
  if (contract.operation === 'video_generation') {
    if (contract.binding_styles.images !== 'at_ordinal'
      || contract.binding_styles.videos !== 'at_ordinal') {
      errors.push('video_generation requires independent @Image and @Video ordinal namespaces');
    }
    if (videos[0]?.semantic_role !== 'motion_reference') {
      errors.push('video_generation requires motion_reference as @Video 1');
    }
    if (!['approved_white_master', 'approved_master', 'approved_look'].includes(
      images[0]?.semantic_role,
    )) {
      errors.push('video_generation requires the approved master as @Image 1');
    }
    if (images[0]?.white_background_verified !== true) {
      errors.push('video_generation approved master must be white-background verified');
    }
  }
  if (contract.operation === 'image_generation') {
    if (contract.reference_strategy === 'gpt_base_canvas_first') {
      if (images[0]?.semantic_role !== 'geometry_guide'
        || images[1]?.semantic_role !== 'approved_master') {
        errors.push('gpt_base_canvas_first requires geometry_guide then approved_master');
      }
    } else if (contract.reference_strategy === 'explicit_master_first') {
      if (images[0]?.semantic_role !== 'approved_master') {
        errors.push('explicit_master_first requires approved_master as Image 1');
      }
    } else {
      errors.push('image_generation requires a known reference_strategy');
    }
  }
}

function validateContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return ['document must be a JSON object'];
  }
  if (contract.schema_version !== 'ai-reference-contract-v1') {
    errors.push('schema_version must equal ai-reference-contract-v1');
  }
  if (!OPERATIONS.has(contract.operation)) errors.push('operation is unsupported');
  for (const field of ['internal_model_id', 'provider_model_id', 'reference_strategy', 'prompt']) {
    if (typeof contract[field] !== 'string' || contract[field].length === 0) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (!contract.inputs || typeof contract.inputs !== 'object') {
    errors.push('inputs must be an object');
    return errors;
  }
  if (!contract.binding_styles || typeof contract.binding_styles !== 'object') {
    errors.push('binding_styles must be an object');
    return errors;
  }
  for (const [namespace, noun] of Object.entries(NAMESPACES)) {
    const inputs = contract.inputs[namespace];
    const style = contract.binding_styles[namespace];
    if (!Array.isArray(inputs)) {
      errors.push(`inputs.${namespace} must be an array`);
      continue;
    }
    if (!STYLE.has(style)) {
      errors.push(`binding_styles.${namespace} is invalid`);
      continue;
    }
    inputs.forEach((input, index) => validateInput(
      input,
      { namespace, noun, index, style, prompt: contract.prompt ?? '' },
      errors,
    ));
  }

  const declaredLabels = new Set(Object.entries(NAMESPACES).flatMap(([namespace, noun]) => {
    const style = contract.binding_styles[namespace];
    const inputs = Array.isArray(contract.inputs[namespace]) ? contract.inputs[namespace] : [];
    return inputs.map((_, index) => expectedLabel(noun, index + 1, style));
  }));
  const mentionedLabels = contract.prompt?.match(/@?(?:Image|Video|Audio) [1-9][0-9]*/g) ?? [];
  for (const label of mentionedLabels) {
    if (!declaredLabels.has(label)) errors.push(`prompt mentions undeclared binding ${label}`);
  }

  validateTopology(contract, errors);
  const digest = digestContract(contract);
  if (contract.manifest_sha256 !== undefined && contract.manifest_sha256 !== digest) {
    errors.push('manifest_sha256 does not match canonical contract bytes');
  }
  return { errors, digest };
}

const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) {
  console.error('Usage: node validate-reference-contract.mjs <contract.json>');
  process.exit(64);
}

let contract;
try {
  contract = JSON.parse(await readFile(path.resolve(inputPath), 'utf8'));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', errors: [`Cannot read valid JSON: ${error.message}`] }, null, 2));
  process.exit(1);
}

const result = validateContract(contract);
if (Array.isArray(result)) {
  console.error(JSON.stringify({ status: 'FAIL', errors: result }, null, 2));
  process.exit(1);
}
if (result.errors.length > 0) {
  console.error(JSON.stringify({ status: 'FAIL', errors: result.errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  status: 'PASS',
  schema_version: contract.schema_version,
  operation: contract.operation,
  internal_model_id: contract.internal_model_id,
  provider_model_id: contract.provider_model_id,
  manifest_sha256: result.digest,
  reference_counts: Object.fromEntries(
    Object.keys(NAMESPACES).map((namespace) => [namespace, contract.inputs[namespace].length]),
  ),
}, null, 2));
