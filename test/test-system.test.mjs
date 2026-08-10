import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlan, parseArguments, statusFor } from '../scripts/test-system.mjs';

test('local is the default and keeps failing checks blocking', () => {
  assert.deepEqual(parseArguments([]), { mode: 'local', keepGoing: false, reportPath: null });
  assert.deepEqual(parseArguments(['all', '--keep-going', '--report', 'result.json']), {
    mode: 'all',
    keepGoing: true,
    reportPath: 'result.json',
  });
});

test('quick still materializes the locked media required by real main tests', () => {
  assert.deepEqual(buildPlan('quick').map((step) => step.id), [
    'MEDIA_BUNDLE',
    'SOURCE_LOCK',
    'MAIN_PREFLIGHT',
    'PATCH_INTEGRITY',
  ]);
});

test('local plan receipts bootstrap, contracts, a real browser and a real two-process runtime', () => {
  assert.deepEqual(buildPlan('local').map((step) => step.id), [
    'ROOT_DEPENDENCIES',
    'ENGINE_DEPENDENCIES',
    'MEDIA_BUNDLE',
    'BROWSER_RUNTIME',
    'PRODUCT_CONTRACTS',
    'BROWSER_CORE',
    'TWO_PROCESS_RUNTIME',
    'PATCH_INTEGRITY',
  ]);
});

test('live plan checks source and deployed behavior without starting paid generation', () => {
  const plan = buildPlan('live');
  assert.deepEqual(plan.map((step) => step.id), [
    'ROOT_DEPENDENCIES',
    'BROWSER_RUNTIME',
    'SOURCE_LOCK',
    'LIVE_PRODUCT',
    'PATCH_INTEGRITY',
  ]);
  assert.equal(plan.find((step) => step.id === 'LIVE_PRODUCT').command[1], 'scripts/live-product-e2e.mjs');
});

test('full and all modes cannot omit the complete engine suite', () => {
  for (const mode of ['full', 'all']) {
    assert.ok(buildPlan(mode).some((step) => step.id === 'FULL_ENGINE'));
  }
});

test('a single failed behavior makes the report fail', () => {
  assert.equal(statusFor([]), 'FAIL');
  assert.equal(statusFor([{ status: 'PASS' }, { status: 'FAIL' }, { status: 'PASS' }]), 'FAIL');
  assert.equal(statusFor([{ status: 'PASS' }, { status: 'PASS' }]), 'PASS');
});

test('unknown modes and options fail closed', () => {
  assert.throws(() => buildPlan('smoke-ish'), /unknown mode/);
  assert.throws(() => parseArguments(['--skip-browser']), /unknown option/);
});
