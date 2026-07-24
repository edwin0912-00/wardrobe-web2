#!/usr/bin/env node

process.env.ZEELY_GENERATION_PROVIDER = 'codex-imagegen-test';
process.env.ZEELY_ENABLE_CODEX_IMAGEGEN_TEST_ONLY = 'true';
process.env.PORT ??= '4176';
// Browser profiles still provide ownership; no shared PIN gate is required.
delete process.env.ZEELY_DEMO_PIN;
delete process.env.ZEELY_SESSION_SECRET;
process.env.ZEELY_COOKIE_SECURE ??= 'true';

await import('../src/web/start.js');
