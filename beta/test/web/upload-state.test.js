import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadSelectionStore } from '../../web/public/upload-state.js';

const file = (name, size = 10) => ({ name, size, type: 'image/png', lastModified: 1 });

test('upload fields keep independent selections', () => {
  const store = new UploadSelectionStore();
  const person = file('person.png');
  const detail = file('face.png');
  const shirt = file('shirt.png');
  store.setPerson(person);
  store.setIdentityDetail(detail);
  store.addGarments([shirt]);
  assert.equal(store.person, person);
  assert.equal(store.identityDetail, detail);
  assert.deepEqual(store.garments, [shirt]);
});

test('separate garment picker actions append instead of replace', () => {
  const store = new UploadSelectionStore();
  store.addGarments([file('shirt.png')]);
  store.addGarments([file('bag.png'), file('trousers.png')]);
  assert.deepEqual(store.garments.map((item) => item.name), ['shirt.png', 'bag.png', 'trousers.png']);
});

test('replacing one single-file slot leaves every other slot intact', () => {
  const store = new UploadSelectionStore();
  store.setPerson(file('old-person.png'));
  store.setIdentityDetail(file('face.png'));
  store.addGarments([file('shirt.png')]);
  store.setPerson(file('new-person.png'));
  assert.equal(store.person.name, 'new-person.png');
  assert.equal(store.identityDetail.name, 'face.png');
  assert.deepEqual(store.garments.map((item) => item.name), ['shirt.png']);
});

test('wardrobe cap is atomic and duplicate picks are ignored', () => {
  const store = new UploadSelectionStore({ maxGarments: 2 });
  store.addGarments([file('shirt.png')]);
  assert.equal(store.addGarments([file('shirt.png')]), 0);
  assert.throws(() => store.addGarments([file('bag.png'), file('hat.png')]), /максимум 2/);
  assert.deepEqual(store.garments.map((item) => item.name), ['shirt.png']);
});
