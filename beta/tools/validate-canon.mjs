import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const acceptancePath = path.join(root, 'spec', 'acceptance.json');
const canonPath = path.join(root, 'spec', 'ZEELY_CANON_UA.md');
const acceptance = JSON.parse(await readFile(acceptancePath, 'utf8'));
const canon = await readFile(canonPath, 'utf8');

const failures = [];
const ids = new Set();
for (const rule of acceptance.rules ?? []) {
  if (!rule.id || ids.has(rule.id)) failures.push(`duplicate or missing rule id: ${rule.id ?? '<missing>'}`);
  ids.add(rule.id);
  if (!canon.includes(`\`${rule.id}`)) failures.push(`${rule.id}: absent from canon`);
  if (rule.blocking && (!Array.isArray(rule.evidence) || rule.evidence.length === 0)) {
    failures.push(`${rule.id}: blocking rule has no evidence`);
  }
  for (const evidence of rule.evidence ?? []) {
    try {
      await access(path.join(root, evidence));
    } catch {
      failures.push(`${rule.id}: missing evidence ${evidence}`);
    }
  }
}

const blockingCanonIds = [...canon.matchAll(/`((?:CORE|QA)-[A-Z0-9-]+) MUST|`(QA-\d+)`/g)]
  .map((match) => match[1] ?? match[2]);
for (const id of blockingCanonIds) {
  const entry = acceptance.rules.find((rule) => rule.id === id);
  if (!entry) failures.push(`${id}: blocking canon rule absent from acceptance matrix`);
  else if (!entry.blocking) failures.push(`${id}: must be blocking`);
}

const result = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  rules: acceptance.rules.length,
  blocking_rules: acceptance.rules.filter((rule) => rule.blocking).length,
  failures,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
