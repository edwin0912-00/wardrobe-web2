import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { RunService } from '../../src/web/run-service.js';

async function upload(color = '#7b4d2e') {
  return { filename: 'input.png', mimetype: 'image/png', buffer: await sharp({ create: { width: 360, height: 480, channels: 3, background: color } }).png().toBuffer() };
}
async function canonical() {
  return sharp({ create: { width: 512, height: 640, channels: 3, background: '#ffffff' } }).composite([{ input: Buffer.from('<svg width="220" height="360"><rect width="220" height="360" rx="30" fill="#275b36"/></svg>'), left: 146, top: 140 }]).png().toBuffer();
}

function dependencies() {
  const vlm = {
    inspectGarments: async () => ({ status: 'READY', reason: 'clear garment', items: [{ source_index: 0, category: 'top', confidence: 0.95,
      observed: { garment_type: 'forest green hoodie', colors: ['forest green'], material: ['fleece'], pattern: [], logo_text: [], construction: ['hood', 'long sleeves'] }, unknowns: [], blockers: [] }] }),
    evaluateQa: async () => ({ decision: 'PASS', reason: 'all locks match', checks: [{ name: 'FIDELITY', pass: true, evidence: 'same visible garment' }], defects: [] }),
  };
  const assetGenerator = { generateGarment: async () => ({ image: await canonical(), metadata: { provider: 'mock' } }), generateScene: async () => ({ image: await canonical(), metadata: { provider: 'mock' } }) };
  return { provider: new MockProvider(), vlm, assetGenerator };
}

test('working core accepts a fresh user and garment upload and returns two downloadable outputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-web-run-'));
  const service = new RunService({ rootDirectory: root, ...dependencies() });
  await service.initialize();
  const created = await service.createRun({ person: await upload('#956b58'), garments: [await upload('#275b36')], outfitText: 'wear the approved item', generateScene: false });
  await service.running.get(created.run_id);
  const finished = await service.getRun(created.run_id);
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.phase, 'COMPLETED');
  assert.equal(finished.inner_state, null);
  assert.ok(finished.outputs.avatar);
  assert.ok(finished.outputs.avatar_outfit);
  assert.equal(finished.garments[0].category, 'top');
  assert.ok(await service.outputFile(created.run_id, 'avatar.png'));
  assert.ok(await service.outputFile(created.run_id, 'avatar_outfit.png'));
});

test('working core supports text-only outfit and rejects invalid uploads before generation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-web-text-'));
  const service = new RunService({ rootDirectory: root, ...dependencies() });
  await service.initialize();
  const created = await service.createRun({ person: await upload(), outfitText: 'cobalt blazer and white top', generateScene: false });
  await service.running.get(created.run_id);
  assert.equal((await service.getRun(created.run_id)).status, 'COMPLETED');
  await assert.rejects(() => service.createRun({ person: { filename: 'bad.png', mimetype: 'image/png', buffer: Buffer.from('bad') }, outfitText: 'black top' }), /decodable/);
});

test('slot conflicts become an explicit NEEDS_INPUT result', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-web-conflict-'));
  const deps = dependencies();
  deps.vlm.inspectGarments = async () => ({ status: 'READY', reason: 'two tops', items: [0, 1].map((source_index) => ({ source_index, category: 'top', confidence: 0.9,
    observed: { garment_type: 'top', colors: ['black'], material: [], pattern: [], logo_text: [], construction: [] }, unknowns: [], blockers: [] })) });
  const service = new RunService({ rootDirectory: root, ...deps });
  await service.initialize();
  const created = await service.createRun({ person: await upload(), garments: [await upload(), await upload()], generateScene: false });
  await service.running.get(created.run_id);
  const finished = await service.getRun(created.run_id);
  assert.equal(finished.status, 'NEEDS_INPUT');
  assert.equal(finished.conflicts[0].type, 'DUPLICATE_SLOT');
});

