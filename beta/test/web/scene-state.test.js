import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_SCENE_KEY,
  presetCameraLabel,
  normalizeSceneResume,
  readSceneResume,
  sceneResumeFromSnapshot,
  writeSceneResume,
} from '../../web/public/scene-state.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const request = {
  scene_id: null,
  look_id: 'look_001',
  preset_id: 'std.room',
  preset_version: '1.0.0',
  idempotency_key: 'scene-create-request-0001',
  reference_pack_sha256: null,
  image_generation_mode: 'fast',
};

test('scene resume keeps the selected image mode with its existing idempotency key', () => {
  const storage = memoryStorage();
  const saved = writeSceneResume(request, storage);
  assert.equal(readSceneResume(storage).image_generation_mode, 'fast');
  const recovered = sceneResumeFromSnapshot({
    scene_id: 'scene_001',
    image_generation_mode: 'fast',
    approved_look: { look_id: 'look_001' },
    preset: { preset_id: 'std.room', version: '1.0.0' },
  }, saved);
  assert.equal(recovered.image_generation_mode, 'fast');
  assert.equal(recovered.idempotency_key, saved.idempotency_key);
  assert.equal(storage.getItem(ACTIVE_SCENE_KEY) !== null, true);
});

test('legacy scene resume defaults missing mode to Slow and rejects invalid modes', () => {
  const { image_generation_mode: _mode, ...legacy } = request;
  assert.equal(normalizeSceneResume(legacy).image_generation_mode, 'slow');
  assert.equal(normalizeSceneResume({ ...request, image_generation_mode: null }), null);
});

test('preset camera labels describe the delivered 3:4 scene, not the historical reference crop', () => {
  assert.equal(presetCameraLabel({ camera: { lens_mm: 70, aspect_ratio: '4:5' } }), '70 мм · 3:4');
  assert.equal(presetCameraLabel({}), '3:4');
});
