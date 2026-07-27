import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const evaluatorSource = path.join(root, 'src', 'web', 'openrouter-scene-evaluator.js');

test('OpenRouter evaluator passes the delivery canvas into strict payload validation', async () => {
  // This is intentionally source-only: importing the evaluator or adapter would
  // turn an import regression into a false positive for this separate handoff.
  const source = await readFile(evaluatorSource, 'utf8');
  assert.match(
    source,
    /validateEvaluatorPayload\s*\(\s*JSON\.parse\(raw\)\s*,\s*context\.delivery\s*\)/,
  );
  assert.doesNotMatch(
    source,
    /validateEvaluatorPayload\s*\(\s*JSON\.parse\(raw\)\s*\)/,
  );
});