test('explicit duplicate-slot selection continues the same run with the chosen garment', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-web-selection-'));
  const deps = dependencies();
  let inspectionCount = 0;
  deps.vlm.inspectGarments = async () => {
    inspectionCount += 1;
    return ({
    status: 'READY', reason: 'two footwear options',
    items: [0, 1].map((source_index) => ({ source_index, category: 'footwear', confidence: 0.95,
      observed: { garment_type: source_index ? 'burgundy pumps' : 'brown boots', colors: [source_index ? 'burgundy' : 'brown'], material: [], pattern: [], logo_text: [], construction: [] }, unknowns: [], blockers: [] })),
    reference_sets: [0, 1].map((source_index) => ({ source_indexes: [source_index], primary_source_index: source_index, same_item_confidence: 1, evidence: ['single'] })),
    });
  };
  const service = new RunService({ rootDirectory: root, ...deps });
  await service.initialize();
  const created = await service.createRun({ person: await upload(), garments: [await upload('#6b3e2e'), await upload('#751d35')], generateScene: false });
  await service.running.get(created.run_id);
  assert.equal((await service.getRun(created.run_id)).status, 'NEEDS_INPUT');
  const resumed = await service.selectGarments(created.run_id, { footwear: 'set-1' });
  assert.equal(resumed.run_id, created.run_id);
  await service.running.get(created.run_id);
  const finished = await service.getRun(created.run_id);
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.garments.length, 1);
  assert.equal(finished.garments[0].observed.garment_type, 'burgundy pumps');
  assert.equal(inspectionCount, 1, 'the exact passport shown at the choice gate must be reused');
});

test('multiple views of the same garment are conditioned once with complete provenance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-web-multiview-'));
  const deps = dependencies();
  const generatorCalls = [];
  const qaCalls = [];
  deps.vlm.inspectGarments = async () => ({ status: 'READY', reason: 'same exact shirt', items: [0, 1].map((source_index) => ({
    source_index, category: 'top', confidence: 0.95 + source_index * 0.01,
    observed: { garment_type: 'blue pinstriped shirt', colors: ['blue', 'white'], material: ['woven cotton'], pattern: ['pinstripe'], logo_text: [], construction: ['point collar', 'white buttons'] },
    unknowns: [], blockers: [],
  })), reference_sets: [{ source_indexes: [0, 1], primary_source_index: 1, same_item_confidence: 0.98, evidence: ['same stripe spacing, collar and buttons'] }] });
  deps.vlm.evaluateQa = async (context) => {
    qaCalls.push(context);
    return { decision: 'PASS', reason: 'all visible locks match', checks: [{ name: 'FIDELITY', pass: true, score: 0.96, evidence: 'same shirt' }], defects: [] };
  };
  deps.assetGenerator.generateGarment = async (context) => {
    generatorCalls.push(context);
    return { image: await canonical(), metadata: { provider: 'mock' } };
  };
  const observedStates = [];
  const service = new RunService({ rootDirectory: root, ...deps, observer: async (run) => observedStates.push(run.inner_state) });
  await service.initialize();
  const created = await service.createRun({ person: await upload(), garments: [await upload('#275b36'), await upload('#315f41')], generateScene: false });
  await service.running.get(created.run_id);
  const finished = await service.getRun(created.run_id);
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.garments.length, 1);
  assert.deepEqual(finished.garments[0].source_indexes, [0, 1]);
  assert.equal(generatorCalls.length, 1);
  assert.equal(generatorCalls[0].sourcePaths.length, 2);
  const garmentQa = qaCalls.find((context) => context.phase === 'garment');
  assert.equal(garmentQa.evidence.reference_packs.outfit.bindings.length, 2);
  const pack = JSON.parse(await readFile(path.join(root, created.run_id, 'conditioned', 'garments', 'reference-pack.json'), 'utf8'));
  assert.deepEqual(pack.sources.map((source) => source.source_index), [0, 1]);
  assert.equal(pack.generation_bindings.length, 1);
  assert.ok(observedStates.includes('GARMENT_GROUPING'));
  assert.ok(observedStates.includes('GARMENT_GENERATING'));
  assert.ok(observedStates.includes('GARMENT_QA'));
});
