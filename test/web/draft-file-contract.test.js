import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  finalizationFileManifest,
  reconcileDraftFileBindings,
} from '../../web/public/draft-file-contract.js';

const PNG = 'image/png';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function file(name) {
  return {
    name,
    async arrayBuffer() { return new ArrayBuffer(1); },
  };
}

function local(name, sha256, size = 10) {
  return { file: file(name), sourceName: name, sha256, size, mimetype: PNG };
}

function remote(id, sha256, size = 10) {
  return { id, sha256, size, mimetype: PNG };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function sourceRegion(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('same-count different files replace the mismatched ordered suffix', async () => {
  const oldId = '11111111-1111-4111-8111-111111111111';
  const newId = '22222222-2222-4222-8222-222222222222';
  const events = [];
  const result = await reconcileDraftFileBindings({
    desired: { person: null, identity: null, garments: [local('new.png', SHA_B)] },
    current: { person: null, identity: null, garments: [remote(oldId, SHA_A)] },
    remove: async (slot, id) => { events.push(`remove:${slot}:${id}`); },
    upload: async (slot, desired) => {
      events.push(`upload:${slot}:${desired.sha256}`);
      return remote(newId, desired.sha256, desired.size);
    },
  });

  assert.deepEqual(events, [
    `remove:garment:${oldId}`,
    `upload:garment:${SHA_B}`,
  ]);
  assert.deepEqual(result.garments, [remote(newId, SHA_B)]);
  assert.deepEqual(finalizationFileManifest(result).garments.map((item) => item.sha256), [SHA_B]);
});

test('failed removal aborts reconciliation without inventing a successful binding', async () => {
  const oldId = '11111111-1111-4111-8111-111111111111';
  const current = { person: null, identity: null, garments: [remote(oldId, SHA_A)] };
  let uploads = 0;

  await assert.rejects(
    () => reconcileDraftFileBindings({
      desired: { person: null, identity: null, garments: [] },
      current,
      remove: async () => { throw new Error('DELETE 503'); },
      upload: async () => { uploads += 1; },
    }),
    /DELETE 503/,
  );

  assert.equal(uploads, 0);
  assert.deepEqual(current.garments, [remote(oldId, SHA_A)], 'caller snapshot must remain server truth until a confirmed reload');
});

test('ordered hashes are part of the finalization contract even when counts match', () => {
  const first = remote('11111111-1111-4111-8111-111111111111', SHA_A);
  const second = remote('22222222-2222-4222-8222-222222222222', SHA_B);
  assert.notDeepEqual(
    finalizationFileManifest({ person: null, identity: null, garments: [first, second] }),
    finalizationFileManifest({ person: null, identity: null, garments: [second, first] }),
  );
});

test('desired A,B,C,D removes only a duplicate D suffix from remote A,B,C,D,D', async () => {
  const desired = [
    local('a.png', SHA_A),
    local('b.png', SHA_B),
    local('c.png', SHA_C),
    local('d.png', SHA_D),
  ];
  const current = [
    remote('00000000-0000-4000-8000-00000000000a', SHA_A),
    remote('00000000-0000-4000-8000-00000000000b', SHA_B),
    remote('00000000-0000-4000-8000-00000000000c', SHA_C),
    remote('00000000-0000-4000-8000-00000000000d', SHA_D),
    remote('00000000-0000-4000-8000-0000000000dd', SHA_D),
  ];
  const removed = [];
  let uploads = 0;

  const result = await reconcileDraftFileBindings({
    desired: { person: null, identity: null, garments: desired },
    current: { person: null, identity: null, garments: current },
    remove: async (slot, id) => removed.push({ slot, id }),
    upload: async () => {
      uploads += 1;
      throw new Error('an exact prefix must not be uploaded again');
    },
  });

  assert.deepEqual(removed, [{
    slot: 'garment',
    id: '00000000-0000-4000-8000-0000000000dd',
  }]);
  assert.equal(uploads, 0);
  assert.deepEqual(
    result.garments.map((item) => item.sha256),
    [SHA_A, SHA_B, SHA_C, SHA_D],
  );
  assert.deepEqual(
    result.garments.map((item) => item.id),
    current.slice(0, 4).map((item) => item.id),
  );
});

test('finalization waits for an overlapping background reconciliation and cannot append D twice', async () => {
  const desired = {
    person: null,
    identity: null,
    garments: [
      local('a.png', SHA_A),
      local('b.png', SHA_B),
      local('c.png', SHA_C),
      local('d.png', SHA_D),
    ],
  };
  let remoteGarments = [
    remote('00000000-0000-4000-8000-00000000000a', SHA_A),
    remote('00000000-0000-4000-8000-00000000000b', SHA_B),
    remote('00000000-0000-4000-8000-00000000000c', SHA_C),
  ];
  const uploadStarted = deferred();
  const permitUpload = deferred();
  let uploadCount = 0;

  const snapshot = () => ({
    person: null,
    identity: null,
    garments: remoteGarments.map((item) => ({ ...item })),
  });
  const reconcileRemote = async () => {
    const result = await reconcileDraftFileBindings({
      desired,
      current: snapshot(),
      remove: async (_slot, id) => {
        remoteGarments = remoteGarments.filter((item) => item.id !== id);
      },
      upload: async (_slot, wanted) => {
        uploadCount += 1;
        uploadStarted.resolve();
        await permitUpload.promise;
        const uploaded = remote(
          `00000000-0000-4000-8000-${String(uploadCount).padStart(12, '0')}`,
          wanted.sha256,
          wanted.size,
        );
        remoteGarments.push(uploaded);
        return uploaded;
      },
    });
    return result;
  };

  let serverSyncQueue = Promise.resolve();
  const background = serverSyncQueue = serverSyncQueue.then(reconcileRemote);
  await uploadStarted.promise;

  let finalizationStarted = false;
  const finalization = (async () => {
    await serverSyncQueue;
    finalizationStarted = true;
    return reconcileRemote();
  })();
  await Promise.resolve();
  assert.equal(finalizationStarted, false, 'finalization must remain behind the active server-sync barrier');

  permitUpload.resolve();
  await background;
  const confirmed = await finalization;

  assert.equal(uploadCount, 1);
  assert.deepEqual(
    remoteGarments.map((item) => item.sha256),
    [SHA_A, SHA_B, SHA_C, SHA_D],
  );
  assert.deepEqual(
    confirmed.garments.map((item) => item.sha256),
    [SHA_A, SHA_B, SHA_C, SHA_D],
  );
});

test('file-change wiring registers the mutation barrier before local persistence and submit awaits it', async () => {
  const source = await readFile(
    new URL('../../web/public/app.js', import.meta.url),
    'utf8',
  );
  const changeWiring = sourceRegion(
    source,
    "document.querySelector('#person-photo').addEventListener('change'",
    "form.elements.outfit_text.addEventListener('input'",
  );
  const queueHelper = sourceRegion(
    source,
    'function queueSelectedFiles',
    "document.querySelector('#person-photo').addEventListener('change'",
  );
  assert.match(
    queueHelper,
    /queueDraftMutation\(\(\) => handleSelected\(kind, files\), stage\)/,
    'file picker and drag/drop must share the same synchronous mutation barrier',
  );
  for (const [selector, kind, stage] of [
    ['person-photo', 'person', 'select_person'],
    ['identity-detail', 'identity', 'select_identity'],
    ['garment-images', 'garment', 'select_item'],
  ]) {
    const eventRegion = sourceRegion(
      changeWiring,
      `document.querySelector('#${selector}').addEventListener('change'`,
      '\n});',
    );
    assert.match(eventRegion, /const files = \[\.\.\.event\.target\.files\];/);
    assert.match(eventRegion, /event\.target\.value = '';/);
    assert.match(
      eventRegion,
      new RegExp(`queueSelectedFiles\\('${kind}', files, '${stage}'\\)`),
      `${selector} must synchronously enqueue its full local-persist + server-sync mutation`,
    );
  }

  for (const [selector, kind, stage] of [
    ['#person-photo', 'person', 'select_person'],
    ['#identity-detail', 'identity', 'select_identity'],
    ['#garment-images', 'garment', 'select_item'],
  ]) {
    assert.match(
      changeWiring,
      new RegExp(`\\['${selector}', '${kind}', '${stage}'\\]`),
      `${selector} must bind drag/drop to the same field-specific mutation path`,
    );
  }

  const submit = sourceRegion(
    source,
    "form.addEventListener('submit'",
    "document.querySelector('#retry-run')",
  );
  const mutationBarrier = submit.indexOf('await draftMutationQueue;');
  const localPersistence = submit.indexOf("await persistDraft('submit_finalize');");
  const finalReconciliation = submit.indexOf('await ensureServerDraftComplete();');
  assert.ok(mutationBarrier >= 0, 'submit must await already-enqueued file mutations');
  assert.ok(localPersistence > mutationBarrier, 'submit snapshot must persist after the mutation barrier');
  assert.ok(finalReconciliation > localPersistence, 'server finalization must follow the persisted local snapshot');
  assert.ok(
    submit.indexOf('form.inert = true;') < mutationBarrier,
    'inputs must become inert before submit waits on the mutation barrier',
  );

  const finalizer = sourceRegion(
    source,
    'async function ensureServerDraftComplete()',
    '\nfunction fileLabel(',
  );
  assert.match(
    finalizer,
    /await queueServerSync\([\s\S]*reconcileServerDraftFiles\([\s\S]*\{ propagate: true \}/,
    'the final reconcile must join the same propagation-aware server queue',
  );
});
