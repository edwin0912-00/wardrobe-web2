import { readFile } from 'node:fs/promises';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node check-qa-report.mjs <QA-REPORT.md>');
  process.exit(64);
}

const report = await readFile(reportPath, 'utf8');
const required = [
  /^Beta SHA:\s*[0-9a-f]{7,40}\s*$/m,
  /^Deployed SHA:\s*[0-9a-f]{7,40}\s*$/m,
  /^Changed block:\s*(?:0\.8|[1-7])\b.*$/m,
  /^Journey:\s*\S.+$/m,
  /^Viewport:\s*\S.+$/m,
  /^Result:\s*(?:PASS|FAIL|FLAKY|BLOCKED)\s*$/m,
  /^## Reproduction steps\s*$/m,
  /^## Expected\s*$/m,
  /^## Observed\s*$/m,
  /^## Evidence manifest\s*$/m,
  /^## Console and network\s*$/m,
  /^weakened_checks:\s*\S.+$/m,
  /^Owner block:\s*[1-7]\s*$/m,
  /^Targeted retest:\s*\S.+$/m,
];

const missing = required.filter((pattern) => !pattern.test(report));
if (missing.length) {
  console.error(`QA report is missing ${missing.length} required field(s).`);
  process.exit(1);
}

if (/Result:\s*PASS/.test(report)) {
  const passProofs = [
    /screenshot/i,
    /console/i,
    /network/i,
    /refresh/i,
    /persist/i,
  ];
  if (passProofs.some((pattern) => !pattern.test(report))) {
    console.error('PASS lacks browser, refresh, persistence, console or network evidence.');
    process.exit(1);
  }
}

if (/(?:authorization|bearer|api[_ -]?key|cookie):\s*\S+/i.test(report)) {
  console.error('QA report appears to contain authentication material.');
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, report: reportPath }));

