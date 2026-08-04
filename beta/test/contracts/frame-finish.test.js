import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  applyFilmGrain,
  resolveFrameFinish,
  resolveOversampleRequest,
} from '../../src/web/frame-finish.js';

// A strip with a pure black band, a mid-grey band and a pure white band. The
// bands are what make the envelope testable: film grain belongs in the
// mid-tones, and a step that also speckles the blacks would be a defect that a
// "did the bytes change" assertion could not see.
const BAND_HEIGHT = 32;
const WIDTH = 96;

async function bandedStrip() {
  const raw = Buffer.alloc(WIDTH * BAND_HEIGHT * 3 * 3);
  const levels = [0, 128, 255];
  levels.forEach((level, band) => {
    const start = band * WIDTH * BAND_HEIGHT * 3;
    raw.fill(level, start, start + WIDTH * BAND_HEIGHT * 3);
  });
  return sharp(raw, { raw: { width: WIDTH, height: BAND_HEIGHT * 3, channels: 3 } })
    .png()
    .toBuffer();
}

async function bandMeans(bytes) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const perBand = [];
  for (let band = 0; band < 3; band += 1) {
    let sum = 0;
    let count = 0;
    let maxDeviation = 0;
    const reference = [0, 128, 255][band];
    for (let y = band * BAND_HEIGHT; y < (band + 1) * BAND_HEIGHT; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          const value = data[(y * info.width + x) * info.channels + c];
          sum += value;
          count += 1;
          maxDeviation = Math.max(maxDeviation, Math.abs(value - reference));
        }
      }
    }
    perBand.push({ mean: sum / count, maxDeviation });
  }
  return perBand;
}

test('frame finish is off unless the environment asks for it', () => {
  const off = resolveFrameFinish({});
  assert.equal(off.oversample, 1);
  assert.equal(off.grain, 0);
  assert.equal(off.enabled, false);

  const explicitlyOff = resolveFrameFinish({ ZEELY_FRAME_OVERSAMPLE: 'off', ZEELY_FRAME_GRAIN: '0' });
  assert.equal(explicitlyOff.enabled, false);

  const on = resolveFrameFinish({ ZEELY_FRAME_OVERSAMPLE: '4x', ZEELY_FRAME_GRAIN: '0.07' });
  assert.equal(on.oversample, 4);
  assert.equal(on.grain, 0.07);
  assert.equal(on.enabled, true);
});

test('a malformed flag fails loudly instead of silently disabling the step', () => {
  for (const env of [
    { ZEELY_FRAME_OVERSAMPLE: '3x' },
    { ZEELY_FRAME_OVERSAMPLE: 'yes' },
    { ZEELY_FRAME_GRAIN: 'heavy' },
    { ZEELY_FRAME_GRAIN: '-0.1' },
    { ZEELY_FRAME_GRAIN: '0.5' },
  ]) {
    assert.throws(() => resolveFrameFinish(env), /ZEELY_FRAME_/);
  }
});

test('oversample is only requested when the provider has said it can obey', () => {
  assert.deepEqual(
    resolveOversampleRequest({ oversample: 1 }, { maxOversample: 4 }),
    { factor: 1, requested: 1, honoured: false, reason: 'not_requested' },
  );
  // Today's providers: openrouter measured to ignore `size`, the codex image
  // provider takes none. The flag must report itself unhonoured rather than
  // look like a fix that is running.
  assert.deepEqual(
    resolveOversampleRequest({ oversample: 4 }, {}),
    { factor: 1, requested: 4, honoured: false, reason: 'provider_takes_no_output_size' },
  );
  const capped = resolveOversampleRequest({ oversample: 4 }, { maxOversample: 2 });
  assert.equal(capped.factor, 2);
  assert.equal(capped.honoured, true);
});

test('grain off returns the exact bytes it was given', async () => {
  const source = await bandedStrip();
  const result = await applyFilmGrain(source, 0);
  assert.equal(result.grain_applied, false);
  assert.ok(result.image.equals(source), 'the delivered frame must be untouched when grain is off');
});

test('grain is deterministic for a given frame', async () => {
  const source = await bandedStrip();
  const first = await applyFilmGrain(source, 0.07);
  const second = await applyFilmGrain(source, 0.07);
  assert.ok(first.image.equals(second.image), 'the same frame must grain to the same bytes');
  // Content-keyed, so a different frame gets a different field.
  const other = await sharp(await bandedStrip()).modulate({ brightness: 1.01 }).png().toBuffer();
  const third = await applyFilmGrain(other, 0.07);
  assert.ok(!third.image.equals(first.image));
});

test('grain lands in the mid-tones and leaves the blacks and highlights alone', async () => {
  const source = await bandedStrip();
  const grained = await applyFilmGrain(source, 0.07);
  assert.equal(grained.grain_applied, true);
  assert.equal(grained.grain_strength, 0.07);

  const [black, grey, white] = await bandMeans(grained.image);
  // The envelope is 4*L*(1-L): zero at both ends, one in the middle.
  assert.equal(black.maxDeviation, 0, 'pure black must not be speckled');
  assert.equal(white.maxDeviation, 0, 'a blown highlight must not be speckled');
  assert.ok(grey.maxDeviation > 8, `mid-grey must actually receive grain, saw ${grey.maxDeviation}`);
  // Grain adds texture, not exposure. The mean must barely move.
  assert.ok(Math.abs(grey.mean - 128) < 2, `grain must not shift exposure, mean moved to ${grey.mean}`);
});

test('grain preserves the delivered geometry', async () => {
  const source = await bandedStrip();
  const before = await sharp(source).metadata();
  const after = await sharp((await applyFilmGrain(source, 0.14)).image).metadata();
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
  assert.equal(after.format, 'png');
});
