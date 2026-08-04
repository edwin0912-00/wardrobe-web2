#!/usr/bin/env node
// Записує живий статус агента в handoff/LIVE_STATUS.md і одразу пушить його.
//
//   node ops/intent.mjs start   "що я збираюсь робити" [--files "a.js, b.js"]
//   node ops/intent.mjs step    "що вже зроблено"
//   node ops/intent.mjs blocked "на чому став"
//   node ops/intent.mjs done    "що вийшло"
//
// Правило, з якого це виросло: будь-яка дія довша за кілька хвилин мусить бути
// в GitHub ДО того, як почалась, разом із задумом і контекстом. Тоді обрив
// сесії, ліміт токенів або перехід на іншого агента не коштують нічого — той,
// хто приходить, читає останній запис і продовжує з того самого місця.

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statusPath = path.join(root, 'handoff', 'LIVE_STATUS.md');

const KINDS = new Map([
  ['start', 'INTENT'],
  ['step', 'PROGRESS'],
  ['blocked', 'BLOCKED'],
  ['done', 'DONE'],
]);

const [kindArg, ...rest] = process.argv.slice(2);
const kind = KINDS.get(kindArg);
if (!kind) {
  console.error('usage: node ops/intent.mjs start|step|blocked|done "текст" [--files "a.js, b.js"]');
  process.exit(64);
}

const filesIndex = rest.indexOf('--files');
const files = filesIndex === -1 ? null : rest[filesIndex + 1] ?? null;
const message = (filesIndex === -1 ? rest : rest.slice(0, filesIndex)).join(' ').trim();
if (!message) {
  console.error('текст обовʼязковий: він і є контекстом для того, хто підхопить');
  process.exit(64);
}

async function agentId() {
  if (process.env.WARDROBE_AGENT_ID) return process.env.WARDROBE_AGENT_ID;
  try {
    const { stdout } = await run('git', ['config', '--local', '--get', 'wardrobe.agent-id'], { cwd: root });
    const value = stdout.trim();
    if (value) return value;
  } catch { /* no local id configured */ }
  return 'unknown-agent';
}

async function head() {
  const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root });
  return stdout.trim();
}

const id = await agentId();
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
const entry = [
  `### ${stamp} · ${id} · ${kind}`,
  '',
  message,
  ...(files ? ['', `Файли: ${files}`] : []),
  '',
  `HEAD на момент запису: \`${await head()}\``,
  '',
].join('\n');

const current = await readFile(statusPath, 'utf8');
const marker = '<!-- entries -->';
const updated = current.includes(marker)
  ? current.replace(marker, `${marker}\n\n${entry}`)
  : `${current}\n${entry}`;
await writeFile(statusPath, updated);

await run('git', ['add', 'handoff/LIVE_STATUS.md'], { cwd: root });
await run('git', ['commit', '-q', '-m', `[agent:${id}] handoff: ${kind.toLowerCase()} — ${message.slice(0, 60)}`], { cwd: root });
try {
  await run('git', ['pull', '--rebase', '--autostash', '--quiet', 'origin', 'beta'], { cwd: root, timeout: 120_000 });
  await run('git', ['push', '-q', 'origin', 'beta'], { cwd: root, timeout: 120_000 });
  console.log(`${kind} записано і запушено.`);
} catch (error) {
  console.log(`${kind} закомічено локально, але пуш не пройшов: ${error.message.split('\n')[0]}`);
  console.log('Запушити вручну: git pull --rebase --autostash origin beta && git push origin beta');
}
