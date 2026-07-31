#!/usr/bin/env node
/**
 * Read-only production preflight for the fabric-world runtime.
 *
 * It makes deployment failure visible before a person opens the site: root is
 * served, scroll masters support Range, and the same-origin product gateway is
 * present. It deliberately does not create jobs or access personal media.
 */
const raw = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = raw.indexOf(flag);
  return index >= 0 && raw[index + 1] ? raw[index + 1] : fallback;
};

const origin = valueAfter('--origin', 'https://site.madeforthisjob.com').replace(/\/+$/, '');
const assets = [
  '/',
  '/b/',
  '/b/assets/intro.mp4',
  '/b/assets/seg1.mp4',
  '/b/assets/seg2.mp4',
  '/b/assets/seg3.mp4',
  '/b/assets/seg4.mp4',
];

async function check(path, options = {}) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual', ...options });
  return { path, status: response.status, type: response.headers.get('content-type') || '', range: response.headers.get('content-range') || '' };
}

const results = [];
for (const path of assets.slice(0, 2)) results.push(await check(path));
for (const path of assets.slice(2)) results.push(await check(path, { headers: { Range: 'bytes=0-1' } }));
const api = await check('/api/health');

const badStatic = results.filter((item) => item.status !== 200 && item.status !== 206);
const badRange = results.slice(2).filter((item) => item.status !== 206 || !item.range.startsWith('bytes '));
const apiReady = api.status === 200 && /json/i.test(api.type);
const report = { origin, static: results, api, apiReady, ok: badStatic.length === 0 && badRange.length === 0 && apiReady };
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
