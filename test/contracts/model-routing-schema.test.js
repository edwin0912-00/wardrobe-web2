import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

function validator(schema) {
  return new Ajv2020({
    allErrors: true,
    strict: false,
    formats: { 'date-time': true, 'uri-reference': true },
  }).compile(schema);
}

test('model policy config pins the three Higgsfield image routes in order', async () => {
  const policy = await readJson('config/model-policy.json');
  assert.deepEqual(policy.image_models, {
    primary: { name: 'GPT Image 2', job_set_type: 'gpt_image_2' },
    fallback_order: [
      { name: 'Nano Banana 2', job_set_type: 'nano_banana_flash' },
      { name: 'Nano Banana Pro', job_set_type: 'nano_banana_2' },
    ],
  });
});

test('generation job schema accepts only matching locked model and job_set_type pairs', async () => {
  const validate = validator(await readJson('schemas/generation-job.schema.json'));
  const baseJob = {
    job_id: 'job-001',
    node_id: 'avatar',
    attempt: 1,
    idempotency_key: '0123456789abcdef',
    provider: 'HIGGSFIELD_CLI',
    task: 'IMAGE_GENERATE',
    input_asset_hashes: ['a'.repeat(64)],
    prompt_hash: 'b'.repeat(64),
    budget: { max_usd: 1, timeout_s: 60, max_attempts: 3 },
    state: 'PLANNED',
  };
  const lockedModels = [
    { model: 'GPT Image 2', job_set_type: 'gpt_image_2' },
    { model: 'Nano Banana 2', job_set_type: 'nano_banana_flash' },
    { model: 'Nano Banana Pro', job_set_type: 'nano_banana_2' },
  ];

  for (const lockedModel of lockedModels) {
    assert.equal(validate({ ...baseJob, ...lockedModel }), true, JSON.stringify(validate.errors));
  }
  assert.equal(validate({
    ...baseJob,
    model: 'Nano Banana Pro',
    job_set_type: 'nano_banana_flash',
  }), false);
  assert.equal(validate({
    ...baseJob,
    model: 'legacy-image-model',
    job_set_type: 'legacy_image_model',
  }), false);
});

test('generation-ready reference pack fixture remains valid with locked model selectors', async () => {
  const validate = validator(await readJson('schemas/generation-ready-reference-pack.schema.json'));
  const fixture = await readJson('fixtures/contracts/generation-ready-reference-pack.outfit-reference.valid.json');
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
});
