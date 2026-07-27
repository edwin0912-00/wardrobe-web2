import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  checkpointDisplayCode,
  PIPELINE_NODE_COUNT,
  PIPELINE_NODES,
  PIPELINE_ROWS,
  PROGRESS_STATES,
  nodeState,
  resolveProgressState,
} from '../../web/public/progress-model.js';

test('technical pipeline is a unique three-row 5×3 serpentine graph', () => {
  assert.equal(PIPELINE_ROWS.length, 3);
  assert.deepEqual(PIPELINE_ROWS.map((row) => row.nodes.length), [5, 5, 5]);
  assert.equal(PIPELINE_NODE_COUNT, 15);
  assert.equal(new Set(PIPELINE_NODES.map((node) => node.id)).size, 15);
  assert.deepEqual(PIPELINE_NODES.map((node) => [node.row, node.column]), [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 4], [1, 3], [1, 2], [1, 1], [1, 0],
    [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
  ]);
  for (const node of PIPELINE_NODES) {
    assert.ok(node.code);
    assert.ok(node.input);
    assert.ok(node.operation);
    assert.ok(node.output);
    assert.ok(node.gate);
  }
});

test('item QA explains the user-visible comparison without fidelity jargon', () => {
  const node = PIPELINE_NODES.find((item) => item.id === 'garment-qa');
  assert.equal(node.title, 'Звірка речі з оригіналом');
  assert.doesNotMatch(`${node.title} ${node.detail} ${node.operation}`, /fidelity/i);
  for (const expected of ['форм', 'колір', 'матеріал', 'логотип']) assert.match(`${node.detail} ${node.operation}`, new RegExp(expected, 'i'));
  assert.match(node.gate, /PASS.*RETRY.*NEEDS_INPUT.*REJECT/);
  assert.equal(resolveProgressState('GARMENT_QA').title, 'Звіряємо річ з оригінальними фото');
});

test('item preparation uses one clear Ukrainian product vocabulary', () => {
  const card = PIPELINE_NODES.find((item) => item.id === 'garment-passport');
  const preparation = PIPELINE_NODES.find((item) => item.id === 'garment-canonical');
  assert.equal(card.title, 'Картка речі');
  assert.equal(card.output, 'структуровані картки речей');
  assert.equal(preparation.title, 'Підготовка речі');
  assert.equal(resolveProgressState('GARMENT_CONDITIONING').title, 'Фіксуємо характеристики речей');
  assert.doesNotMatch(JSON.stringify([card, preparation, PROGRESS_STATES.GARMENT_CONDITIONING, PROGRESS_STATES.GARMENT_GENERATING]), /garment passport|canonical garment/i);
});

test('legacy internal item checkpoints expose neutral display aliases', () => {
  assert.deepEqual(
    ['GARMENT_CONDITIONING', 'GARMENT_GROUPING', 'GARMENT_GENERATING', 'GARMENT_QA'].map(checkpointDisplayCode),
    ['ITEM_FACTS', 'VIEW_GROUPING', 'ITEM_PREPARATION', 'ITEM_QA'],
  );
  assert.equal(checkpointDisplayCode('AVATAR_QA'), 'AVATAR_QA');
  assert.equal(checkpointDisplayCode(null), 'CHECKPOINT_SYNC');

  for (const key of ['GARMENT_CONDITIONING', 'GARMENT_GROUPING', 'GARMENT_GENERATING', 'GARMENT_QA']) {
    assert.ok(PROGRESS_STATES[key], `${key} must remain a valid internal state`);
  }
});

test('visible pipeline node copy contains no garment terminology', () => {
  const visibleFields = ['title', 'code', 'detail', 'input', 'operation', 'output', 'gate', 'rowLabel'];
  const visibleCopy = PIPELINE_NODES
    .flatMap((node) => visibleFields.map((field) => node[field] ?? ''))
    .join(' ');

  assert.doesNotMatch(visibleCopy, /\bgarments?\b/i);
});

test('public pages never expose the internal garment-passport naming', async () => {
  const filenames = ['../../web/public/index.html', '../../web/public/progress-model.js', '../../web/public/app.js'];
  const publicCopy = (await Promise.all(filenames.map((filename) => readFile(new URL(filename, import.meta.url), 'utf8')))).join('\n');
  assert.match(publicCopy, /Картка речі/);
  assert.doesNotMatch(publicCopy, /garment passport|canonical garment|text\/passport locks/i);
  assert.doesNotMatch(publicCopy, /Створити avatar|Очікує input|identity reference|Потрібен кращий input/i);
});

