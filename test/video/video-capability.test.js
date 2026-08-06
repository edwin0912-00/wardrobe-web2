import assert from 'node:assert/strict';
import test from 'node:test';

import { fashionVideoCapability } from '../../src/web/video-capability.js';

const lookId = '33333333-3333-4333-8333-333333333333';
const approvedLook = {
  look_id: lookId,
  image_sha256: 'a'.repeat(64),
  receipt_sha256: 'b'.repeat(64),
};
const availableStyles = [1, 2, 3].map((index) => ({
  id: `style-${index}`,
  title: `Style ${index}`,
  motion_mode: `motion_${index}`,
  presentation_surface: 'mirror',
  aspect_ratio: '9:16',
  playback_path: `/runtime/references/playback-${index}.mp4`,
  playback_sha256: String(index + 3).repeat(64),
  preview_sha256: String(index).repeat(64),
}));

test('Fashion Video remains blocked without a hash-bound reference pack', () => {
  const capability = fashionVideoCapability({ lookId, approvedLook });
  assert.equal(capability.available, false);
  assert.deepEqual(capability.requirements, {
    approved_master_look: true,
    verified_style_reference: false,
    verified_motion_reference: false,
    verified_video_style_catalog: false,
  });
  assert.equal(capability.reason_code, 'FASHION_VIDEO_REFERENCE_PACK_REQUIRED');
});

test('Fashion Video becomes available only when look, style and motion are verified', () => {
  const capability = fashionVideoCapability({
    lookId,
    approvedLook,
    motionReference: {
      state: 'READY',
      reference_path: '/runtime/references/motion.mp4',
      reference_sha256: 'c'.repeat(64),
      reference_pack_sha256: 'd'.repeat(64),
      available_styles: availableStyles,
    },
  });
  assert.equal(capability.available, true);
  assert.deepEqual(capability.requirements, {
    approved_master_look: true,
    verified_style_reference: true,
    verified_motion_reference: true,
    verified_video_style_catalog: true,
  });
  assert.equal(capability.reason_code, 'FASHION_VIDEO_READY');
  assert.equal(capability.next_action, 'CREATE_FASHION_VIDEO');
  assert.match(capability.styles[0].playback_url, /\/playback\?v=4444444444444444$/);
  assert.match(capability.styles[0].reference_url, /\/reference$/);
  assert.equal(capability.styles[0].presentation_surface, 'mirror');
  assert.equal(capability.styles[0].aspect_ratio, '9:16');
  assert.equal(capability.styles[0].input_contract.version, 'fashion-video-reference-contract-v1');
  assert.equal(capability.styles[0].input_contract.inputs[0].role, 'motion_reference');
  assert.equal(capability.styles[0].input_contract.inputs[1].role, 'approved_white_master');
});

test('Fashion Video rejects incomplete or malformed reference hashes', () => {
  const capability = fashionVideoCapability({
    lookId,
    approvedLook,
    motionReference: {
      state: 'READY',
      reference_path: '/runtime/references/motion.mp4',
      reference_sha256: 'not-a-sha',
      reference_pack_sha256: 'd'.repeat(64),
      available_styles: availableStyles,
    },
  });
  assert.equal(capability.available, false);
  assert.equal(capability.requirements.verified_style_reference, true);
  assert.equal(capability.requirements.verified_motion_reference, false);
});

test('Fashion Video remains ready when an approved fourth video style is added', () => {
  const capability = fashionVideoCapability({
    lookId,
    approvedLook,
    motionReference: {
      state: 'READY',
      reference_path: '/runtime/references/motion.mp4',
      reference_sha256: 'c'.repeat(64),
      reference_pack_sha256: 'd'.repeat(64),
      available_styles: [
        ...availableStyles,
        {
          id: 'style-4',
          title: 'Style 4',
          motion_mode: 'walk_stride',
          presentation_surface: 'tv',
          aspect_ratio: '16:9',
          playback_path: '/runtime/references/playback-4.mp4',
          playback_sha256: '7'.repeat(64),
          preview_sha256: '8'.repeat(64),
        },
      ],
    },
  });
  assert.equal(capability.available, true);
  assert.equal(capability.styles.length, 4);
  assert.equal(capability.requirements.verified_video_style_catalog, true);
});
