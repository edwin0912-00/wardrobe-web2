import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve('ui.js'), 'utf8');

function api() {
  const window = {};
  vm.runInNewContext(source, { window }, { filename: 'ui.js' });
  return window.WardrobeUI;
}

test('maps measured physical station identities to the correct left-mirror sheet', () => {
  const ui = api();

  assert.equal(ui.stepForStation('person'), 0);
  assert.equal(ui.stepForStation('EMPTY-RAILS'), 0);
  assert.equal(ui.stepForStation('garments'), 1);
  assert.equal(ui.stepForStation('things'), 1);
  assert.equal(ui.stepForStation('mirrors'), 2);
});

test('leaves legacy or unmeasured station identities alone', () => {
  const ui = api();

  assert.equal(ui.stepForStation('leg-0-end'), null);
  assert.equal(ui.stepForStation('unmeasured-room'), null);
  assert.equal(ui.stepForStation(null), null);
});
