import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { VideoService, VideoServiceError, ClipStore } from '../../src/web/video-service.js';
import { HiggsfieldVideoProvider } from '../../src/providers/higgsfield-video-provider.js';

// Stubbed provider that tracks calls and returns predictable results
function makeStubProvider({ jobId = 'job_test_123', videoUrl = 'https://cdn.example/clip.mp4' } = {}) {
  const calls = [];
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async (binary, args) => {
      calls.push({ phase: args[1], args });
      if (args[1] === 'create') {
        return { stdout: JSON.stringify({ job_id: jobId }), stderr: '' };
      }
      return {
        stdout: JSON.stringify({ job_id: jobId, results: [{ url: videoUrl }] }),
        stderr: '',
      };
    },
  });
  return { provider, calls };
}

// Stubbed download that returns fake video bytes
function makeStubDownload(bytes = Buffer.from('fake-video-bytes')) {
  return async () => bytes;
}

// Stubbed probe and frame extraction for QA
function makeStubQa({
  durationSeconds = 5.0,
  width = 1280,
  height = 720,
  hasAudio = false,
  frameLuminance = 128,
} = {}) {
  const probeFn = async () => ({ durationSeconds, width, height, hasAudio });
  const extractFrameFn = async () => new Uint8Array(10).fill(frameLuminance);
  return { probeFn, extractFrameFn };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('createClip builds a motion plan and persists the job id', async () => {
  await withTempDir(async (dir) => {
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: '/tmp/locked-frame.png',
    });

    assert.ok(result.clipId);
    assert.equal(result.jobId, 'job_test_123');
    assert.equal(result.status, 'CREATED');
    assert.equal(result.plan.surface, 'tv');
    assert.equal(result.plan.aspectRatio, '16:9');
    assert.equal(result.plan.durationSeconds, 5);

    // Verify the clip was persisted
    const saved = await store.load(result.clipId);
    assert.equal(saved.jobId, 'job_test_123');
    assert.equal(saved.status, 'CREATED');
    assert.equal(saved.surface, 'tv');

    // Only the create phase should have been called
    assert.equal(calls.length, 1);
    assert.equal(calls[0].phase, 'create');
  });
});

test('createClip with mirror surface uses 9:16 aspect', async () => {
  await withTempDir(async (dir) => {
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.createClip({
      modeId: 'camera_drift',
      surfaceId: 'mirror',
      sourceImagePath: '/tmp/locked-frame.png',
    });

    assert.equal(result.plan.surface, 'mirror');
    assert.equal(result.plan.aspectRatio, '9:16');

    // The transport should receive 9:16
    const createArgs = calls[0].args;
    const aspectIdx = createArgs.indexOf('--aspect_ratio');
    assert.equal(createArgs[aspectIdx + 1], '9:16');
  });
});

test('createClip without sourceImagePath is refused', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    await assert.rejects(
      () => service.createClip({ modeId: 'editorial_micro_moment', surfaceId: 'tv' }),
      (error) => {
        assert.equal(error.code, 'MISSING_SOURCE');
        return true;
      },
    );
  });
});

test('awaitAndFinalize downloads video, runs QA, and marks PASS', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: '/tmp/locked-frame.png',
    });

    const result = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      ...makeStubQa(),
    });

    assert.equal(result.status, 'PASS');
    assert.ok(result.videoSha256);
    assert.equal(result.qa.pass, true);
    assert.equal(result.qa.defects.length, 0);
  });
});

test('awaitAndFinalize marks FAIL when QA detects audio', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: '/tmp/locked-frame.png',
    });

    const result = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      ...makeStubQa({ hasAudio: true }),
    });

    assert.equal(result.status, 'FAIL');
    assert.equal(result.qa.pass, false);
    assert.ok(result.qa.defects.some((d) => d.code === 'CLIP_HAS_AUDIO'));
  });
});

test('awaitAndFinalize marks NEEDS_QA when no probeFn provided', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: '/tmp/locked-frame.png',
    });

    const result = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      probeFn: undefined,
      extractFrameFn: undefined,
    });

    assert.equal(result.status, 'NEEDS_QA');
    assert.equal(result.qa, null);
  });
});

test('generateClip runs the full flow in one call', async () => {
  await withTempDir(async (dir) => {
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.generateClip(
      {
        modeId: 'garment_gesture',
        surfaceId: 'tv',
        sourceImagePath: '/tmp/locked-frame.png',
      },
      {
        downloadFn: makeStubDownload(),
        ...makeStubQa(),
      },
    );

    assert.equal(result.status, 'PASS');
    assert.ok(result.clipId);
    assert.ok(result.videoSha256);
    // Both phases should have been called
    assert.equal(calls.length, 2);
    assert.equal(calls[0].phase, 'create');
    assert.equal(calls[1].phase, 'wait');
  });
});

test('awaitAndFinalize on a non-existent clip throws CLIP_NOT_FOUND', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    await assert.rejects(
      () => service.awaitAndFinalize('nonexistent', { downloadFn: makeStubDownload() }),
      (error) => {
        assert.equal(error.code, 'CLIP_NOT_FOUND');
        return true;
      },
    );
  });
});

test('getClip returns persisted metadata', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'camera_drift',
      surfaceId: 'mirror',
      sourceImagePath: '/tmp/locked-frame.png',
    });

    const loaded = await service.getClip(created.clipId);
    assert.ok(loaded);
    assert.equal(loaded.clipId, created.clipId);
    assert.equal(loaded.jobId, 'job_test_123');
    assert.equal(loaded.surface, 'mirror');
    assert.equal(loaded.aspectRatio, '9:16');
  });
});

test('VideoService refuses to construct without provider', () => {
  assert.throws(
    () => new VideoService({ clipStore: new ClipStore('/tmp') }),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISCONFIGURED');
      return true;
    },
  );
});

test('VideoService refuses to construct without clipStore', () => {
  const { provider } = makeStubProvider();
  assert.throws(
    () => new VideoService({ provider }),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISCONFIGURED');
      return true;
    },
  );
});

test('ClipStore refuses to construct without root directory', () => {
  assert.throws(
    () => new ClipStore(''),
    (error) => {
      assert.equal(error.code, 'STORE_MISCONFIGURED');
      return true;
    },
  );
});

test('walk_stride mode is refused without full_length capability', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    await assert.rejects(
      () => service.createClip({
        modeId: 'walk_stride',
        surfaceId: 'tv',
        sourceImagePath: '/tmp/locked-frame.png',
        sourceCapabilities: {},
      }),
      (error) => {
        assert.equal(error.code, 'MOTION_MODE_SOURCE_MISMATCH');
        return true;
      },
    );
  });
});

test('walk_stride mode with full_length capability succeeds', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.createClip({
      modeId: 'walk_stride',
      surfaceId: 'tv',
      sourceImagePath: '/tmp/locked-frame.png',
      sourceCapabilities: { full_length: true },
    });

    assert.equal(result.plan.mode, 'walk_stride');
    assert.equal(result.status, 'CREATED');
  });
});
