import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ENDPOINT,
  MODEL,
  buildProviderInput,
  estimateUsd,
  main,
  resumePrepared,
  submitPrepared,
  syncDirectory,
  validateInputPack,
} from '../../tools/seedance-reference-pack.mjs';

const prompt = 'Full-scene direction remains authoritative. Use @Image1 and @Image2 for the approved look; use @Video1 and @Video2 only for motion, camera, and timing.';
const videoMetadata = {
  width: 1080,
  height: 1920,
  fps: '25/1',
  frame_count: 331,
  duration_seconds: 13.24,
};

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-seedance-pack-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mediaRoot = path.join(root, 'media');
  await mkdir(mediaRoot);
  const fileSpecs = [
    { label: '@Image1', kind: 'image', path: 'approved-look.png', mime_type: 'image/png', bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]) },
    { label: '@Image2', kind: 'image', path: 'garment-detail.jpg', mime_type: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 1]) },
    { label: '@Video1', kind: 'video', path: 'rgb-reference.mp4', mime_type: 'video/mp4', bytes: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 1]), metadata: videoMetadata },
    { label: '@Video2', kind: 'video', path: 'relative-depth.mp4', mime_type: 'video/mp4', bytes: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 2]), metadata: videoMetadata },
  ];
  for (const file of fileSpecs) await writeFile(path.join(mediaRoot, file.path), file.bytes);
  const manifest = {
    schema_version: 'wardrobe-seedance-reference-pack-v1',
    model: 'seedance-2.5',
    task: 'reference',
    output: { duration_seconds: 14, resolution: '720p', aspect_ratio: '9:16', codec: 'H264', generate_audio: false },
    files: fileSpecs.map(({ bytes, ...file }) => ({ ...file, sha256: hash(bytes) })),
  };
  const manifestPath = path.join(root, 'pack.json');
  const promptPath = path.join(root, 'prompt.txt');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(promptPath, prompt);
  const probeVideoFn = async (sourcePath) => {
    const file = fileSpecs.find(({ path: name }) => path.basename(name) === path.basename(sourcePath));
    return file.metadata;
  };
  const pack = await validateInputPack({ manifest, mediaRoot, prompt, probeVideoFn });
  return { root, mediaRoot, manifest, manifestPath, promptPath, pack, fileSpecs, probeVideoFn };
}

function response(body, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('dry-run preserves positional roles and estimates the verified 2-image, 2-video input', async (t) => {
  const testCase = await fixture(t);
  assert.deepEqual(testCase.pack.files.map(({ label }) => label), ['@Image1', '@Image2', '@Video1', '@Video2']);
  assert.equal(testCase.pack.input_video_seconds, 26.48);
  assert.ok(Math.abs(testCase.pack.estimated_usd - 11.22688512) < 1e-8);
  const urls = new Map(testCase.pack.files.map((file) => [file.label, `https://v3.fal.media/${file.label.slice(1)}.asset`]));
  const input = buildProviderInput(testCase.pack, urls);
  assert.deepEqual(input.image_urls, ['https://v3.fal.media/Image1.asset', 'https://v3.fal.media/Image2.asset']);
  assert.deepEqual(input.video_urls, ['https://v3.fal.media/Video1.asset', 'https://v3.fal.media/Video2.asset']);
  assert.equal(input.prompt, prompt);
  assert.equal(input.task, 'reference');
  assert.equal(input.duration, '14');
  assert.equal(input.aspect_ratio, '9:16');
  assert.equal(input.generate_audio, false);
  assert.equal(MODEL, 'seedance-2.5');
  assert.equal(ENDPOINT, 'bytedance/seedance-2.5/reference-to-video');
  assert.equal(estimateUsd({ inputVideoSeconds: 26.48, outputDurationSeconds: 14 }), testCase.pack.estimated_usd);
});

test('--help is light and does not need provider configuration', async () => {
  const result = await main(['--help']);
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Default: validate and estimate only/);
});

