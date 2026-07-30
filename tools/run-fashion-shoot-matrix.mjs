#!/usr/bin/env node
/**
 * Fashion Shoot matrix runner.
 *
 * New Fashion Shoots launch their five customer frames immediately. This
 * runner exists only to migrate the already-created smoke records which still
 * have a QA-passed legacy hero awaiting release into that five-frame series.
 *
 * The service owns the global cap of eight active provider jobs. This runner
 * dispatches every eligible legacy shoot so the service can use freed slots for
 * any queued unit. It never reads, stores or prints a browser cookie. `--execute`
 * requires the caller to provide a local cookie file and records only hashes,
 * IDs and terminal states in its local state file.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const SHOOT_ID = /^shoot_[a-f0-9]{48}$/;
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'NEEDS_RETRY']);

export const DEFAULT_MATRIX_CONFIG = Object.freeze({
  expected_style_count: 15,
  customer_frames_per_style: 5,
  per_shoot_frame_concurrency: 5,
  matrix_max_inflight_generation_requests: 8,
  matrix_dispatch_parallel_shoots: 15,
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function safeIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function heroRow(state, sourceFile) {
  const style = state?.bindings?.shoot_bible?.mode_id;
  const referencePackSha256 = state?.bindings?.shoot_bible?.sha256;
  const hero = state?.shots?.[0];
  const output = hero?.output;
  if (!String(style ?? '').startsWith('shoot.')) return null;
  if (!SHOOT_ID.test(state?.shoot_id ?? '')) return null;
  if (!safeIso(state.created_at) || !isSha256(referencePackSha256)) return null;
  return {
    style,
    shoot_id: state.shoot_id,
    created_at: state.created_at,
    shoot_status: state.status,
    reference_pack_sha256: referencePackSha256,
    hero: {
      status: hero?.status ?? 'MISSING',
      retry_count: Number.isInteger(hero?.retry_count) ? hero.retry_count : 0,
      output_sha256: output?.sha256 ?? null,
      receipt_sha256: output?.receipt_sha256 ?? null,
      attempts: Array.isArray(hero?.attempts) ? hero.attempts.map((attempt) => ({
        number: attempt.number,
        status: attempt.status,
        error_code: attempt.error?.code ?? null,
      })) : [],
    },
    source_file: sourceFile,
  };
}

export async function discoverFashionShootHeroes(runtimeRoot, { since = null } = {}) {
  const root = path.resolve(runtimeRoot, 'editorial-shoots');
  const entries = await readdir(root, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SHOOT_ID.test(entry.name)) continue;
    const filename = path.join(root, entry.name, 'shoot.json');
    let state;
    try {
      state = JSON.parse(await readFile(filename, 'utf8'));
    } catch {
      continue;
    }
    const row = heroRow(state, filename);
    if (row && (!since || row.created_at >= since)) rows.push(row);
  }
  return rows.sort((left, right) => left.style.localeCompare(right.style));
}

export function assertReadySmokeMatrix(rows, config = DEFAULT_MATRIX_CONFIG) {
  if (!Array.isArray(rows) || rows.length !== config.expected_style_count) {
    throw new Error(`Expected exactly ${config.expected_style_count} current Fashion Shoot styles; found ${rows?.length ?? 0}`);
  }
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.style)) throw new Error(`Duplicate Fashion Shoot style in matrix: ${row.style}`);
    seen.add(row.style);
    if (row.shoot_status !== 'HERO_PENDING_APPROVAL' || row.hero.status !== 'QA_PASSED') {
      throw new Error(`${row.style} is not a QA-passed hero awaiting approval`);
    }
    if (!isSha256(row.reference_pack_sha256)
      || !isSha256(row.hero.output_sha256)
      || !isSha256(row.hero.receipt_sha256)) {
      throw new Error(`${row.style} is missing an immutable reference, output or receipt hash`);
    }
  }
  return rows;
}

export function buildMatrixWaves(rows, config = DEFAULT_MATRIX_CONFIG) {
  assertReadySmokeMatrix(rows, config);
  const maximum = config.matrix_max_inflight_generation_requests;
  const dispatch = config.matrix_dispatch_parallel_shoots;
  if (!Number.isInteger(maximum) || !Number.isInteger(dispatch) || maximum < 1 || dispatch < 1) {
    throw new Error('Invalid Fashion Shoot matrix concurrency configuration');
  }
  const waves = [];
  for (let offset = 0; offset < rows.length; offset += dispatch) {
    waves.push(rows.slice(offset, offset + dispatch));
  }
  return waves;
}

export function matrixApprovalPlan(rows, config = DEFAULT_MATRIX_CONFIG) {
  const waves = buildMatrixWaves(rows, config);
  return {
    schema_version: '1.0.0',
    product: 'Fashion Shoot',
    styles: rows.length,
    customer_frames_per_style: config.customer_frames_per_style,
    total_customer_frames: rows.length * config.customer_frames_per_style,
    launch_policy: 'start_all_five_frames_on_create',
    maximum_inflight_generation_requests: config.matrix_max_inflight_generation_requests,
    per_shoot_frame_concurrency: config.per_shoot_frame_concurrency,
    waves: waves.map((wave, index) => ({
      wave: index + 1,
      maximum_inflight_generation_requests: config.matrix_max_inflight_generation_requests,
      shoots: wave.map((row) => ({
        style: row.style,
        shoot_id: row.shoot_id,
        expected_hero_output_sha256: row.hero.output_sha256,
        reference_pack_sha256: row.reference_pack_sha256,
      })),
    })),
  };
}

export function renderSmokeReport(rows, config = DEFAULT_MATRIX_CONFIG) {
  assertReadySmokeMatrix(rows, config);
  const plan = matrixApprovalPlan(rows, config);
  const table = rows.map((row) => [
    `\`${row.style}\``,
    `\`${row.reference_pack_sha256}\``,
    `\`${row.shoot_id}\``,
    `\`${row.hero.output_sha256}\``,
    `\`${row.hero.receipt_sha256}\``,
    row.hero.retry_count === 0 ? 'PASS · 1' : `PASS · ${row.hero.retry_count + 1} (first: ${row.hero.attempts[0]?.error_code ?? 'FAIL'})`,
  ].join(' | ')).join('\n');
  return `# Fashion Shoot hero smoke matrix — 2026-07-30\n\n` +
    `Scope: all current \`shoot.*\` styles created in this controlled matrix. The hero is an internal identity/look check, not a customer frame.\n\n` +
    `Result: **${rows.length}/${config.expected_style_count}** hero frames reached \`QA_PASSED\`. All large media remains in the protected runtime/SSD; this report contains only immutable IDs and hashes.\n\n` +
    `| Style | Reference-pack hash | Shoot ID | Hero output hash | Hero receipt | Result |\n` +
    `| --- | --- | --- | --- | --- | --- |\n${table}\n\n` +
    `## Next full-matrix execution\n\n` +
    `All ${plan.styles} styles advance, not a selected subset. Each style has ${plan.customer_frames_per_style} customer frames, for ${plan.total_customer_frames} frames total. All eligible legacy smoke records are dispatched together; the service itself never permits more than ${config.matrix_max_inflight_generation_requests} provider jobs across Fashion Shoot. New Fashion Shoots start their five frames on create and do not use this legacy migration runner.\n\n` +
    `weakened_checks: none. The smoke records QA-passed legacy heroes; it does not auto-claim that the five customer frames are already generated.\n`;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    if (name === 'execute') values.execute = true;
    else values[name] = argv[++index];
  }
  if (!values['runtime-root']) throw new Error('--runtime-root is required');
  return values;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${body.code ?? body.error ?? 'request failed'}`);
  return body;
}

async function readCookie(cookieFile) {
  const value = (await readFile(cookieFile, 'utf8')).trim().replace(/^Cookie:\s*/i, '');
  if (!value) throw new Error('--cookie-file is empty');
  return value;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function executePlan(plan, { origin, cookie, stateFile, pollIntervalMs = 5_000 }) {
  const base = new URL(origin);
  const state = { schema_version: '1.0.0', started_at: new Date().toISOString(), waves: [] };
  await mkdir(path.dirname(stateFile), { recursive: true });
  for (const wave of plan.waves) {
    const headers = {
      Cookie: cookie,
      Origin: base.origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    };
    await Promise.all(wave.shoots.map(async (shoot) => {
      const idempotencyKey = `fashion-matrix-${sha256(`${shoot.shoot_id}:${shoot.expected_hero_output_sha256}`).slice(0, 40)}`;
      await fetchJson(new URL(`/api/profile/editorial-shoots/${shoot.shoot_id}/approve-hero`, base), {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ expected_output_sha256: shoot.expected_hero_output_sha256 }),
      });
    }));
    let terminal;
    do {
      await sleep(pollIntervalMs);
      terminal = await Promise.all(wave.shoots.map(async (shoot) => ({
        shoot_id: shoot.shoot_id,
        style: shoot.style,
        state: await fetchJson(new URL(`/api/profile/editorial-shoots/${shoot.shoot_id}`, base), { headers }),
      })));
      await writeFile(stateFile, `${JSON.stringify({ ...state, current_wave: wave.wave, latest: terminal }, null, 2)}\n`);
    } while (!terminal.every(({ state: shoot }) => TERMINAL.has(shoot.status)));
    state.waves.push({
      wave: wave.wave,
      terminal: terminal.map(({ shoot_id, style, state: shoot }) => ({ shoot_id, style, status: shoot.status })),
    });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const failed = state.waves.at(-1).terminal.filter((item) => item.status !== 'COMPLETED');
    if (failed.length) throw new Error(`Matrix stopped after wave ${wave.wave}: ${failed.map((item) => `${item.style}=${item.status}`).join(', ')}`);
  }
  return state;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config ?? path.join(import.meta.dirname, '..', 'config', 'fashion-shoot-matrix.json'));
  const config = { ...DEFAULT_MATRIX_CONFIG, ...JSON.parse(await readFile(configPath, 'utf8')) };
  const rows = await discoverFashionShootHeroes(args['runtime-root'], { since: args.since ?? null });
  const report = renderSmokeReport(rows, config);
  const plan = matrixApprovalPlan(rows, config);
  if (args['write-report']) await writeFile(path.resolve(args['write-report']), report);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!args.execute) return;
  if (!args.origin || !args['cookie-file'] || !args['state-file']) {
    throw new Error('--execute requires --origin, --cookie-file and --state-file');
  }
  await executePlan(plan, {
    origin: args.origin,
    cookie: await readCookie(args['cookie-file']),
    stateFile: path.resolve(args['state-file']),
    pollIntervalMs: Number(args['poll-interval-ms'] ?? 5_000),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`Fashion Shoot matrix failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