test('every nonterminal progress state resolves to the truthful technical node', () => {
  const expected = {
    PREPARING: 0, UPLOADING: 0, UPLOADED: 0, QUEUED: 0,
    GARMENT_CONDITIONING: 1, GARMENT_GROUPING: 2, GARMENT_GENERATING: 3, GARMENT_QA: 4,
    CORE_PIPELINE: 5, RECEIVED: 5, VALIDATING: 6,
    CONDITIONING_IDENTITY: 7, CONDITIONING_OUTFIT: 8,
    CONDITIONING_RETRY: 9, CONDITIONING_QA: 9, REFERENCES_READY: 9,
    GENERATING_AVATAR: 10, AVATAR_RETRY: 10, AVATAR_QA: 11, AVATAR_READY: 11,
    GENERATING_OUTFIT: 12, OUTFIT_RETRY: 12, OUTFIT_QA: 13, OUTFIT_READY: 13,
    OPTIONAL_SCENE: 14, EXPORTING: 14, COMPLETED: 14,
  };
  for (const [state, step] of Object.entries(expected)) assert.equal(resolveProgressState(state).step, step, state);
  assert.equal(resolveProgressState('RESUMING').step, null);
  assert.equal(Object.keys(PROGRESS_STATES).every((state) => resolveProgressState(state).key === state), true);
});

test('pipeline milestones stay monotonic and optional work is not presented as video', () => {
  const states = [
    'UPLOADED', 'GARMENT_CONDITIONING', 'GARMENT_GROUPING', 'GARMENT_GENERATING', 'GARMENT_QA',
    'CORE_PIPELINE', 'RECEIVED', 'VALIDATING', 'CONDITIONING_IDENTITY', 'CONDITIONING_OUTFIT',
    'CONDITIONING_QA', 'REFERENCES_READY', 'GENERATING_AVATAR', 'AVATAR_QA',
    'GENERATING_OUTFIT', 'OUTFIT_QA', 'COMPLETED',
  ];
  const percentages = states.map((state) => resolveProgressState(state).percent);
  assert.deepEqual(percentages, [...percentages].sort((a, b) => a - b));
  assert.equal(resolveProgressState('COMPLETED').percent, 100);
  assert.equal(resolveProgressState('OPTIONAL_SCENE').title.toLowerCase().includes('video'), false);
});

test('node status is route-aware and never paints skipped work green', () => {
  assert.deepEqual([0, 1, 2].map((index) => nodeState(index, 1)), ['done', 'active', 'pending']);
  assert.deepEqual([1, 2, 3, 4].map((index) => nodeState(index, 6, { garment_images_supplied: false })), [
    'skipped', 'skipped', 'skipped', 'skipped',
  ]);
  assert.equal(nodeState(10, 12, { avatar_reuse: true }), 'reused');
  assert.equal(nodeState(11, 12, { avatar_reuse: true }), 'done');
  assert.equal(nodeState(10, 14, { avatar_reuse: true }, true), 'reused');
  assert.equal(nodeState(14, 14, {}, true), 'done');
});

test('retry states move the active cursor back without reducing checkpoint percent', () => {
  assert.equal(resolveProgressState('AVATAR_QA').step, 11);
  assert.equal(resolveProgressState('AVATAR_RETRY').step, 10);
  assert.equal(resolveProgressState('OUTFIT_QA').step, 13);
  assert.equal(resolveProgressState('OUTFIT_RETRY').step, 12);
  assert.ok(resolveProgressState('AVATAR_RETRY').percent < resolveProgressState('AVATAR_QA').percent);
  assert.ok(resolveProgressState('OUTFIT_RETRY').percent < resolveProgressState('OUTFIT_QA').percent);
});

test('reconnect and unknown states do not invent an active node', () => {
  assert.equal(resolveProgressState('RESUMING').step, null);
  assert.equal(resolveProgressState('SOMETHING_NEW').step, null);
  assert.equal(resolveProgressState('SOMETHING_NEW').label, 'UNMAPPED');
  assert.equal(nodeState(0, null), 'pending');
});

test('explicit byte progress remains bounded', () => {
  assert.equal(resolveProgressState('UPLOADING', 47.6).percent, 48);
  assert.equal(resolveProgressState('UPLOADING', 140).percent, 100);
  assert.equal(resolveProgressState('UPLOADING', -20).percent, 0);
});