test('CLI defaults to dry-run and makes no storage call, POST, or receipt', async (t) => {
  const testCase = await fixture(t);
  const stateDir = path.join(testCase.root, 'private-state');
  let uploads = 0;
  let posts = 0;
  const result = await main([
    '--manifest', testCase.manifestPath,
    '--media-root', testCase.mediaRoot,
    '--prompt-file', testCase.promptPath,
    '--state-dir', stateDir,
  ], {
    probeVideoFn: testCase.probeVideoFn,
    submit: {
      falKey: 'fake-test-key',
      falClientFactory: async () => ({ storage: { upload: async () => { uploads += 1; return 'https://v3.fal.media/unexpected'; } } }),
      fetchImpl: async () => { posts += 1; return response({}); },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.state, 'DRY_RUN');
  assert.equal(uploads, 0);
  assert.equal(posts, 0);
  await assert.rejects(readFile(path.join(stateDir, 'submission.json')));
});

test('source hashes, MIME, video timing, and combined model limits fail before upload', async (t) => {
  const testCase = await fixture(t);
  const changedManifest = structuredClone(testCase.manifest);
  changedManifest.files[0].sha256 = 'a'.repeat(64);
  await assert.rejects(validateInputPack({ manifest: changedManifest, mediaRoot: testCase.mediaRoot, prompt, probeVideoFn: testCase.probeVideoFn }), { code: 'SOURCE_HASH_MISMATCH' });

  const missingManifest = structuredClone(testCase.manifest);
  missingManifest.files[0].path = 'missing.png';
  await assert.rejects(validateInputPack({ manifest: missingManifest, mediaRoot: testCase.mediaRoot, prompt, probeVideoFn: testCase.probeVideoFn }), { code: 'SOURCE_MISSING' });

  const badMimeManifest = structuredClone(testCase.manifest);
  badMimeManifest.files[0].mime_type = 'image/jpeg';
  await assert.rejects(validateInputPack({ manifest: badMimeManifest, mediaRoot: testCase.mediaRoot, prompt, probeVideoFn: testCase.probeVideoFn }), { code: 'SOURCE_MIME_MISMATCH' });

  await assert.rejects(validateInputPack({
    manifest: testCase.manifest,
    mediaRoot: testCase.mediaRoot,
    prompt,
    probeVideoFn: async (sourcePath) => ({ ...(await testCase.probeVideoFn(sourcePath)), duration_seconds: 13.3 }),
  }), { code: 'VIDEO_METADATA_CHANGED' });

  const overLimit = structuredClone(testCase.manifest);
  overLimit.files[2].metadata.duration_seconds = 16;
  overLimit.files[2].metadata.frame_count = 400;
  overLimit.files[3].metadata.duration_seconds = 16;
  overLimit.files[3].metadata.frame_count = 400;
  await assert.rejects(validateInputPack({
    manifest: overLimit,
    mediaRoot: testCase.mediaRoot,
    prompt,
    probeVideoFn: async () => ({ ...videoMetadata, duration_seconds: 16, frame_count: 400 }),
  }), { code: 'VIDEO_TOTAL_DURATION_LIMIT' });
});

test('non-finite or malformed probe metadata fails before any provider side effect', async (t) => {
  const testCase = await fixture(t);
  const invalidMetadata = [
    { duration_seconds: Number.NaN },
    { duration_seconds: Number.POSITIVE_INFINITY },
    { fps: '25/0' },
    { fps: '25/1/0' },
    { fps: 'not-a-rate' },
    { frame_count: 0 },
    { frame_count: -1 },
  ];

  for (const override of invalidMetadata) {
    let clientCalls = 0;
    let uploadCalls = 0;
    let postCalls = 0;
    const result = await main([
      '--manifest', testCase.manifestPath,
      '--media-root', testCase.mediaRoot,
      '--prompt-file', testCase.promptPath,
      '--state-dir', path.join(testCase.root, 'private-state'),
      '--submit',
      '--max-estimate-usd', '20',
    ], {
      probeVideoFn: async (sourcePath) => {
        const actual = await testCase.probeVideoFn(sourcePath);
        return path.basename(sourcePath) === 'rgb-reference.mp4' ? { ...actual, ...override } : actual;
      },
      submit: {
        falKey: 'fake-test-key',
        falClientFactory: async () => {
          clientCalls += 1;
          return { storage: { upload: async () => { uploadCalls += 1; return 'https://v3.fal.media/file'; } } };
        },
        fetchImpl: async () => { postCalls += 1; return response({}); },
      },
    });
    assert.equal(result.exitCode, 1, JSON.stringify(override));
    assert.equal(result.output.code, 'VIDEO_METADATA_INVALID', JSON.stringify(override));
    assert.equal(clientCalls, 0, JSON.stringify(override));
    assert.equal(uploadCalls, 0, JSON.stringify(override));
    assert.equal(postCalls, 0, JSON.stringify(override));
  }
});

test('relative source symlinks stay inside the real media root', async (t) => {
  const testCase = await fixture(t);
  const outsideBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 99]);
  const outsideFile = path.join(testCase.root, 'outside.png');
  const escapeLink = path.join(testCase.mediaRoot, 'escape.png');
  await writeFile(outsideFile, outsideBytes);
  await symlink(path.relative(testCase.mediaRoot, outsideFile), escapeLink);
  const escapingManifest = structuredClone(testCase.manifest);
  escapingManifest.files[0].path = 'escape.png';
  escapingManifest.files[0].sha256 = hash(outsideBytes);
  const escapingManifestPath = path.join(testCase.root, 'escaping-pack.json');
  await writeFile(escapingManifestPath, JSON.stringify(escapingManifest));

  let clientCalls = 0;
  let uploadCalls = 0;
  let postCalls = 0;
  const escaped = await main([
    '--manifest', escapingManifestPath,
    '--media-root', testCase.mediaRoot,
    '--prompt-file', testCase.promptPath,
    '--state-dir', path.join(testCase.root, 'escape-state'),
    '--submit',
    '--max-estimate-usd', '20',
  ], {
    probeVideoFn: testCase.probeVideoFn,
    submit: {
      falKey: 'fake-test-key',
      falClientFactory: async () => {
        clientCalls += 1;
        return { storage: { upload: async () => { uploadCalls += 1; return 'https://v3.fal.media/file'; } } };
      },
      fetchImpl: async () => { postCalls += 1; return response({}); },
    },
  });
  assert.equal(escaped.exitCode, 1);
  assert.equal(escaped.output.code, 'SOURCE_PATH_INVALID');
  assert.equal(clientCalls, 0);
  assert.equal(uploadCalls, 0);
  assert.equal(postCalls, 0);

  const insideTarget = path.join(testCase.mediaRoot, 'inside-copy.png');
  const insideLink = path.join(testCase.mediaRoot, 'inside-link.png');
  const originalImage = await readFile(path.join(testCase.mediaRoot, 'approved-look.png'));
  await writeFile(insideTarget, originalImage);
  await symlink('inside-copy.png', insideLink);
  const inRootManifest = structuredClone(testCase.manifest);
  inRootManifest.files[0].path = 'inside-link.png';
  const accepted = await validateInputPack({
    manifest: inRootManifest,
    mediaRoot: testCase.mediaRoot,
    prompt,
    probeVideoFn: testCase.probeVideoFn,
  });
  assert.equal(accepted.files[0].sha256, inRootManifest.files[0].sha256);
});

