#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaDirectory = path.join(projectRoot, 'schemas');
const fixtureDirectory = path.join(projectRoot, 'fixtures', 'contracts');
const jobsDirectory = path.join(projectRoot, 'jobs');

const schemaFiles = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith('.schema.json'))
  .sort();
const schemas = new Map();
// JSON Schema conditionals intentionally refine parent-typed properties without
// repeating `type` in every `then` branch. Ajv's strictTypes lint rejects that
// valid Draft 2020-12 pattern, so schema linting is disabled while validation,
// all errors, additionalProperties, enums and conditional invariants stay active.
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });

for (const filename of schemaFiles) {
  const schema = JSON.parse(await readFile(path.join(schemaDirectory, filename), 'utf8'));
  ajv.addSchema(schema);
  schemas.set(filename.replace(/\.schema\.json$/, ''), schema);
}

const fixtureFiles = (await readdir(fixtureDirectory))
  .filter((name) => name.endsWith('.json'))
  .sort();
const results = [];

for (const filename of fixtureFiles) {
  const schemaKey = [...schemas.keys()]
    .sort((a, b) => b.length - a.length)
    .find((key) => filename.startsWith(`${key}.`));
  if (!schemaKey) throw new Error(`No schema mapping for fixture ${filename}`);
  const schema = schemas.get(schemaKey);
  const fixture = JSON.parse(await readFile(path.join(fixtureDirectory, filename), 'utf8'));
  const validate = ajv.getSchema(schema.$id);
  const valid = validate(fixture);
  results.push({ fixture: filename, schema: schemaKey, valid, errors: validate.errors ?? [] });
}

const failures = results.filter((item) => !item.valid);
const pipelineJobSchema = schemas.get('pipeline-job');
const validatePipelineJob = ajv.getSchema(pipelineJobSchema.$id);
const jobFiles = (await readdir(jobsDirectory))
  .filter((name) => /^\d{3}\.json$/.test(name))
  .sort();
const jobResults = [];
for (const filename of jobFiles) {
  const value = JSON.parse(await readFile(path.join(jobsDirectory, filename), 'utf8'));
  const valid = validatePipelineJob(value);
  jobResults.push({ job: filename, valid, errors: validatePipelineJob.errors ?? [] });
}
const jobFailures = jobResults.filter((item) => !item.valid);
const externalResults = [];
const visualReviewSchema = schemas.get('visual-review');
if (visualReviewSchema) {
  const value = JSON.parse(
    await readFile(path.join(projectRoot, 'reviews', 'visual-review.json'), 'utf8'),
  );
  const validate = ajv.getSchema(visualReviewSchema.$id);
  const valid = validate(value);
  externalResults.push({
    document: 'reviews/visual-review.json',
    schema: 'visual-review',
    valid,
    errors: validate.errors ?? [],
  });
}
const externalFailures = externalResults.filter((item) => !item.valid);
const allFailures = [...failures, ...jobFailures, ...externalFailures];
process.stdout.write(`${JSON.stringify({
  status: allFailures.length === 0 ? 'PASS' : 'FAIL',
  schemas_loaded: schemas.size,
  fixtures_checked: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  jobs_checked: jobResults.length,
  jobs_passed: jobResults.length - jobFailures.length,
  jobs_failed: jobFailures.length,
  external_documents_checked: externalResults.length,
  external_documents_passed: externalResults.length - externalFailures.length,
  external_documents_failed: externalFailures.length,
  failures: allFailures,
}, null, 2)}\n`);
if (allFailures.length > 0) process.exitCode = 1;
