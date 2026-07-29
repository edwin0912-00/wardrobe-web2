import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptedDroppedImages } from '../../web/public/drop-upload.js';

function file(name, type = '') {
  return { name, type };
}

test('single-image fields accept one PNG, JPEG or WEBP drop', () => {
  for (const candidate of [
    file('person.png', 'image/png'),
    file('person.jpg', 'image/jpeg'),
    file('person.webp', 'image/webp'),
    file('person.JPEG'),
  ]) {
    assert.deepEqual(acceptedDroppedImages([candidate]), [candidate]);
  }
});

test('single-image fields refuse an accidental multi-file drop', () => {
  assert.throws(
    () => acceptedDroppedImages([
      file('one.png', 'image/png'),
      file('two.png', 'image/png'),
    ]),
    /лише одне фото/,
  );
});

test('garment field preserves every dropped image for the existing store and draft queue', () => {
  const dropped = [
    file('top.png', 'image/png'),
    file('bottom.webp', 'image/webp'),
    file('shoes.jpg', 'image/jpeg'),
  ];
  assert.deepEqual(acceptedDroppedImages(dropped, { multiple: true }), dropped);
});

test('unsupported dropped material is refused before it reaches preview or draft persistence', () => {
  assert.throws(
    () => acceptedDroppedImages([file('notes.pdf', 'application/pdf')], { multiple: true }),
    /PNG, JPEG або WEBP/,
  );
});
