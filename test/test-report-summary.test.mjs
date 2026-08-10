import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSummary } from '../scripts/test-report-summary.mjs';

test('PASS receipt becomes a compact GitHub summary without weakened checks', () => {
  const markdown = renderSummary({
    status: 'PASS',
    mode: 'local',
    duration_ms: 28012,
    source: { commit: 'abc123' },
    checks: [{ id: 'BROWSER_CORE', layer: 'browser', status: 'PASS', duration_ms: 1200 }],
    weakened_checks: [],
  });
  assert.match(markdown, /✅ Wardrobe verification: PASS/);
  assert.match(markdown, /BROWSER_CORE \| ✅ PASS/);
  assert.match(markdown, /Weakened checks: \*\*none\*\*/);
});

test('FAIL receipt names the first failing behavior and its evidence log', () => {
  const markdown = renderSummary({
    status: 'FAIL',
    mode: 'live',
    duration_ms: 912,
    source: { commit: 'def456' },
    checks: [{
      id: 'LIVE_PRODUCT',
      layer: 'deployment',
      status: 'FAIL',
      duration_ms: 900,
      log: 'artifacts/test-system/logs/run/live_product.log',
    }],
    first_failure: 'LIVE_PRODUCT',
    next_action: 'Repair deployed parity.',
    weakened_checks: [],
  });
  assert.match(markdown, /❌ Wardrobe verification: FAIL/);
  assert.match(markdown, /First failure: \*\*LIVE_PRODUCT\*\*/);
  assert.match(markdown, /live_product\.log/);
  assert.match(markdown, /Repair deployed parity/);
});
