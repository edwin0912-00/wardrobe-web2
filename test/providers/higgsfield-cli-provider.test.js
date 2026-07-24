import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MOCK_PNG } from '../../src/providers/mock-provider.js';
import {
  buildHiggsfieldCreateArgs,
  buildHiggsfieldGenerateArgs,
  buildHiggsfieldWaitArgs,
  HiggsfieldCliProvider,
  HiggsfieldProviderError,
} from '../../src/providers/higgsfield-cli-provider.js';

const MOCK_SHA256 = createHash('sha256').update(MOCK_PNG).digest('hex');

function oneShotProvider(options = {}) {
  return new HiggsfieldCliProvider({ generationMode: 'oneshot', ...options });
}

async function mediaFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zeely-higgsfield-provider-'));
  const paths = {};
  for (const name of ['avatar', 'identity', 'outfit']) {
    paths[name] = path.join(directory, `${name}.png`);
    await writeFile(paths[name], MOCK_PNG);
  }
  return paths;
}

function pngResponse(bytes = MOCK_PNG, overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return 'image/png';
        if (name.toLowerCase() === 'content-length') return String(bytes.length);
        return null;
      },
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    ...overrides,
  };
}

function completedJob(model, overrides = {}) {
  return {
    id: 'job-123',
    status: 'completed',
    display_name: model === 'gpt_image_2' ? 'GPT Image 2' : 'Nano Banana 2',
    job_set_type: model,
    result_url: 'https://assets.cloudfront.net/result.png?temporary=token',
    params: { aspect_ratio: '3:4', resolution: '2k', quality: 'high', model: 'provider-internal' },
    ...overrides,
  };
}

test('executes Higgsfield with argv-only input, stable outfit media order, and complete provenance', async () => {
  const paths = await mediaFixture();
  const calls = [];
  const prompt = 'Keep identity; literal token: "; touch forbidden-target; $HOME';
  const provider = oneShotProvider({
    async commandRunner(binary, args, options) {
      calls.push({ binary, args, options });
      return { stdout: JSON.stringify(completedJob('gpt_image_2')), stderr: '', exitCode: 0 };
    },
    async fetchImpl(url, options) {
      calls.push({ url: String(url), options });
      return pngResponse();
    },
  });

  const response = await provider.generate({
    phase: 'outfit',
    model: 'gpt_image_2',
    prompt,
    idempotencyKey: 'a'.repeat(64),
    references: {
      identity: { artifact: { path: paths.identity, digest: MOCK_SHA256 } },
      outfit: { artifact: { path: paths.outfit, digest: MOCK_SHA256 } },
      avatar: { artifact: { path: paths.avatar, digest: MOCK_SHA256 } },
    },
  });

  const command = calls[0];
  assert.equal(command.binary, 'higgsfield');
  assert.equal(command.options.shell, false);
  assert.equal(command.args[command.args.indexOf('--prompt') + 1], prompt, 'prompt must remain one argv value');
  assert.equal(command.args.includes('--aspect_ratio'), true);
  assert.equal(command.args.includes('--aspect-ratio'), false);
  assert.deepEqual(
    command.args.flatMap((item, index) => item === '--image' ? [command.args[index + 1]] : []),
    [paths.avatar, paths.identity, paths.outfit],
  );
  assert.equal(calls[1].options.redirect, 'manual');
  assert.deepEqual(response.image, MOCK_PNG);
  assert.equal(response.mediaType, 'image/png');
  assert.equal(response.metadata.provider, 'higgsfield');
  assert.equal(response.metadata.job_id, 'job-123');
  assert.equal(response.metadata.job_set_type, 'gpt_image_2');
  assert.equal(response.metadata.provider_internal_model, 'provider-internal');
  assert.equal(response.metadata.result_url.includes('?'), false, 'temporary query data must not enter provenance');
  assert.equal(response.metadata.input_media[0].role, 'approved_avatar');
  assert.match(response.metadata.output_sha256, /^[a-f0-9]{64}$/);
});