test('budget rejection happens before storage or provider POST', async (t) => {
  const testCase = await fixture(t);
  let clientCalls = 0;
  let postCalls = 0;
  await assert.rejects(submitPrepared(testCase.pack, {
    stateDir: path.join(testCase.root, 'private-state'),
    maxEstimateUsd: 1,
    falKey: 'fake-test-key',
    falClientFactory: async () => { clientCalls += 1; return { storage: { upload: async () => 'https://v3.fal.media/file' } }; },
    fetchImpl: async () => { postCalls += 1; return response({}); },
  }), { code: 'BUDGET_EXCEEDED' });
  assert.equal(clientCalls, 0);
  assert.equal(postCalls, 0);
});

test('invalid cost estimates are rejected before client creation, upload, or POST', async (t) => {
  const testCase = await fixture(t);
  for (const estimate of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
    let clientCalls = 0;
    let uploadCalls = 0;
    let postCalls = 0;
    await assert.rejects(submitPrepared({ ...testCase.pack, estimated_usd: estimate }, {
      stateDir: path.join(testCase.root, `invalid-estimate-${String(estimate)}`),
      maxEstimateUsd: 20,
      falKey: 'fake-test-key',
      falClientFactory: async () => {
        clientCalls += 1;
        return { storage: { upload: async () => { uploadCalls += 1; return 'https://v3.fal.media/file'; } } };
      },
      fetchImpl: async () => { postCalls += 1; return response({}); },
    }), { code: 'COST_ESTIMATE_INVALID' });
    assert.equal(clientCalls, 0, String(estimate));
    assert.equal(uploadCalls, 0, String(estimate));
    assert.equal(postCalls, 0, String(estimate));
  }
});

