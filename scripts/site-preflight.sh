#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_DIR"

node --check engine.js
node --check ui.js
node --check screen-surface-math.js
node --check screen-surfaces.js

node --input-type=module <<'EOF'
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile('b/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());
for (const [index, source] of scripts.entries()) {
  new vm.Script(source, { filename: `b/index.html:inline-${index + 1}` });
}
console.log(`inline scripts parsed: ${scripts.length}`);
EOF

node --test test/*.test.mjs
git diff --check

echo "site preflight passed"
