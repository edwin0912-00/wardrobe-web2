import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPrivateInfrastructure, sanitizeOutbound, sanitizeOutboundString } from '../../src/security/outbound-redaction.js';

test('outbound strings redact project names and embedded local filesystem paths', () => {
  const source = 'Zeely madeforthisjob failed at /Users/jarvis1/.local/share/app/runtime/run.json and C:\\Users\\jarvis\\secret.txt';
  const sanitized = sanitizeOutboundString(source);
  assert.equal(hasPrivateInfrastructure(sanitized), false);
  assert.match(sanitized, /\[redacted-local-path\]/);
  assert.doesNotMatch(sanitized, /jarvis|zeely|madeforthisjob/i);
});

test('outbound object projection removes transport-only fields recursively', () => {
  const source = {
    status: 'FAILED',
    path: '/Users/jarvis1/private.png',
    nested: {
      packPath: '/tmp/reference-pack.json',
      prompt: 'Zeely internal prompt',
      message: 'Could not read /home/service/private.png',
      sha256: 'a'.repeat(64),
    },
  };
  const sanitized = sanitizeOutbound(source);
  assert.deepEqual(sanitized, {
    status: 'FAILED',
    nested: { message: 'Could not read [redacted-local-path]', sha256: 'a'.repeat(64) },
  });
  assert.equal(hasPrivateInfrastructure(sanitized), false);
});

test('public API paths and product evidence remain intact', () => {
  const source = { output_url: '/api/runs/run-1/files/avatar.png', observed: { exact_logo_text: ['GUCCI'] } };
  assert.deepEqual(sanitizeOutbound(source), source);
});
