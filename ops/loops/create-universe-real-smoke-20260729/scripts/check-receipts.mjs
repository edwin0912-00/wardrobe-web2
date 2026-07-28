import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('workspace path is required');
const receipts = path.join(root, 'receipts');
const names = await readdir(receipts).catch(() => []);
const files = names.filter((name) => name.endsWith('.json'));
if (files.length < 2) throw new Error('expected at least two terminal receipt files');
for (const file of files) {
  const receipt = JSON.parse(await readFile(path.join(receipts, file), 'utf8'));
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(receipt.status)) {
    throw new Error(`${file} does not record a terminal scene status`);
  }
  if (receipt.mock === true) throw new Error(`${file} is mock evidence`);
}
console.log(`validated ${files.length} terminal real-run receipts`);
