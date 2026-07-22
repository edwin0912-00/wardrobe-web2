import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { inspectImage } from '../../src/qa/image-inspector.mjs';
import { PipelineRunner } from '../../src/runner/pipeline-runner.js';
import { STATES } from '../../src/runner/state-machine.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const jobsDirectory = path.join(projectRoot, 'jobs');

for (const subjectId of ['001', '002', '003']) {
  test(`checked-in core job ${subjectId} resolves real packs and completes sequentially`, async () => {
    const job = JSON.parse(await readFile(path.join(jobsDirectory, `${subjectId}.json`), 'utf8'));
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `zeely-core-${subjectId}-`));
    job.output_directory = path.join(temporaryRoot, 'output');
    const provider = new MockProvider();
    const result = await new PipelineRunner({ provider }).runJobObject(job, {
      baseDirectory: jobsDirectory,
    });

    assert.equal(result.status, STATES.COMPLETED);
    const avatarCall = provider.calls.find(
      (call) => call.operation === 'generate' && call.context.phase === 'avatar',
    );
    const outfitCall = provider.calls.find(
      (call) => call.operation === 'generate' && call.context.phase === 'outfit',
    );
    assert.deepEqual(
      avatarCall.context.references.ordered.map((item) => item.role),
      ['IDENTITY_PRIMARY', 'IDENTITY_FACE_DETAIL', 'IDENTITY_PERSON_CONTEXT'],
    );
    assert.equal(outfitCall.context.references.ordered[0].role, 'AVATAR_BASE');
    assert.deepEqual(
      outfitCall.context.references.ordered.slice(1, 4).map((item) => item.role),
      ['IDENTITY_PRIMARY', 'IDENTITY_FACE_DETAIL', 'IDENTITY_PERSON_CONTEXT'],
    );
    if (subjectId === '001') {
      assert.deepEqual(
        outfitCall.context.references.ordered.slice(4).map((item) => item.role),
        ['GARMENT_PRIMARY', 'GARMENT_REFERENCE_CARD'],
      );
    } else {
      assert.equal(outfitCall.context.references.ordered.length, 4);
    }

    for (const filename of ['avatar.png', 'avatar_outfit.png']) {
      const inspected = await inspectImage(path.join(temporaryRoot, 'output', filename));
      assert.equal(inspected.technical_gates.decode.status, 'PASS');
      assert.equal(inspected.background_diagnostics.status, 'PASS');
      assert.equal(inspected.background_diagnostics.every_classified_background_pixel_exact_white, true);
    }
  });
}
