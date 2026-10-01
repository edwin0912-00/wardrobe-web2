import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { createFalClient } from '@fal-ai/client';
import { FalImagegenProvider, FAL_IMAGEGEN_ENDPOINT } from '../../src/providers/fal-imagegen-provider.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const key = 'b'.repeat(64);

async function fixture(count = 6) {
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'fal-imagegen-'));
  const image = await sharp({ create: { width: 16, height: 20, channels: 3, background: '#56789a' } }).png().toBuffer();
  const references = [];
  for (let index = 0; index < count; index += 1) {
    const filename = path.join(workDirectory, `reference-${index + 1}.png`);
    await writeFile(filename, image);
    references.push({
      order: index + 1,
      scope: index === 0 ? 'avatar' : 'outfit',
      role: index === 0 ? 'APPROVED_AVATAR' : `ITEM_${index}`,
      path: filename,
      sha256: sha256(image),
      mediaType: 'image/png',
      source: index === 0 ? 'APPROVED_AVATAR' : 'CONDITIONED',
    });
  }
  const context = {
    phase: 'outfit',
    attempt: 1,
    model: 'gpt_image_2',
    job_set_type: 'gpt_image_2',
    prompt: 'Generate the outfit while preserving every supplied item reference.',
    idempotencyKey: key,
    jobId: 'outfit-test',
    workDirectory,
    aspectRatio: '3:4',
    resolution: '1K',
    quality: 'high',
    width: 768,
    height: 1024,
    references: { ordered: references },
  };
  return { workDirectory, context, image, references, cleanup: () => rm(workDirectory, { recursive: true, force: true }) };
}

function mockClient(image, observations = {}) {
  let uploadNumber = 0;
  return {
    storage: {
      async upload(file) {
        const bytes = Buffer.from(await file.arrayBuffer());
        observations.uploads ??= [];
        observations.uploads.push({ name: file.name, type: file.type, bytes });
        uploadNumber += 1;
        return `https://v3b.fal.media/files/reference-${uploadNumber}.png`;
      },
    },
    queue: {
      async submit(endpoint, options) {
        observations.submitCount = (observations.submitCount ?? 0) + 1;
        observations.endpoint = endpoint;
        observations.input = options.input;
        observations.inputs ??= [];
        observations.inputs.push(options.input);
        return { request_id: 'fal-request-1' };
      },
      async status(endpoint, options) {
        observations.statusCalls = (observations.statusCalls ?? 0) + 1;
        observations.requestId = options.requestId;
        return { status: 'COMPLETED' };
      },
      async result(endpoint, options) {
        observations.resultRequestId = options.requestId;
        return { requestId: options.requestId, data: { images: [{ url: 'https://v3b.fal.media/files/output.png' }] } };
      },
    },
    outputImage: image,
  };
}

test('Sunburst uploads every hash-bound reference and returns the journaled PNG contract', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const seen = {};
  const client = mockClient(f.image, seen);
  const provider = new FalImagegenProvider({ client, fetchImpl: async () => new Response(f.image) });

  const result = await provider.generate(f.context);

  assert.equal(seen.endpoint, FAL_IMAGEGEN_ENDPOINT);
  assert.equal(seen.uploads.length, 6);
  assert.deepEqual(seen.uploads.map((item) => item.bytes), Array(6).fill(f.image));
  assert.deepEqual(seen.input.image_urls, seen.uploads.map((_, index) => `https://v3b.fal.media/files/reference-${index + 1}.png`));
  assert.equal(seen.input.image_size.width, 768);
  assert.equal(seen.input.image_size.height, 1024);
  assert.equal(seen.input.quality, 'high');
  assert.equal(seen.input.output_format, 'png');
  assert.equal(result.image.toString('hex'), f.image.toString('hex'));
  assert.equal(result.metadata.provider_request_id, 'fal-request-1');
  assert.equal(result.metadata.input_media.length, 6);
  assert.equal(result.metadata.provider_journal.state, 'OUTPUT_STORED');

  const replay = await provider.generate(f.context);
  assert.equal(replay.metadata.provider_journal.resumed, true);
  assert.equal(seen.submitCount, 1);
  assert.equal(seen.uploads.length, 6);

  const second = await provider.generate({ ...f.context, idempotencyKey: 'c'.repeat(64), jobId: 'outfit-test-2' });
  assert.equal(second.metadata.idempotency_key, 'c'.repeat(64));
  assert.equal(seen.submitCount, 2);
  assert.equal(seen.uploads.length, 12);
});

test('a bad reference hash is rejected before any local file is uploaded', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const seen = {};
  const provider = new FalImagegenProvider({ client: mockClient(f.image, seen), fetchImpl: async () => new Response(f.image) });
  const corrupted = { ...f.context, references: { ordered: f.references.map((item) => ({ ...item })) } };
  corrupted.references.ordered[3].sha256 = '0'.repeat(64);

  await assert.rejects(
    () => provider.generate(corrupted),
    (error) => error.code === 'REFERENCE_HASH_MISMATCH',
  );
  assert.equal(seen.uploads, undefined);
  assert.equal(seen.submitCount, undefined);
});