test('builds exact two-phase argv and only sends quality to GPT Image 2', () => {
  for (const model of ['gpt_image_2', 'nano_banana_flash', 'nano_banana_2']) {
    const args = buildHiggsfieldCreateArgs({
      model,
      prompt: 'portrait',
      mediaPaths: ['/tmp/reference.png'],
    });
    assert.equal(args[2], model);
    assert.equal(args.includes('--quality'), model === 'gpt_image_2');
    assert.equal(args.includes('--wait'), false);
    assert.deepEqual(args.slice(-2), ['--json', '--no-color']);
  }
  assert.deepEqual(buildHiggsfieldWaitArgs({ jobId: 'job-123' }), [
    'generate', 'wait', 'job-123',
    '--timeout', '20m',
    '--interval', '3s',
    '--json', '--no-color',
  ]);

  const legacy = buildHiggsfieldGenerateArgs({
    model: 'gpt_image_2', prompt: 'portrait', mediaPaths: ['/tmp/reference.png'],
  });
  assert.deepEqual(
    legacy.slice(-7),
    ['--wait', '--wait-timeout', '20m', '--wait-interval', '3s', '--json', '--no-color'],
  );
});

test('fails closed before CLI execution when a provider prompt contains local metadata', async () => {
  for (const prompt of [
    'Read /Users/local-user/private/reference.png',
    'Read C:\\Users\\local-user\\private\\reference.png',
    'Use the Zeely internal route',
    'Use the madeforthisjob internal route',
  ]) {
    assert.throws(
      () => buildHiggsfieldCreateArgs({
        model: 'gpt_image_2',
        prompt,
        mediaPaths: ['/tmp/reference.png'],
      }),
      (error) => error instanceof HiggsfieldProviderError && error.code === 'UNSAFE_PROVIDER_PROMPT' && !error.retryable,
    );
  }
});

test('passes a full conditioned reference pack in declared order', async () => {
  const paths = await mediaFixture();
  const directory = path.dirname(paths.identity);
  const face = path.join(directory, 'face.png');
  const person = path.join(directory, 'person.png');
  const card = path.join(directory, 'card.png');
  await Promise.all([face, person, card].map((filename) => writeFile(filename, MOCK_PNG)));
  const packPath = path.join(directory, 'reference-pack.json');
  const pack = {
    generation_bindings: [
      { order: 1, role: 'IDENTITY_PRIMARY', sha256: MOCK_SHA256 },
      { order: 2, role: 'IDENTITY_FACE_DETAIL', sha256: MOCK_SHA256 },
      { order: 3, role: 'IDENTITY_PERSON_CONTEXT', sha256: MOCK_SHA256 },
      { order: 4, role: 'GARMENT_PRIMARY', sha256: MOCK_SHA256 },
      { order: 5, role: 'GARMENT_REFERENCE_CARD', sha256: MOCK_SHA256 },
    ],
  };
  const packBytes = Buffer.from(JSON.stringify(pack));
  const packSha256 = createHash('sha256').update(packBytes).digest('hex');
  await writeFile(packPath, packBytes);
  let argv;
  const provider = oneShotProvider({
    async commandRunner(binary, args) {
      argv = args;
      return { stdout: JSON.stringify(completedJob('gpt_image_2')) };
    },
    async fetchImpl() { return pngResponse(); },
  });
  const ordered = [
    { order: 1, scope: 'avatar', role: 'APPROVED_AVATAR', path: paths.avatar, sha256: MOCK_SHA256, mediaType: 'image/png', source: 'APPROVED_AVATAR' },
    { order: 2, scope: 'identity', role: 'IDENTITY_PRIMARY', path: paths.identity, sha256: MOCK_SHA256, mediaType: 'image/png', source: 'REFERENCE_PACK', packPath, packSha256, bindingOrder: 1 },
    { order: 3, scope: 'identity', role: 'IDENTITY_FACE_DETAIL', path: face, sha256: MOCK_SHA256, mediaType: 'image/png', source: 'REFERENCE_PACK', packPath, packSha256, bindingOrder: 2 },
    { order: 4, scope: 'identity', role: 'IDENTITY_PERSON_CONTEXT', path: person, sha256: MOCK_SHA256, mediaType: 'image/png', source: 'REFERENCE_PACK', packPath, packSha256, bindingOrder: 3 },
    { order: 5, scope: 'outfit', role: 'GARMENT_PRIMARY', path: paths.outfit, sha256: MOCK_SHA256, mediaType: 'image/png', source: 'REFERENCE_PACK', packPath, packSha256, bindingOrder: 4 },
    { order: 6, scope: 'outfit', role: 'GARMENT_REFERENCE_CARD', path: card, sha256: MOCK_SHA256, mediaType: 'image/png', source: 'REFERENCE_PACK', packPath, packSha256, bindingOrder: 5 },
  ];
  const response = await provider.generate({
    phase: 'outfit', model: 'gpt_image_2', prompt: 'preserve identity and garment',
    references: { ordered },
  });
  assert.deepEqual(
    argv.flatMap((item, index) => item === '--image' ? [argv[index + 1]] : []),
    ordered.map((item) => item.path),
  );
  assert.deepEqual(response.metadata.input_media.map((item) => item.role), ordered.map((item) => item.role));
});

