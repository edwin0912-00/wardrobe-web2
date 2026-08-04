#!/usr/bin/env node
import { verifyOutput } from '../src/qa/index.mjs';

function readArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--output') options.outputDir = argv[++index];
    else if (token === '--visual-review') options.visualReviewPath = argv[++index];
    else if (token === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

const options = readArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write('Usage: node tools/verify-output.mjs [--output output] [--visual-review review.json]\n');
  process.exit(0);
}

const summary = await verifyOutput(options);
process.stdout.write(`${JSON.stringify({
  status: summary.status,
  summary: `${summary.output_directory}/qa-summary.json`,
  subjects: summary.subjects,
  duplicate_check: summary.cross_subject_duplicate_check.status,
}, null, 2)}\n`);
process.exitCode = summary.status === 'PASS' ? 0 : summary.status === 'NEEDS_REVIEW' ? 2 : 1;

