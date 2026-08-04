import assert from 'node:assert/strict';
import test from 'node:test';
import { publicManifestView } from '../../src/runner/public-manifest.js';

const SHA = 'a'.repeat(64);

test('public manifest projection removes private transport data while preserving verifiable provenance', () => {
  const historical = {
    schema_version: '1.0.0',
    run_id: 'source-run',
    job_id: 'web-source-run',
    job_hash: 'b'.repeat(64),
    execution_hash: 'c'.repeat(64),
    state: 'COMPLETED',
    outputs: {
      avatar: { path: '/Users/private-user/runtime/outputs/avatar.png', sha256: SHA },
      avatar_outfit: { path: '/Users/private-user/runtime/outputs/avatar_outfit.png', sha256: 'd'.repeat(64) },
    },
    attempts: { conditioning: 1, avatar: 0, outfit: 1 },
    models: {
      avatar: { name: 'Approved avatar reuse', job_set_type: 'approved_avatar_reuse', reused: true, source_run_id: 'source-run' },
      outfit: { name: 'GPT Image 2', job_set_type: 'gpt_image_2' },
    },
    image_artifacts: {
      avatar: {
        approved_reuse: true,
        imported: { digest: SHA, path: '/Users/private-user/.local/share/madeforthisjob/app/runtime/avatar.png', size: 123, mediaType: 'image/png', extension: '.png' },
        provenance: { source_run_id: 'source-run', source_sha256: SHA, qa_receipt_sha256: 'e'.repeat(64), pack_path: '/tmp/private-pack.json' },
      },
    },
    prompts: {
      outfit: {
        phase: 'outfit',
        attempt: 1,
        sha256: 'f'.repeat(64),
        path: '/Users/private-user/runtime/prompt.txt',
        text: 'Zeely private prompt using /Users/private-user/runtime/avatar.png',
      },
    },
    qa: {
      avatar: {
        decision: 'PASS',
        reason: 'Zeely approved this image from /custom/private-user/runtime/avatar.png',
        reused: true,
        source_run_id: 'source-run',
        avatar_sha256: SHA,
        receipt_sha256: 'e'.repeat(64),
        checks: [{ name: 'identity', pass: true, score: 0.99, evidence: 'same person' }],
        defects: [],
        artifact: { digest: '1'.repeat(64), path: '/private/var/runtime/qa.json', mediaType: 'application/json' },
        provider_journal: { journal_path: '/Users/private-user/runtime/private-journal.json' },
      },
    },
  };
  const before = structuredClone(historical);

  const manifest = publicManifestView(historical);
  const serialized = JSON.stringify(manifest);

  assert.deepEqual(historical, before, 'projection must never mutate the hash-bound internal receipt');
  assert.doesNotMatch(serialized, /\/Users\/|private-user|madeforthisjob|zeely|\.zeely-run/iu);
  assert.doesNotMatch(serialized, /provider_journal|journal_path|pack_path|"path"|"text"/u);
  assert.deepEqual(manifest.outputs.avatar, { sha256: SHA });
  assert.deepEqual(manifest.prompts.outfit, { phase: 'outfit', attempt: 1, sha256: 'f'.repeat(64) });
  assert.equal(manifest.models.avatar.reused, true);
  assert.equal(manifest.models.avatar.source_run_id, 'source-run');
  assert.equal(manifest.image_artifacts.avatar.imported.digest, SHA);
  assert.equal(manifest.image_artifacts.avatar.provenance.qa_receipt_sha256, 'e'.repeat(64));
  assert.equal(manifest.qa.avatar.decision, 'PASS');
  assert.equal(manifest.qa.avatar.artifact.digest, '1'.repeat(64));
  assert.equal(manifest.qa.avatar.checks[0].score, 0.99);
});
