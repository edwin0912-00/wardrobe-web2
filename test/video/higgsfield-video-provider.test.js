import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_VIDEO_REQUEST,
  HiggsfieldVideoProvider,
  SEEDANCE_SPEC,
  VideoProviderError,
  buildVideoCreateArgs,
  buildVideoWaitArgs,
} from '../../src/providers/higgsfield-video-provider.js';

const BASE = Object.freeze({
  prompt: 'Editorial fashion motion: the subject breathes, fabric settles, the camera holds still.',
  mediaPaths: ['/tmp/locked-frame.png'],
});

function flag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

test('the declared default is 16:9, per the operator decision', () => {
  assert.equal(DEFAULT_VIDEO_REQUEST.aspectRatio, '16:9');
  const args = buildVideoCreateArgs(BASE);
  assert.equal(flag(args, '--aspect_ratio'), '16:9');
});

test('audio is forced off on every request', () => {
  const args = buildVideoCreateArgs(BASE);
  assert.equal(flag(args, '--generate_audio'), 'false');
  // and it cannot be turned on by passing it through
  const sneaky = buildVideoCreateArgs({ ...BASE, generateAudio: true });
  assert.equal(flag(sneaky, '--generate_audio'), 'false');
});

test('aspect, duration and resolution travel as parameters, not prose', () => {
  const args = buildVideoCreateArgs({ ...BASE, durationSeconds: 7, resolution: '1080p' });
  assert.equal(flag(args, '--duration'), '7');
  assert.equal(flag(args, '--resolution'), '1080p');
  assert.equal(flag(args, '--prompt'), BASE.prompt);
  assert.ok(args.includes('--json') && args.includes('--no-color'));
  assert.equal(args[0], 'generate');
  assert.equal(args[1], 'create');
  assert.equal(args[2], 'seedance_2_0');
});

test('a verified motion reference travels through the dedicated video flag', () => {
  const args = buildVideoCreateArgs({
    ...BASE,
    videoPaths: ['/runtime/references/walk.mp4'],
  });
  assert.equal(flag(args, '--image-references'), BASE.mediaPaths[0]);
  assert.equal(flag(args, '--video-references'), '/runtime/references/walk.mp4');
  assert.ok(args.indexOf('--video-references') < args.indexOf('--image-references'));
});

test('a prompt that names geometry is refused', () => {
  for (const prompt of [
    'A 16:9 editorial clip of the subject walking',
    'Hold the pose for 5 seconds while the camera drifts',
    'Editorial motion rendered at 1080p',
  ]) {
    assert.throws(
      () => buildVideoCreateArgs({ ...BASE, prompt }),
      (error) => {
        assert.equal(error.code, 'GEOMETRY_IN_PROMPT');
        return true;
      },
      prompt,
    );
  }
});

test('4:5 is not offered, because Seedance does not have it', () => {
  assert.equal(SEEDANCE_SPEC.aspectRatios.includes('4:5'), false);
  assert.throws(
    () => buildVideoCreateArgs({ ...BASE, aspectRatio: '4:5' }),
    (error) => {
      assert.equal(error.code, 'INVALID_VIDEO_OPTION');
      return true;
    },
  );
});

test('a request without a locked source frame is refused', () => {
  assert.throws(
    () => buildVideoCreateArgs({ ...BASE, mediaPaths: [] }),
    (error) => {
      assert.equal(error.code, 'MISSING_VIDEO_SOURCE');
      return true;
    },
  );
});

test('duration is bounded', () => {
  for (const durationSeconds of [0, 2, 16, 5.5]) {
    assert.throws(() => buildVideoCreateArgs({ ...BASE, durationSeconds }), VideoProviderError);
  }
});

test('an unknown model is refused', () => {
  assert.throws(
    () => buildVideoCreateArgs({ ...BASE, model: 'veo3' }),
    (error) => {
      assert.equal(error.code, 'INVALID_VIDEO_OPTION');
      return true;
    },
  );
});

test('the wait argv is bounded and rejects an unsafe job id', () => {
  const args = buildVideoWaitArgs({ jobId: 'job_123', waitTimeout: '10m', waitInterval: '5s' });
  assert.deepEqual(args, ['generate', 'wait', 'job_123', '--timeout', '10m', '--interval', '5s', '--json', '--no-color']);
  assert.throws(() => buildVideoWaitArgs({ jobId: '; rm -rf /' }), (error) => {
    assert.equal(error.code, 'INVALID_VIDEO_JOB_ID');
    return true;
  });
  assert.throws(() => buildVideoWaitArgs({ jobId: 'job_123', waitTimeout: 'forever' }), VideoProviderError);
});