test('scene repair accepts one typed failed candidate immediately after the approved look', async () => {
  const paths = await mediaFixture();
  let argv;
  const provider = oneShotProvider({
    async commandRunner(binary, args) {
      argv = args;
      return { stdout: JSON.stringify(completedJob('gpt_image_2')) };
    },
    async fetchImpl() { return pngResponse(); },
  });
  const ordered = [
    {
      order: 1,
      scope: 'avatar',
      role: 'APPROVED_LOOK_MASTER',
      path: paths.avatar,
      sha256: MOCK_SHA256,
      mediaType: 'image/png',
      source: 'APPROVED_AVATAR',
    },
    {
      order: 2,
      scope: 'scene',
      role: 'FAILED_SCENE_CANDIDATE',
      path: paths.outfit,
      sha256: MOCK_SHA256,
      mediaType: 'image/png',
      source: 'REPAIR_CANDIDATE',
    },
  ];
  const response = await provider.generate({
    phase: 'scene',
    model: 'gpt_image_2',
    prompt: 'Edit the second image only to pull the camera back.',
    references: { ordered },
  });
  assert.deepEqual(
    argv.flatMap((item, index) => item === '--image' ? [argv[index + 1]] : []),
    ordered.map((item) => item.path),
  );
  assert.deepEqual(
    response.metadata.input_media.map(({ scope, role, source }) => ({ scope, role, source })),
    ordered.map(({ scope, role, source }) => ({ scope, role, source })),
  );
});

test('scene repair rejects an untyped source, a misplaced candidate, or more than one candidate before CLI execution', async () => {
  const paths = await mediaFixture();
  let calls = 0;
  const provider = oneShotProvider({
    async commandRunner() {
      calls += 1;
      throw new Error('must not execute');
    },
    async fetchImpl() { throw new Error('must not fetch'); },
  });
  const approved = {
    order: 1,
    scope: 'avatar',
    role: 'APPROVED_LOOK_MASTER',
    path: paths.avatar,
    sha256: MOCK_SHA256,
    mediaType: 'image/png',
    source: 'APPROVED_AVATAR',
  };
  const repair = {
    order: 2,
    scope: 'scene',
    role: 'FAILED_SCENE_CANDIDATE',
    path: paths.outfit,
    sha256: MOCK_SHA256,
    mediaType: 'image/png',
    source: 'REPAIR_CANDIDATE',
  };
  const cases = [
    [approved, { ...repair, source: 'CONDITIONED' }],
    [approved, {
      order: 2,
      scope: 'outfit',
      role: 'SCENE_ENVIRONMENT_ANCHOR',
      path: paths.identity,
      sha256: MOCK_SHA256,
      mediaType: 'image/png',
      source: 'CONDITIONED',
    }, { ...repair, order: 3 }],
    [approved, repair, {
      ...repair,
      order: 3,
      path: paths.identity,
    }],
  ];
  for (const ordered of cases) {
    await assert.rejects(
      () => provider.generate({
        phase: 'scene',
        model: 'gpt_image_2',
        prompt: 'repair',
        references: { ordered },
      }),
      (error) => error.code === 'INVALID_SCENE_REPAIR_BINDING' && !error.retryable,
    );
  }
  assert.equal(calls, 0);
});