test('private prompts are rejected before FAL storage upload', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const seen = {};
  const provider = new FalImagegenProvider({ client: mockClient(f.image, seen), fetchImpl: async () => new Response(f.image) });

  await assert.rejects(
    () => provider.generate({ ...f.context, prompt: `Use this local file ${f.workDirectory}/secret.png` }),
    (error) => error.code === 'UNSAFE_PROVIDER_PROMPT',
  );
  assert.equal(seen.uploads, undefined);
  assert.equal(seen.submitCount, undefined);
});

test('FAL credentials configure a per-provider SDK instance', async (t) => {
  const f = await fixture(1);
  t.after(f.cleanup);
  let config;
  const provider = new FalImagegenProvider({
    credentials: 'server-only-test-key',
    clientFactory: (options) => {
      config = options;
      return mockClient(f.image);
    },
    fetchImpl: async () => new Response(f.image),
  });

  assert.equal(config.credentials, 'server-only-test-key');
  assert.equal(typeof config.fetch, 'function');
  assert.equal(provider.client.queue !== undefined, true);
});

test('Sunburst preserves the real nine-binding scene manifest with guide then approved look', async (t) => {
  const f = await fixture(9);
  t.after(f.cleanup);
  const seen = {};
  const provider = new FalImagegenProvider({ client: mockClient(f.image, seen), fetchImpl: async () => new Response(f.image) });
  const ordered = f.references.map((item, index) => ({
    ...item,
    scope: index === 0 ? 'outfit' : index === 1 ? 'avatar' : index === 2 ? 'scene' : 'outfit',
    role: index === 0 ? 'MECHANICAL_FRAMING_GUIDE' : index === 1 ? 'APPROVED_LOOK_MASTER' : index === 2 ? 'FAILED_SCENE_CANDIDATE' : `ITEM_${index}`,
    source: index === 0 || index > 2 ? 'CONDITIONED' : index === 1 ? 'APPROVED_AVATAR' : 'REPAIR_CANDIDATE',
  }));
  const context = { ...f.context, phase: 'scene', references: { ordered } };

  const result = await provider.generate(context);

  assert.equal(seen.input.image_urls.length, 9);
  assert.deepEqual(result.metadata.input_media.map((item) => item.role), ordered.map((item) => item.role));
  assert.equal(result.metadata.input_media[0].scope, 'outfit');
  assert.equal(result.metadata.input_media[1].scope, 'avatar');

  const malformed = { ...context, idempotencyKey: 'd'.repeat(64), references: { ordered: ordered.map((item) => ({ ...item })) } };
  malformed.references.ordered[0].scope = 'avatar';
  await assert.rejects(() => provider.generate(malformed), (error) => error.code === 'INVALID_SCENE_REFERENCE_ORDER');
  assert.equal(seen.submitCount, 1);
});

test('Sunburst maps the saved quality ladder to the matching FAL quality and bounded dimensions', async (t) => {
  const f = await fixture(1);
  t.after(f.cleanup);
  const seen = {};
  const provider = new FalImagegenProvider({ client: mockClient(f.image, seen), fetchImpl: async () => new Response(f.image) });
  const profiles = [
    { id: 'gpt_image_2.low_1k.initial', resolution: '1k', quality: 'low', width: 768, height: 1024 },
    { id: 'gpt_image_2.medium_2k.escalation', resolution: '2k', quality: 'medium', width: 1536, height: 2048 },
    { id: 'gpt_image_2.high_4k.final', resolution: '4k', quality: 'high', width: 2880, height: 3840 },
  ];
  const results = [];

  for (const [index, profile] of profiles.entries()) {
    results.push(await provider.generate({
      ...f.context,
      idempotencyKey: `${(index + 1).toString(16)}`.repeat(64),
      width: undefined,
      height: undefined,
      quality: undefined,
      resolution: profile.resolution,
      generation_profile: profile,
    }));
  }

  assert.deepEqual(seen.inputs.map((input) => ({ quality: input.quality, size: input.image_size })), profiles.map((profile) => ({
    quality: profile.quality,
    size: { width: profile.width, height: profile.height },
  })));
  assert.deepEqual(results.map((result) => ({
    resolution: result.metadata.resolution,
    quality: result.metadata.quality,
    image_size: result.metadata.image_size,
  })), profiles.map((profile) => ({
    resolution: profile.resolution,
    quality: profile.quality,
    image_size: { width: profile.width, height: profile.height },
  })));
});