test('the job id is handed over before the wait phase, so a restart can resume', async () => {
  const calls = [];
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async (binary, args) => {
      calls.push(args[1]);
      if (args[1] === 'create') return { stdout: JSON.stringify({ job_id: 'job_abc' }), stderr: '' };
      return { stdout: JSON.stringify({ job_id: 'job_abc', results: [{ url: 'https://cdn.example/clip.mp4' }] }), stderr: '' };
    },
  });

  const seen = [];
  const result = await provider.generate(BASE, {
    onJobCreated: async (created) => {
      seen.push(created.jobId);
      // the persistence hook must run before any wait call happened
      assert.deepEqual(calls, ['create']);
    },
  });

  assert.deepEqual(seen, ['job_abc']);
  assert.deepEqual(calls, ['create', 'wait']);
  assert.equal(result.url, 'https://cdn.example/clip.mp4');
  assert.equal(result.selectedFieldPath, '/results/0/url');
  assert.equal(result.request.aspectRatio, '16:9');
});

test('wait selects an explicit result URL and never an earlier input reference URL', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify({
        job_id: 'job_bound',
        request: { video_url: 'https://cdn.example/private-reference.mp4' },
        result: { output_url: 'https://cdn.example/generated-output.mp4' },
      }),
      stderr: '',
    }),
  });
  const finished = await provider.waitForJob({ jobId: 'job_bound' });
  assert.equal(finished.url, 'https://cdn.example/generated-output.mp4');
  assert.equal(finished.selectedFieldPath, '/result/output_url');
});

test('wait accepts the CLI result_url envelope at the root', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify({
        job_id: 'job_root_result_url',
        request: { video_url: 'https://cdn.example/private-reference.mp4' },
        result_url: 'https://cdn.example/generated-output.mp4',
      }),
      stderr: '',
    }),
  });
  const finished = await provider.waitForJob({ jobId: 'job_root_result_url' });
  assert.equal(finished.url, 'https://cdn.example/generated-output.mp4');
  assert.equal(finished.selectedFieldPath, '/result_url');
});

test('wait fails closed when explicit result fields name different video outputs', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify({
        job_id: 'job_ambiguous',
        results: [
          { url: 'https://cdn.example/output-a.mp4' },
          { url: 'https://cdn.example/output-b.mp4' },
        ],
      }),
      stderr: '',
    }),
  });
  await assert.rejects(() => provider.waitForJob({ jobId: 'job_ambiguous' }), (error) => {
    assert.equal(error.code, 'AMBIGUOUS_VIDEO_OUTPUT');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('wait refuses an input reference URL when no explicit output exists', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify({
        job_id: 'job_no_output',
        request: { video_url: 'https://cdn.example/private-reference.mp4' },
      }),
      stderr: '',
    }),
  });
  await assert.rejects(() => provider.waitForJob({ jobId: 'job_no_output' }), (error) => {
    assert.equal(error.code, 'MISSING_VIDEO_OUTPUT');
    return true;
  });
});

test('wait refuses an input URL even when it is nested inside a result envelope', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify({
        job_id: 'job_nested_input',
        result: { input: { video_url: 'https://cdn.example/private-reference.mp4' } },
      }),
      stderr: '',
    }),
  });
  await assert.rejects(() => provider.waitForJob({ jobId: 'job_nested_input' }), (error) => {
    assert.equal(error.code, 'MISSING_VIDEO_OUTPUT');
    return true;
  });
});

test('a batched CLI create response still yields the created job id', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify([{ id: 'job_from_batch', status: 'queued' }]),
      stderr: '',
    }),
  });
  const created = await provider.createJob(BASE);
  assert.equal(created.jobId, 'job_from_batch');
});

test('the current CLI bare UUID array yields the created job id', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify(['3700eebf-da53-4c60-a58f-7593643a3cd2']),
      stderr: '',
    }),
  });
  const created = await provider.createJob(BASE);
  assert.equal(created.jobId, '3700eebf-da53-4c60-a58f-7593643a3cd2');
});