test('directory fsync failures propagate on Unix and are skipped only on Windows', async () => {
  for (const code of ['EIO', 'EACCES']) {
    let closeCalls = 0;
    const failure = Object.assign(new Error('injected directory sync failure'), { code });
    await assert.rejects(syncDirectory('/private/state', {
      platform: 'darwin',
      openDirectory: async () => ({
        sync: async () => { throw failure; },
        close: async () => { closeCalls += 1; },
      }),
    }), { code });
    assert.equal(closeCalls, 1);
  }
  let windowsOpenCalls = 0;
  await syncDirectory('unused', {
    platform: 'win32',
    openDirectory: async () => { windowsOpenCalls += 1; throw new Error('must not open directory'); },
  });
  assert.equal(windowsOpenCalls, 0);
});

test('SUBMITTING directory fsync failure prevents the only provider create POST', async (t) => {
  const testCase = await fixture(t);
  const stateDir = path.join(testCase.root, 'private-state');
  let syncCalls = 0;
  let uploadCalls = 0;
  let postCalls = 0;
  const failure = Object.assign(new Error('injected EIO'), { code: 'EIO' });
  await assert.rejects(submitPrepared(testCase.pack, {
    stateDir,
    maxEstimateUsd: 12,
    falKey: 'fake-test-key',
    syncDirectoryFn: async () => {
      syncCalls += 1;
      if (syncCalls === 5) throw failure;
    },
    falClientFactory: async () => ({ storage: { upload: async (file) => {
      uploadCalls += 1;
      return `https://v3.fal.media/${file.name}`;
    } } }),
    fetchImpl: async () => { postCalls += 1; return response({}); },
  }), { code: 'EIO' });
  assert.equal(syncCalls, 5);
  assert.equal(uploadCalls, 4);
  assert.equal(postCalls, 0);
  const receipt = JSON.parse(await readFile(path.join(stateDir, 'submission.json'), 'utf8'));
  assert.equal(receipt.state, 'SUBMITTING');
});

test('partial upload blocks queue creation and records only completed uploads', async (t) => {
  const testCase = await fixture(t);
  const stateDir = path.join(testCase.root, 'private-state');
  let uploadCount = 0;
  let postCount = 0;
  await assert.rejects(submitPrepared(testCase.pack, {
    stateDir,
    maxEstimateUsd: 12,
    falKey: 'fake-test-key',
    falClientFactory: async () => ({ storage: { upload: async () => {
      uploadCount += 1;
      if (uploadCount === 2) throw new Error('fake upload failure');
      return 'https://v3.fal.media/image-one';
    } } }),
    fetchImpl: async () => { postCount += 1; return response({}); },
  }), { code: 'UPLOAD_FAILED' });
  assert.equal(uploadCount, 2);
  assert.equal(postCount, 0);
  const uploads = JSON.parse(await readFile(path.join(stateDir, 'uploads.json'), 'utf8'));
  assert.equal(uploads.files.length, 1);
  await assert.rejects(readFile(path.join(stateDir, 'submission.json')));
});

