#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { isProductPath } from './path-policy.mjs';

const args = parseArgs(process.argv.slice(2));
for (const required of ['base', 'head']) {
  if (!args[required]) throw new Error(`--${required} is required`);
}
const root = path.resolve(args.root ?? process.cwd());
const changedPaths = execFileSync(
  'git',
  ['diff', '--name-only', '--no-renames', `${args.base}...${args.head}`, '--'],
  { cwd: root, encoding: 'utf8' },
).split('\n').filter(Boolean);
const productPaths = changedPaths.filter(isProductPath);

process.stdout.write(`${JSON.stringify({
  product_changed: productPaths.length > 0,
  product_paths: productPaths,
})}\n`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || values[index + 1] == null) {
      throw new Error(`Invalid argument: ${key}`);
    }
    parsed[key.slice(2)] = values[index + 1];
  }
  return parsed;
}
