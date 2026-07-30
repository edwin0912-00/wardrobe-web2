import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOTION_MODES,
  VIDEO_SURFACES,
  SURFACES,
  MotionPlanError,
  buildFashionVideoReferencePrompt,
  buildMotionPlan,
  videoSurface,
  surface,
} from '../../src/web/video-motion-plan.js';
import { buildVideoCreateArgs } from '../../src/providers/higgsfield-video-provider.js';

test('the canon has exactly four motion modes', () => {
  assert.deepEqual(Object.keys(MOTION_MODES), [
    'editorial_micro_moment',
    'camera_drift',
    'walk_stride',
    'garment_gesture',
  ]);
});

test('each mode carries the canon duration window and a sane default', () => {
  for (const mode of Object.values(MOTION_MODES)) {
    const { minimum, maximum, default: fallback } = mode.seconds;
    assert.ok(minimum < maximum, mode.id);
    assert.ok(fallback >= minimum && fallback <= maximum, mode.id);
  }
  assert.deepEqual(MOTION_MODES.walk_stride.seconds, { minimum: 5, maximum: 8, default: 6 });
});

test('a plan states the locks that make it a fashion clip and not a lookalike', () => {
  const plan = buildMotionPlan({ modeId: 'editorial_micro_moment' });
  assert.equal(plan.durationSeconds, 5);
  assert.match(plan.prompt, /Identity, hair, silhouette and the approved look are locked/);
  assert.match(plan.prompt, /No garment is added, removed, restyled or rebranded/);
  assert.match(plan.prompt, /No new props, no text, no logos/);
});

test('the reference-transfer prompt makes Video 1 the full scene and edit authority', () => {
  const prompt = buildFashionVideoReferencePrompt({
    hasIdentityReference: true,
    hasGarmentReference: true,
  });
  assert.match(prompt, /\[Video 1\].*exact temporal, editorial and scene master/);
  assert.match(prompt, /complete shot sequence, cut timing, transitions/);
  assert.match(prompt, /\[Image 1\].*exact approved person.*complete approved outfit/);
  assert.match(prompt, /\[Image 2\] defines face identity and hair only/);
  assert.match(prompt, /\[Image 3\] defines the approved garment and footwear/);
  assert.match(prompt, /Never replace the reference environment/);
  assert.match(prompt, /Do not simplify the reference into a static portrait/);
  assert.doesNotMatch(prompt, /blink|breathe|camera is effectively still/i);
});

test('walk or stride is refused unless the source really shows the feet', () => {
  assert.throws(
    () => buildMotionPlan({ modeId: 'walk_stride' }),
    (error) => {
      assert.equal(error.code, 'MOTION_MODE_SOURCE_MISMATCH');
      return true;
    },
  );
  const plan = buildMotionPlan({ modeId: 'walk_stride', sourceCapabilities: { full_length: true } });
  assert.match(plan.prompt, /rear heel lifts/);
});

test('a duration outside the mode window is refused, not clamped', () => {
  assert.throws(
    () => buildMotionPlan({ modeId: 'editorial_micro_moment', durationSeconds: 8 }),
    (error) => {
      assert.equal(error.code, 'MOTION_DURATION_OUT_OF_RANGE');
      assert.match(error.message, /4–6 seconds/);
      return true;
    },
  );
});

test('an unknown mode is refused', () => {
  assert.throws(() => buildMotionPlan({ modeId: 'dance_off' }), (error) => {
    assert.equal(error.code, 'UNKNOWN_MOTION_MODE');
    return true;
  });
});

test('every generated plan is accepted by the transport, geometry guard included', () => {
  for (const mode of Object.values(MOTION_MODES)) {
    const plan = buildMotionPlan({
      modeId: mode.id,
      sourceCapabilities: { full_length: true },
    });
    const args = buildVideoCreateArgs({
      prompt: plan.prompt,
      mediaPaths: ['/tmp/source.png'],
      durationSeconds: plan.durationSeconds,
    });
    assert.equal(args[args.indexOf('--aspect_ratio') + 1], '16:9', mode.id);
    assert.equal(args[args.indexOf('--generate_audio') + 1], 'false', mode.id);
    assert.equal(args[args.indexOf('--duration') + 1], String(plan.durationSeconds), mode.id);
  }
});

test('a style note is carried through, and an empty one is refused', () => {
  const plan = buildMotionPlan({
    modeId: 'camera_drift',
    styleNote: 'Hold the grade of the shutter amber interior unit.',
  });
  assert.match(plan.prompt, /shutter amber interior/);
  assert.throws(() => buildMotionPlan({ modeId: 'camera_drift', styleNote: '   ' }), MotionPlanError);
});

// -- Surface tests (VIDEO_SURFACES — primary, rich framing notes) --

test('the surface decides the shape: television is wide, mirror is tall', () => {
  const tv = buildMotionPlan({ modeId: 'editorial_micro_moment', surface: 'tv' });
  const mirror = buildMotionPlan({ modeId: 'editorial_micro_moment', surface: 'mirror' });

  assert.equal(tv.aspectRatio, '16:9');
  assert.equal(mirror.aspectRatio, '9:16');
  assert.match(tv.prompt, /wide landscape screen/);
  assert.match(mirror.prompt, /tall upright screen/);
});

test('the television is the default surface', () => {
  assert.equal(buildMotionPlan({ modeId: 'camera_drift' }).surface, 'tv');
  assert.equal(buildMotionPlan({ modeId: 'camera_drift' }).aspectRatio, '16:9');
});

test('an unknown surface is refused rather than silently defaulted', () => {
  assert.throws(
    () => buildMotionPlan({ modeId: 'camera_drift', surface: 'billboard' }),
    (error) => {
      assert.equal(error.code, 'UNKNOWN_VIDEO_SURFACE');
      return true;
    },
  );
});

// -- Legacy SURFACES alias tests --

test('exactly two legacy surfaces exist: tv and mirror', () => {
  assert.deepEqual(Object.keys(SURFACES), ['tv', 'mirror']);
});

test('legacy surface() helper works', () => {
  assert.equal(surface('tv').aspectRatio, '16:9');
  assert.equal(surface('mirror').aspectRatio, '9:16');
  assert.throws(() => surface('projector'), (error) => {
    assert.equal(error.code, 'UNKNOWN_SURFACE');
    return true;
  });
});

test('the framing note never names a ratio, so the geometry guard stays happy', () => {
  for (const surfaceId of ['tv', 'mirror']) {
    for (const mode of Object.values(MOTION_MODES)) {
      const plan = buildMotionPlan({
        modeId: mode.id,
        surface: surfaceId,
        sourceCapabilities: { full_length: true },
      });
      const args = buildVideoCreateArgs({
        prompt: plan.prompt,
        mediaPaths: ['/tmp/source.png'],
        aspectRatio: plan.aspectRatio,
        durationSeconds: plan.durationSeconds,
      });
      assert.equal(args[args.indexOf('--aspect_ratio') + 1], plan.aspectRatio, `${surfaceId}/${mode.id}`);
    }
  }
});