test('fails closed when an ordered reference pack is malformed', async () => {
  const paths = await mediaFixture();
  const provider = oneShotProvider({
    async commandRunner() { throw new Error('must not execute'); },
    async fetchImpl() { throw new Error('must not fetch'); },
  });
  await assert.rejects(
    () => provider.generate({
      phase: 'outfit', model: 'gpt_image_2', prompt: 'portrait',
      references: {
        ordered: [
          { order: 2, scope: 'identity', role: 'IDENTITY_PRIMARY', path: paths.identity },
          { order: 1, scope: 'avatar', role: 'APPROVED_AVATAR', path: paths.avatar },
        ],
      },
    }),
    (error) => error.code === 'INVALID_ORDERED_REFERENCES' && !error.retryable,
  );
});

test('verifies conditioned reference bytes against the declared sha256 before CLI execution', async () => {
  const paths = await mediaFixture();
  let called = false;
  const provider = oneShotProvider({
    async commandRunner() { called = true; },
    async fetchImpl() { throw new Error('must not fetch'); },
  });
  await assert.rejects(
    () => provider.generate({
      phase: 'avatar', model: 'gpt_image_2', prompt: 'portrait',
      references: {
        ordered: [{
          order: 1,
          scope: 'identity',
          role: 'IDENTITY_PRIMARY',
          path: paths.identity,
          sha256: '0'.repeat(64),
          mediaType: 'image/png',
          source: 'CONDITIONED',
        }],
      },
    }),
    (error) => error.code === 'REFERENCE_DIGEST_MISMATCH' && !error.retryable,
  );
  assert.equal(called, false);
});

test('rejects a non-allowlisted model before starting a command', async () => {
  const paths = await mediaFixture();
  let called = false;
  const provider = oneShotProvider({
    async commandRunner() {
      called = true;
    },
    async fetchImpl() {
      throw new Error('unreachable');
    },
  });
  await assert.rejects(
    () => provider.generate({
      phase: 'avatar',
      model: 'runway',
      prompt: 'portrait',
      references: { identity: { artifact: { path: paths.identity } } },
    }),
    (error) => error instanceof HiggsfieldProviderError && error.code === 'MODEL_NOT_ALLOWLISTED' && !error.retryable,
  );
  assert.equal(called, false);
});

test('fails closed on malformed, incomplete, or model-mismatched CLI output', async (t) => {
  const paths = await mediaFixture();
  const cases = [
    ['not-json', 'INVALID_CLI_RESPONSE'],
    [JSON.stringify([]), 'INVALID_CLI_RESPONSE'],
    [JSON.stringify([completedJob('gpt_image_2'), completedJob('gpt_image_2')]), 'INVALID_CLI_RESPONSE'],
    [JSON.stringify(completedJob('gpt_image_2', { status: 'failed' })), 'JOB_NOT_COMPLETED'],
    [JSON.stringify(completedJob('nano_banana_flash')), 'MODEL_RESPONSE_MISMATCH'],
    [JSON.stringify(completedJob('gpt_image_2', { result_url: null })), 'MISSING_RESULT_URL'],
  ];
  for (const [stdout, code] of cases) {
    await t.test(code, async () => {
      const provider = oneShotProvider({
        async commandRunner() { return { stdout, exitCode: 0 }; },
        async fetchImpl() { throw new Error('must not download'); },
      });
      await assert.rejects(
        () => provider.generate({
          phase: 'avatar',
          model: 'gpt_image_2',
          prompt: 'portrait',
          references: { identity: { artifact: { path: paths.identity } } },
        }),
        (error) => error.code === code,
      );
    });
  }
});

test('accepts the live CLI one-element JSON array response shape', async () => {
  const paths = await mediaFixture();
  const provider = oneShotProvider({
    async commandRunner() {
      return { stdout: JSON.stringify([completedJob('gpt_image_2')]), exitCode: 0 };
    },
    async fetchImpl() { return pngResponse(); },
  });
  const response = await provider.generate({
    phase: 'avatar', model: 'gpt_image_2', prompt: 'portrait',
    references: { identity: { artifact: { path: paths.identity, digest: MOCK_SHA256 } } },
  });
  assert.equal(response.metadata.job_id, 'job-123');
  assert.equal(response.metadata.job_set_type, 'gpt_image_2');
});

