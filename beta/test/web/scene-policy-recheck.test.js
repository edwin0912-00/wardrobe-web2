import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePersistedNormalizedDefectPolicy,
} from '../../src/web/scene-contract.js';

function stateFor(presetId) {
  return { bindings: { preset: { preset_id: presetId } } };
}

function defect(preferredBand, deliveryBand) {
  return {
    attempt: 3,
    preferred_band: preferredBand,
    delivery_band: deliveryBand,
  };
}

test('persisted standard framing defects accept only the active or declared historic policy', () => {
  const standard = stateFor('std.studio.peach_soft_gloss');

  const active = resolvePersistedNormalizedDefectPolicy(
    defect([70, 80], [70, 88]),
    standard,
  );
  assert.deepEqual(active.preferred_band, [70, 80]);
  assert.deepEqual(active.delivery_band, [70, 88]);

  // This is the only historic standard policy supported by the migration. It
  // proves an old failure without changing today's 70–88 delivery acceptance.
  const historic = resolvePersistedNormalizedDefectPolicy(
    defect([70, 80], [70, 80]),
    standard,
  );
  assert.equal(historic.id, 'standard-subject-scale-v0-70-80');
  assert.deepEqual(historic.delivery_band, [70, 80]);
});

test('persisted policy recheck refuses invented bands and editorial inheritance', () => {
  assert.throws(
    () => resolvePersistedNormalizedDefectPolicy(
      defect([69, 81], [69, 85]),
      stateFor('std.studio.peach_soft_gloss'),
    ),
    /unknown framing policy/,
  );
  assert.throws(
    () => resolvePersistedNormalizedDefectPolicy(
      defect([70, 80], [70, 80]),
      stateFor('shoot.olive_modernism.environmental_hero'),
    ),
    /unknown framing policy/,
  );
});
