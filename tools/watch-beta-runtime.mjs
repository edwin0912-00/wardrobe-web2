#!/usr/bin/env node
import { open, stat } from 'node:fs/promises';
import path from 'node:path';

const runtimeRoot = process.env.ZEELY_RUNTIME_ROOT;
if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) {
  throw new Error('ZEELY_RUNTIME_ROOT must be an absolute runtime directory');
}
const filename = path.join(runtimeRoot, 'monitor', 'events.jsonl');
const follow = !process.argv.includes('--once');
const last = Math.max(0, Math.min(200, Number.parseInt(
  process.argv.find((value) => value.startsWith('--last='))?.split('=')[1] ?? '20',
  10,
) || 0));

function blockOf(event) {
  const type = String(event?.type ?? '');
  const stage = String(event?.data?.stage ?? '');
  if (type.startsWith('run.')) return 'B1 CORE LOOK';
  if (type.startsWith('scene.')) return 'B3 BACKGROUND';
  if (type.startsWith('editorial.')) return 'B4/5 SHOOT';
  if (type.startsWith('video.') || stage.includes('/video')) return 'B6 VIDEO';
  if (type.startsWith('live.') || /realtime|fal/.test(stage)) return 'B7 LIVE';
  if (type.startsWith('client.') || /draft|profile/.test(stage)) return 'B2 PROFILE';
  if (type.startsWith('service.') || stage === '/api/health') return 'SERVICE';
  return 'HTTP/OTHER';
}

function render(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const at = String(event.at ?? '').replace('T', ' ').replace('Z', '');
  const block = blockOf(event).padEnd(13);
  const type = String(event.type ?? '-').padEnd(24);
  const node = String(
    event.data?.stage ?? event.data?.phase ?? event.data?.status ?? '-',
  ).slice(0, 72);
  const status = event.data?.status ? ` status=${event.data.status}` : '';
  const method = event.data?.method ? ` ${event.data.method}` : '';
  const run = event.run_id ? ` run=${String(event.run_id).slice(0, 8)}` : '';
  process.stdout.write(`${at}  ${block}  ${type}${method}  ${node}${status}${run}\n`);
}

async function initialOffset() {
  const bytes = await stat(filename);
  if (last === 0 || bytes.size === 0) return bytes.size;
  const handle = await open(filename, 'r');
  try {
    const start = Math.max(0, bytes.size - 256 * 1024);
    const buffer = Buffer.alloc(bytes.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n').filter(Boolean).slice(-last);
    for (const line of lines) render(line);
  } finally {
    await handle.close();
  }
  return bytes.size;
}

let offset = await initialOffset();
if (!follow) process.exit(0);
process.stdout.write(`--- LIVE beta nodes · ${filename} ---\n`);
while (true) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const details = await stat(filename);
  if (details.size < offset) offset = 0;
  if (details.size === offset) continue;
  const handle = await open(filename, 'r');
  try {
    const buffer = Buffer.alloc(details.size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    offset = details.size;
    for (const line of buffer.toString('utf8').split('\n').filter(Boolean)) render(line);
  } finally {
    await handle.close();
  }
}