test('an unconfirmed create never claims that a provider job exists or auto-retries it', async () => {
  const paths = await mediaFixture();
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'zeely-higgsfield-unconfirmed-create-'));
  let createCalls = 0;
  const provider = new HiggsfieldCliProvider({
    async commandRunner() {
      createCalls += 1;
      return { stdout: '', exitCode: 1 };
    },
    async fetchImpl() { throw new Error('must not download'); },
  });
  await assert.rejects(
    () => provider.generate({
      phase: 'avatar', attempt: 1, model: 'gpt_image_2', job_set_type: 'gpt_image_2',
      prompt: 'portrait', idempotencyKey: 'e'.repeat(64), jobId: 'unconfirmed-create', workDirectory,
      references: { identity: { artifact: { path: paths.identity, digest: MOCK_SHA256 } } },
    }),
    (error) => error.code === 'CREATE_NOT_CONFIRMED'
      && !error.retryable
      && error.message === 'Higgsfield generation was not confirmed; it was not retried automatically',
  );
  assert.equal(createCalls, 1);
});

test('rejects untrusted result URLs and non-PNG responses', async (t) => {
  const paths = await mediaFixture();
  await t.test('untrusted URL', async () => {
    let fetched = false;
    const provider = oneShotProvider({
      async commandRunner() {
        return { stdout: JSON.stringify(completedJob('gpt_image_2', { result_url: 'https://example.com/x.png' })) };
      },
      async fetchImpl() { fetched = true; },
    });
    await assert.rejects(
      () => provider.generate({
        phase: 'avatar', model: 'gpt_image_2', prompt: 'portrait',
        references: { identity: { artifact: { path: paths.identity } } },
      }),
      (error) => error.code === 'UNTRUSTED_RESULT_URL' && !error.retryable,
    );
    assert.equal(fetched, false);
  });

  await t.test('bad PNG signature', async () => {
    const bytes = Buffer.from('not-a-png');
    const provider = oneShotProvider({
      async commandRunner() { return { stdout: JSON.stringify(completedJob('gpt_image_2')) }; },
      async fetchImpl() { return pngResponse(bytes); },
    });
    await assert.rejects(
      () => provider.generate({
        phase: 'avatar', model: 'gpt_image_2', prompt: 'portrait',
        references: { identity: { artifact: { path: paths.identity } } },
      }),
      (error) => error.code === 'INVALID_RESULT_PNG' && !error.retryable,
    );
  });
});

test('transient wait failure re-polls the same provider job without routing a duplicate generation', async () => {
  const paths = await mediaFixture();
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'zeely-higgsfield-repoll-'));
  let waitCalls = 0;
  let createCalls = 0;
  const provider = new HiggsfieldCliProvider({
    commandRunner: async (binary, args) => {
      if (args[1] === 'create') { createCalls += 1; return { stdout: JSON.stringify(['provider-job-repoll']), exitCode: 0 }; }
      if (args[1] === 'wait') {
        waitCalls += 1;
        if (waitCalls === 1) throw new Error('transient upstream 502');
        return { stdout: JSON.stringify(completedJob('gpt_image_2', { id: 'provider-job-repoll' })), exitCode: 0 };
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
    async fetchImpl() { return pngResponse(); },
  });
  const response = await provider.generate({
    phase: 'avatar', attempt: 1, model: 'gpt_image_2', job_set_type: 'gpt_image_2',
    prompt: 'retry the wait, never the create', idempotencyKey: 'd'.repeat(64), jobId: 'user-repoll', workDirectory,
    references: { identity: { artifact: { path: paths.identity, digest: MOCK_SHA256 } } },
  });
  assert.equal(response.metadata.job_id, 'provider-job-repoll');
  assert.equal(createCalls, 1);
  assert.equal(waitCalls, 2);
});

