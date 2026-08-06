import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8');

test('completed runs reveal the result instead of auto-opening the execution graph', () => {
  const completionStart = appSource.indexOf("if (run.status === 'COMPLETED')");
  const failureStart = appSource.indexOf("if (run.status === 'FAILED'", completionStart);
  assert.ok(completionStart >= 0);
  assert.ok(failureStart > completionStart);
  const completionSource = appSource.slice(completionStart, failureStart);

  assert.match(completionSource, /setView\('result'\)/);
  assert.match(completionSource, /renderResults\(run\)/);
  assert.doesNotMatch(
    completionSource,
    /completed-pipeline-trace[^\n]*\.open\s*=\s*true/,
    'the optional execution graph must not cover the completed result on mobile',
  );
});