test('the Higgsfield CLI job_set_id create envelope yields the resumable job id', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify({ job_set_id: 'job_set_from_cli', status: 'queued' }),
      stderr: '',
    }),
  });
  const created = await provider.createJob(BASE);
  assert.equal(created.jobId, 'job_set_from_cli');
});

test('a nested Higgsfield CLI create envelope yields the resumable job id', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({
      stdout: JSON.stringify({
        data: {
          job_set: {
            id: 'job_from_nested_cli_envelope',
            status: 'queued',
          },
        },
      }),
      stderr: '',
    }),
  });
  const created = await provider.createJob(BASE);
  assert.equal(created.jobId, 'job_from_nested_cli_envelope');
});

test('a wait answering about another job is refused', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async (binary, args) => (args[1] === 'create'
      ? { stdout: JSON.stringify({ job_id: 'job_mine' }), stderr: '' }
      : { stdout: JSON.stringify({ job_id: 'job_someone_else', results: [{ url: 'https://cdn.example/x.mp4' }] }), stderr: '' }),
  });
  await assert.rejects(() => provider.generate(BASE), (error) => {
    assert.equal(error.code, 'PROVIDER_JOB_MISMATCH');
    return true;
  });
});

test('a finished job with no video is a retryable failure, not a success', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async (binary, args) => (args[1] === 'create'
      ? { stdout: JSON.stringify({ job_id: 'job_abc' }), stderr: '' }
      : { stdout: JSON.stringify({ job_id: 'job_abc', status: 'completed' }), stderr: '' }),
  });
  await assert.rejects(() => provider.generate(BASE), (error) => {
    assert.equal(error.code, 'MISSING_VIDEO_OUTPUT');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('a missing persisted job is terminal and is not misreported as a timeout', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async (binary, args) => {
      if (args[1] === 'create') return { stdout: JSON.stringify({ job_id: 'job_missing' }), stderr: '' };
      const error = new Error('command failed');
      error.stderr = 'Error: Job not found';
      throw error;
    },
  });
  await assert.rejects(() => provider.generate(BASE), (error) => {
    assert.equal(error.code, 'PROVIDER_JOB_NOT_FOUND');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('a persisted Higgsfield job reported failed is terminal, not a retryable wait error', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async (binary, args) => {
      if (args[1] === 'create') return { stdout: JSON.stringify({ job_id: 'job_failed' }), stderr: '' };
      const error = new Error('job job_failed ended with status "failed"');
      error.stderr = 'Error: job job_failed ended with status "failed"';
      throw error;
    },
  });
  await assert.rejects(() => provider.generate(BASE), (error) => {
    assert.equal(error.code, 'PROVIDER_JOB_FAILED');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('an ordinary Higgsfield wait transport error remains retryable against the same job', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => {
      const error = new Error('connection reset by peer');
      error.stderr = 'network transport error';
      throw error;
    },
  });
  await assert.rejects(() => provider.waitForJob({ jobId: 'job_transport' }), (error) => {
    assert.equal(error.code, 'PROVIDER_COMMAND_FAILED');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('create classifies Higgsfield input-media IP verification as a retryable pre-submit condition', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => {
      const error = new Error('IP check not finished for input media');
      error.stderr = 'IP check not finished for input media';
      throw error;
    },
  });

  await assert.rejects(() => provider.createJob(BASE), (error) => {
    assert.equal(error.code, 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('a create response without a job id is an unknown paid outcome and is not retried', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({ stdout: JSON.stringify({ accepted: true }), stderr: '' }),
  });
  await assert.rejects(() => provider.createJob(BASE), (error) => {
    assert.equal(error.code, 'CREATE_OUTCOME_UNKNOWN');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('non-JSON output is reported as such, never parsed loosely', async () => {
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async () => ({ stdout: 'Error: quota exceeded', stderr: '' }),
  });
  await assert.rejects(() => provider.createJob(BASE), (error) => {
    assert.equal(error.code, 'PROVIDER_RESPONSE_INVALID');
    return true;
  });
});

test('a provider built without a command runner refuses to exist', () => {
  assert.throws(() => new HiggsfieldVideoProvider({}), (error) => {
    assert.equal(error.code, 'PROVIDER_MISCONFIGURED');
    return true;
  });
});