test('journals create before wait and resumes the same provider job without a second create', async () => {
  const paths = await mediaFixture();
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'zeely-higgsfield-run-'));
  const idempotencyKey = 'a'.repeat(64);
  const calls = [];
  let failFirstWait = true;
  const commandRunner = async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (args[0] === 'generate' && args[1] === 'create') {
      return { stdout: JSON.stringify(['provider-job-123']), exitCode: 0 };
    }
    if (args[0] === 'generate' && args[1] === 'wait') {
      if (failFirstWait) {
        failFirstWait = false;
        throw new Error('simulated crash immediately before remote wait');
      }
      return {
        stdout: JSON.stringify(completedJob('gpt_image_2', { id: 'provider-job-123' })),
        exitCode: 0,
      };
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  const context = {
    phase: 'avatar',
    attempt: 1,
    model: 'gpt_image_2',
    job_set_type: 'gpt_image_2',
    prompt: 'journaled portrait',
    idempotencyKey,
    jobId: 'user-001',
    workDirectory,
    references: { identity: { artifact: { path: paths.identity, digest: MOCK_SHA256 } } },
  };

  const firstProvider = new HiggsfieldCliProvider({
    commandRunner,
    waitCommandAttempts: 1,
    async fetchImpl() { throw new Error('first attempt must not download'); },
    clock: () => new Date('2026-07-22T01:00:00.000Z'),
  });
  await assert.rejects(
    () => firstProvider.generate(context),
    (error) => error.code === 'CLI_EXECUTION_FAILED' && error.retryable,
  );

  const journalPath = path.join(workDirectory, 'provider-jobs', `${idempotencyKey}.json`);
  const afterCrash = JSON.parse(await readFile(journalPath, 'utf8'));
  assert.equal(path.basename(journalPath), `${idempotencyKey}.json`);
  assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
  assert.equal(afterCrash.provider_job_id, 'provider-job-123');
  assert.equal(afterCrash.state, 'WAIT_FAILED');
  assert.deepEqual(afterCrash.events.map((event) => event.type), ['CREATED', 'WAIT_STARTED', 'WAIT_FAILED']);

  const resumedProvider = new HiggsfieldCliProvider({
    commandRunner,
    async fetchImpl() { return pngResponse(); },
    clock: () => new Date('2026-07-22T01:01:00.000Z'),
  });
  const response = await resumedProvider.generate(context);

  assert.equal(calls.filter((call) => call.args[1] === 'create').length, 1);
  assert.equal(calls.filter((call) => call.args[1] === 'wait').length, 2);
  assert.deepEqual(calls[0].args.slice(-2), ['--json', '--no-color']);
  assert.equal(calls[0].args.includes('--wait'), false);
  assert.deepEqual(calls[2].args, [
    'generate', 'wait', 'provider-job-123',
    '--timeout', '20m', '--interval', '3s', '--json', '--no-color',
  ]);
  assert.equal(response.metadata.generation_mode, 'journaled');
  assert.equal(response.metadata.provider_journal.resumed, true);
  assert.equal(response.metadata.provider_journal.state, 'OUTPUT_DOWNLOADED');

  const completedJournal = JSON.parse(await readFile(journalPath, 'utf8'));
  assert.equal(completedJournal.output.sha256, MOCK_SHA256);
  assert.deepEqual(completedJournal.events.map((event) => event.type), [
    'CREATED', 'WAIT_STARTED', 'WAIT_FAILED', 'WAIT_STARTED', 'COMPLETED', 'OUTPUT_DOWNLOADED',
  ]);

  // Simulate a hard process stop after the completed job was journaled but
  // before the output body was persisted.
  completedJournal.state = 'COMPLETED';
  completedJournal.events = completedJournal.events.filter((event) => event.type !== 'OUTPUT_DOWNLOADED');
  delete completedJournal.output;
  await writeFile(journalPath, `${JSON.stringify(completedJournal, null, 2)}\n`);

  let unexpectedCommands = 0;
  const completedProvider = new HiggsfieldCliProvider({
    async commandRunner() { unexpectedCommands += 1; throw new Error('must reuse completed journal'); },
    async fetchImpl() { return pngResponse(); },
  });
  const completedResponse = await completedProvider.generate(context);
  assert.equal(unexpectedCommands, 0, 'completed journal must skip both create and wait');
  assert.equal(completedResponse.metadata.provider_journal.resumed, true);
});

