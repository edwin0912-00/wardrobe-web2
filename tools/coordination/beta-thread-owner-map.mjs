#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mapPath = path.join(projectRoot, 'docs/coordination/BETA_THREAD_OWNER_MAP.json');

export async function loadBetaThreadOwnerMap() {
  const parsed = JSON.parse(await readFile(mapPath, 'utf8'));
  if (parsed?.schema_version !== '1.0.0' || !parsed.blocks || !Array.isArray(parsed.threads)) {
    throw new Error('BETA_THREAD_OWNER_MAP_INVALID');
  }
  return parsed;
}

export function blockRecord(ownerMap, blockNumber) {
  const record = ownerMap.blocks?.[String(blockNumber)];
  if (!record) throw new Error('BETA_BLOCK_UNKNOWN');
  return record;
}

export function validateBetaBlockOwner(ownerMap, agentId, blockNumber) {
  const record = blockRecord(ownerMap, blockNumber);
  if (record.owner_agent_id !== agentId) {
    throw new Error(`BETA_BLOCK_OWNER_MISMATCH:${agentId}:block-${blockNumber}:owner-${record.owner_agent_id}`);
  }
  return record;
}

async function main() {
  const [command, first, second] = process.argv.slice(2);
  const ownerMap = await loadBetaThreadOwnerMap();
  if (command === 'validate') {
    validateBetaBlockOwner(ownerMap, first, second);
    process.stdout.write('OK\n');
    return;
  }
  if (command === 'field') {
    const record = blockRecord(ownerMap, first);
    if (!['owner_agent_id', 'branch', 'handoff', 'report'].includes(second)) {
      throw new Error('BETA_BLOCK_FIELD_UNKNOWN');
    }
    process.stdout.write(`${record[second]}\n`);
    return;
  }
  throw new Error('Usage: beta-thread-owner-map.mjs validate <agent-id> <block> | field <block> <field>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 64;
  });
}
