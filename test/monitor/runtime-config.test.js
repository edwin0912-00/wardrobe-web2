import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMonitorRuntimeConfig } from '../../src/monitor/runtime-config.js';

test('monitor can bind the current beta runtime and loopback health endpoint', () => {
  const result = resolveMonitorRuntimeConfig({
    projectRoot: '/product',
    env: {
      ZEELY_RUNTIME_ROOT: '/runtime/beta',
      ZEELY_APP_HEALTH_URL: 'http://127.0.0.1:4176/api/health',
    },
  });
  assert.equal(result.runtimeRoot, '/runtime/beta');
  assert.equal(result.appHealthUrl, 'http://127.0.0.1:4176/api/health');
});

test('monitor refuses a remote or credential-bearing health target', () => {
  for (const value of [
    'https://beta.madeforthisjob.com/api/health',
    'http://user:secret@127.0.0.1:4176/api/health',
    'http://127.0.0.1:4176/api/other',
  ]) {
    assert.throws(
      () => resolveMonitorRuntimeConfig({
        projectRoot: '/product',
        env: { ZEELY_APP_HEALTH_URL: value },
      }),
      /MONITOR_APP_HEALTH_URL_INVALID/,
    );
  }
});