test('same-key in-flight changes to quality or image size are rejected', async (t) => {
  const f = await fixture(1);
  t.after(f.cleanup);
  let releaseSubmit;
  const held = new Promise((resolve) => { releaseSubmit = resolve; });
  const client = mockClient(f.image);
  const submit = client.queue.submit;
  client.queue.submit = async (...args) => { await held; return submit(...args); };
  const provider = new FalImagegenProvider({ client, fetchImpl: async () => new Response(f.image) });
  const first = provider.generate(f.context);

  await assert.rejects(
    () => provider.generate({ ...f.context, quality: 'low', width: 512, height: 768 }),
    (error) => error.code === 'PROVIDER_JOURNAL_CONFLICT',
  );
  releaseSubmit();
  await first;
});

test('an unknown submit response is never retried as another paid FAL request', async (t) => {
  const f = await fixture(1);
  t.after(f.cleanup);
  const output = f.image;
  let paidRequests = 0;
  const provider = new FalImagegenProvider({
    credentials: 'server-only-test-key',
    timeoutMs: 100,
    fetchImpl: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === 'queue.fal.run' && init.method === 'POST') {
        paidRequests += 1;
        throw new TypeError('connection reset after the submit may have reached FAL');
      }
      throw new Error(`unexpected request ${url}`);
    },
    clientFactory: (options) => {
      const client = createFalClient(options);
      client.storage.upload = async () => 'https://v3b.fal.media/files/reference.png';
      return client;
    },
  });

  await assert.rejects(
    () => provider.generate(f.context),
    (error) => error.code === 'GENERATION_OUTCOME_UNKNOWN',
  );
  await assert.rejects(
    () => provider.generate(f.context),
    (error) => error.code === 'PRIOR_OUTCOME_UNKNOWN',
  );
  assert.equal(paidRequests, 1);
  const journal = JSON.parse(await readFile(path.join(f.workDirectory, 'provider-jobs', `fal-imagegen-${key}.json`), 'utf8'));
  assert.equal(journal.state, 'FAILED_OUTCOME_UNKNOWN');
  assert.equal(journal.provider_request_id, null);
  assert.equal(output.length > 24, true);
});

test('a known FAL request id is polled again after a transient wait failure without resubmission', async (t) => {
  const f = await fixture(1);
  t.after(f.cleanup);
  let paidRequests = 0;
  let statusCalls = 0;
  let resultCalls = 0;
  const provider = new FalImagegenProvider({
    credentials: 'server-only-test-key',
    timeoutMs: 1000,
    pollIntervalMs: 1,
    fetchImpl: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === 'queue.fal.run' && init.method === 'POST') {
        paidRequests += 1;
        return Response.json({ request_id: 'fal-request-known' });
      }
      if (url.hostname === 'queue.fal.run' && url.pathname.endsWith('/status')) {
        statusCalls += 1;
        if (statusCalls === 1) throw new Error('Controlled status-read failure');
        return Response.json({ status: 'COMPLETED' });
      }
      if (url.hostname === 'queue.fal.run' && init.method === 'GET') {
        resultCalls += 1;
        return Response.json({ images: [{ url: 'https://v3b.fal.media/files/output.png' }] });
      }
      if (url.hostname === 'v3b.fal.media') return new Response(f.image);
      throw new Error(`unexpected request ${url}`);
    },
    clientFactory: (options) => {
      const client = createFalClient(options);
      client.storage.upload = async () => 'https://v3b.fal.media/files/reference.png';
      return client;
    },
  });

  await assert.rejects(
    () => provider.generate(f.context),
    (error) => error.code === 'GENERATION_OUTCOME_UNKNOWN',
  );
  const resumed = await provider.generate(f.context);

  assert.equal(paidRequests, 1);
  assert.equal(resumed.metadata.provider_request_id, 'fal-request-known');
  assert.equal(resumed.metadata.provider_journal.resumed, true);
  assert.equal(resultCalls, 1);
});

test('one SDK instance accepts two independent safe generation jobs', async (t) => {
  const f = await fixture(1);
  t.after(f.cleanup);
  let paidRequests = 0;
  const provider = new FalImagegenProvider({
    credentials: 'server-only-test-key',
    fetchImpl: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === 'queue.fal.run' && init.method === 'POST') {
        paidRequests += 1;
        return Response.json({ request_id: `fal-request-${paidRequests}` });
      }
      if (url.hostname === 'queue.fal.run' && url.pathname.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
      if (url.hostname === 'queue.fal.run' && init.method === 'GET') {
        return Response.json({ images: [{ url: 'https://v3b.fal.media/files/output.png' }] });
      }
      if (url.hostname === 'v3b.fal.media') return new Response(f.image);
      throw new Error(`unexpected request ${url}`);
    },
    clientFactory: (options) => {
      const client = createFalClient(options);
      client.storage.upload = async () => 'https://v3b.fal.media/files/reference.png';
      return client;
    },
  });

  const first = await provider.generate(f.context);
  const second = await provider.generate({ ...f.context, idempotencyKey: 'e'.repeat(64), jobId: 'outfit-test-2' });

  assert.equal(paidRequests, 2);
  assert.equal(first.metadata.provider_request_id, 'fal-request-1');
  assert.equal(second.metadata.provider_request_id, 'fal-request-2');
});