test('one create POST records SUBMITTING first; resume requires the exact receipt and reuses its request ID', async (t) => {
  const testCase = await fixture(t);
  const stateDir = path.join(testCase.root, 'private-state');
  let uploadCount = 0;
  let postCount = 0;
  let getCount = 0;
  const falClientFactory = async () => ({ storage: { upload: async (file) => {
    uploadCount += 1;
    assert.equal(file.type, file.name.endsWith('.mp4') ? 'video/mp4' : file.name.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return `https://v3.fal.media/${file.name}`;
  } } });
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      postCount += 1;
      const submitting = JSON.parse(await readFile(path.join(stateDir, 'submission.json'), 'utf8'));
      assert.equal(submitting.state, 'SUBMITTING');
      assert.equal(submitting.endpoint, ENDPOINT);
      const input = JSON.parse(options.body);
      assert.equal(input.prompt, prompt);
      assert.deepEqual(input.image_urls, ['https://v3.fal.media/approved-look.png', 'https://v3.fal.media/garment-detail.jpg']);
      assert.deepEqual(input.video_urls, ['https://v3.fal.media/rgb-reference.mp4', 'https://v3.fal.media/relative-depth.mp4']);
      return response({
        request_id: 'request-one',
        status_url: 'https://queue.fal.run/bytedance/seedance-2.5/reference-to-video/requests/request-one/status',
        response_url: 'https://queue.fal.run/bytedance/seedance-2.5/reference-to-video/requests/request-one',
      });
    }
    getCount += 1;
    assert.equal(url, 'https://queue.fal.run/bytedance/seedance-2.5/reference-to-video/requests/request-one/status');
    return response({ status: 'IN_PROGRESS' });
  };
  const submitted = await submitPrepared(testCase.pack, {
    stateDir,
    maxEstimateUsd: 12,
    falKey: 'fake-test-key',
    falClientFactory,
    fetchImpl,
    now: () => '2026-10-03T00:00:00.000Z',
  });
  assert.equal(submitted.state, 'SUBMITTED');
  assert.equal(submitted.request_id, 'request-one');
  assert.equal(uploadCount, 4);
  assert.equal(postCount, 1);
  const receipt = JSON.parse(await readFile(path.join(stateDir, 'submission.json'), 'utf8'));
  assert.equal(receipt.input_sha256, hash(Buffer.from(JSON.stringify(receipt.input))));
  await assert.rejects(submitPrepared(testCase.pack, {
    stateDir,
    maxEstimateUsd: 12,
    falKey: 'fake-test-key',
    falClientFactory,
    fetchImpl,
  }), { code: 'SUBMISSION_EXISTS' });
  await assert.rejects(resumePrepared(testCase.pack, {
    stateDir,
    requestId: 'request-two',
    falKey: 'fake-test-key',
    fetchImpl,
  }), { code: 'RESUME_ID_MISMATCH' });
  const resumed = await resumePrepared(testCase.pack, {
    stateDir,
    requestId: 'request-one',
    falKey: 'fake-test-key',
    fetchImpl,
  });
  assert.equal(resumed.state, 'RUNNING');
  assert.equal(resumed.request_id, 'request-one');
  assert.equal(postCount, 1);
  assert.equal(getCount, 1);
});

test('unknown create outcome is terminal and cannot be auto-resubmitted', async (t) => {
  const testCase = await fixture(t);
  const stateDir = path.join(testCase.root, 'private-state');
  let uploadCount = 0;
  let postCount = 0;
  const options = {
    stateDir,
    maxEstimateUsd: 12,
    falKey: 'fake-test-key',
    falClientFactory: async () => ({ storage: { upload: async () => {
      uploadCount += 1;
      return `https://v3.fal.media/file-${uploadCount}`;
    } } }),
    fetchImpl: async () => { postCount += 1; throw new Error('fake lost response'); },
  };
  await assert.rejects(submitPrepared(testCase.pack, options), { code: 'CREATE_OUTCOME_UNKNOWN' });
  const receipt = JSON.parse(await readFile(path.join(stateDir, 'submission.json'), 'utf8'));
  assert.equal(receipt.state, 'UNKNOWN');
  await assert.rejects(submitPrepared(testCase.pack, options), { code: 'SUBMISSION_EXISTS' });
  assert.equal(uploadCount, 4);
  assert.equal(postCount, 1);
  await assert.rejects(resumePrepared(testCase.pack, {
    stateDir,
    requestId: 'request-one',
    falKey: 'fake-test-key',
    fetchImpl: async () => { throw new Error('must not poll an unbound ID'); },
  }), { code: 'RESUME_ID_MISMATCH' });
});

test('a provider rejection is terminal and remains bound to the rejected job', async (t) => {
  const testCase = await fixture(t);
  const stateDir = path.join(testCase.root, 'private-state');
  let postCount = 0;
  const options = {
    stateDir,
    maxEstimateUsd: 12,
    falKey: 'fake-test-key',
    falClientFactory: async () => ({ storage: { upload: async (file) => `https://v3.fal.media/${file.name}` } }),
    fetchImpl: async () => { postCount += 1; return response({ error: 'terminal test fixture' }, 422); },
  };
  await assert.rejects(submitPrepared(testCase.pack, options), { code: 'PROVIDER_REJECTED' });
  const receipt = JSON.parse(await readFile(path.join(stateDir, 'submission.json'), 'utf8'));
  assert.equal(receipt.state, 'REJECTED');
  assert.equal(receipt.retryable, false);
  await assert.rejects(submitPrepared(testCase.pack, options), { code: 'SUBMISSION_EXISTS' });
  assert.equal(postCount, 1);
});
