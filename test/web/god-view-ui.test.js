import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('God View begins with one all-session saved-look picker and keeps it read-only', async () => {
  const [html, client] = await Promise.all([
    readFile(path.join(root, 'web', 'public', 'god-view.html'), 'utf8'),
    readFile(path.join(root, 'web', 'public', 'god-view.js'), 'utf8'),
  ]);

  assert.match(html, /id="god-look-picker-grid"/);
  assert.match(html, /ОБЕРИ ЗБЕРЕЖЕНИЙ ОБРАЗ/i);
  assert.match(html, /УСІ АКТИВНІ СЕСІЇ/i);
  assert.match(client, /function renderLookPicker/);
  assert.match(client, /god-look-\$\{look\.look_id\}/);
  assert.match(client, /15_000/);
  assert.doesNotMatch(html, /Видалити профіль|Створити сцену/);
});