test('fails closed on malformed two-phase create job-id arrays', async (t) => {
  const paths = await mediaFixture();
  const cases = [
    'not-json',
    JSON.stringify({ id: 'job-1' }),
    JSON.stringify([]),
    JSON.stringify(['job-1', 'job-2']),
    JSON.stringify([completedJob('gpt_image_2')]),
    JSON.stringify(['unsafe job id']),
  ];
  for (const [index, stdout] of cases.entries()) {
    await t.test(`case-${index + 1}`, async () => {
      const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'zeely-higgsfield-invalid-create-'));
      let commands = 0;
      const provider = new HiggsfieldCliProvider({
        async commandRunner() {
          commands += 1;
          return { stdout, exitCode: 0 };
        },
        async fetchImpl() { throw new Error('must not download'); },
      });
      await assert.rejects(
        () => provider.generate({
          phase: 'avatar',
          model: 'gpt_image_2',
          prompt: 'portrait',
          idempotencyKey: String(index + 1).repeat(64),
          workDirectory,
          references: { identity: { artifact: { path: paths.identity, digest: MOCK_SHA256 } } },
        }),
        (error) => error.code === 'INVALID_CREATE_RESPONSE' && !error.retryable,
      );
      assert.equal(commands, 1, 'malformed create response must never reach wait');
    });
  }
});

test('conditioning is an explicit validated pass-through for prepared media and text', async () => {
  const paths = await mediaFixture();
  const provider = oneShotProvider({
    async commandRunner() { throw new Error('unreachable'); },
    async fetchImpl() { throw new Error('unreachable'); },
  });
  const image = await provider.condition({
    role: 'identity',
    source: { path: paths.identity, mediaType: 'image/png' },
  });
  assert.equal(image.reference.path, paths.identity);
  assert.equal(image.facts.conditioning_mode, 'preconditioned_passthrough');
  assert.deepEqual(image.risks, ['READINESS_MUST_BE_CONFIRMED_BY_CONDITIONING_QA']);

  const text = await provider.condition({ role: 'outfit', source: { text: 'navy blazer' } });
  assert.equal(text.reference, undefined);
  assert.equal(text.facts.conditioning_mode, 'text_passthrough');
});

test('QA never auto-passes and accepts only an explicit valid evaluator result', async () => {
  const closed = new HiggsfieldCliProvider();
  const closedResult = await closed.qa({ phase: 'conditioning' });
  assert.equal(closedResult.decision, 'NEEDS_INPUT');
  assert.equal(closedResult.evaluator.type, 'ADAPTER');
  assert.match(closedResult.evaluator.evaluation_id, /^[a-f0-9]{64}$/);

  const configured = new HiggsfieldCliProvider({
    qaEvaluator: async (context) => ({
      decision: 'PASS',
      reason: 'Every blocking visible criterion passed',
      checks: [{
        name: context.phase,
        pass: true,
        score: 0.99,
        evidence: 'Visible evidence matches the locked references',
      }],
      defects: [],
      evaluator: {
        type: 'MODEL',
        provider: 'openai-codex-cli',
        model: 'gpt-5.6-terra',
        version: 'gpt-5.6-terra',
        evaluation_id: 'a'.repeat(64),
      },
    }),
  });
  assert.equal((await configured.qa({ phase: 'avatar' })).decision, 'PASS');

  const invalid = new HiggsfieldCliProvider({ qaEvaluator: async () => ({ decision: 'YES' }) });
  await assert.rejects(() => invalid.qa({}), (error) => error.code === 'INVALID_QA_DECISION');

  const unattested = new HiggsfieldCliProvider({
    qaEvaluator: async () => ({
      decision: 'PASS',
      reason: 'claimed pass',
      checks: [{
        name: 'IDENTITY',
        pass: true,
        score: 1,
        evidence: 'claimed visible match',
      }],
      defects: [],
    }),
  });
  await assert.rejects(
    () => unattested.qa({ phase: 'avatar' }),
    (error) => error.code === 'INVALID_QA_EVALUATOR_ATTESTATION',
  );
});
