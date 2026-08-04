// The last thing that happens to a delivered frame, and the only two knobs on it.
//
// Both are off by default and both are read from the environment on every call,
// so this whole step is switched off by unsetting a variable — nothing here has
// to be reverted in code to stop happening.
//
// Why it exists. Measured 2026-07-27 on a delivered scene: flat mid-tone
// fine-textured surfaces (concrete, asphalt, plaster) come back from the image
// models carrying a regular diagonal crosshatch — a woven lattice, period about
// 28-31px, with the peak in a flat patch's spectrum some 800x above the median
// of its own band. It is not grain; it is a learned texture stamp, and it reads
// as "AI" instantly.
//
// Two things were tried and only one of them worked.
//
// A frequency notch that finds the coherent peaks and attenuates them does NOT
// work, and the reason is worth writing down so nobody spends the afternoon
// again: a whole-frame FFT is dominated by real content. Bamboo stalks, a hedge
// line and a pool edge produced peaks at 16-24px with ratios of 1000-3250x and
// took every rank, while the artifact never entered the top eight. Concrete
// before and after the notch was indistinguishable. Catching the stamp would
// need a local, per-tile analysis gated on a flatness test; the global version
// is a false economy.
//
// Oversampling does work. The stamp has a fixed size in pixels — measured at
// 28-31px in a 256px window at both 1k (928x1152) and 4k (3712x4608) native, so
// it is not a fraction of the frame. Generate above the delivery and shrink into
// it and the lattice averages away: the same concrete at 4k shrunk to 1024x1280
// carries fine stochastic speckle and no lattice at all. This is the cure, and
// it is the opposite of what this pipeline used to do — it was rescaling 928 UP
// to 1024, which makes the stamp bigger.
//
// Grain is the finish, not the cure. It breaks up the lattice perceptually and
// makes a synthetic surface read as film, but the lattice is still under it.
// Order matters: shrink first, grain last. Grain applied before a downscale
// would simply be averaged away.

import { createHash } from 'node:crypto';
import sharp from 'sharp';

const OVERSAMPLE_FACTORS = new Map([
  ['off', 1],
  ['1x', 1],
  ['2x', 2],
  ['4x', 4],
]);

// Above this the frame stops being a photograph and becomes colour speckle.
// Judged on a ladder at 100%: 0.03 is barely there and already helps, 0.06-0.08
// reads as film, 0.14 buries the shadow detail.
const MAX_GRAIN = 0.2;

export function resolveFrameFinish(env = process.env) {
  const rawOversample = String(env.ZEELY_FRAME_OVERSAMPLE ?? 'off').trim().toLowerCase();
  if (!OVERSAMPLE_FACTORS.has(rawOversample)) {
    throw new Error(
      `ZEELY_FRAME_OVERSAMPLE must be one of ${[...OVERSAMPLE_FACTORS.keys()].join(', ')}, got ${rawOversample}`,
    );
  }
  const rawGrain = String(env.ZEELY_FRAME_GRAIN ?? '0').trim();
  const grain = Number(rawGrain);
  if (!Number.isFinite(grain) || grain < 0 || grain > MAX_GRAIN) {
    throw new Error(`ZEELY_FRAME_GRAIN must be a number between 0 and ${MAX_GRAIN}, got ${rawGrain}`);
  }
  const oversample = OVERSAMPLE_FACTORS.get(rawOversample);
  return Object.freeze({
    oversample,
    grain,
    // One field the receipt can read instead of re-deriving the two above.
    enabled: oversample > 1 || grain > 0,
  });
}

// Deterministic by construction. The pipeline keys executions by content, so the
// same frame must always come back with the same grain — a fresh random field
// per call would make a re-run of an idempotent step produce different bytes and
// break every hash downstream. The seed is the frame itself.
function seedFromBytes(bytes) {
  const digest = createHash('sha256').update(bytes).digest();
  return digest.readUInt32BE(0) || 1;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A normal field with a little size to it. Per-pixel noise is digital snow;
// film grain is clumped, so the field is blurred with a separable 1-2-1 and then
// renormalised back to unit variance — otherwise the blur would quietly halve
// the strength the caller asked for.
function grainField(width, height, rand) {
  const n = width * height;
  const field = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    // Box-Muller. Guard the log against an exact zero.
    const u = Math.max(rand(), Number.EPSILON);
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    field[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) field[i + 1] = r * Math.sin(2 * Math.PI * v);
  }

  const pass = new Float32Array(n);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const l = field[row + (x > 0 ? x - 1 : 0)];
      const c = field[row + x];
      const r = field[row + (x + 1 < width ? x + 1 : width - 1)];
      pass[row + x] = (l + 2 * c + r) / 4;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const u = pass[(y > 0 ? y - 1 : 0) * width + x];
      const c = pass[y * width + x];
      const d = pass[(y + 1 < height ? y + 1 : height - 1) * width + x];
      field[y * width + x] = (u + 2 * c + d) / 4;
    }
  }

  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += field[i];
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    const d = field[i] - mean;
    variance += d * d;
  }
  const sd = Math.sqrt(variance / n) || 1;
  for (let i = 0; i < n; i += 1) field[i] = (field[i] - mean) / sd;
  return field;
}

/**
 * Colour film grain over the delivered frame.
 *
 * Mostly one shared monochrome field with a weak independent field per channel.
 * All-mono grain reads as digital dither; fully independent RGB reads as colour
 * snow; film sits at about four to one.
 *
 * The strength is shaped by 4*L*(1-L) — strongest in the mid-tones, near zero in
 * the blacks and in the highlights. That is how grain behaves on film, and it is
 * also exactly where the crosshatch lives, so the mask and the problem coincide.
 */
export async function applyFilmGrain(bytes, strength) {
  if (!(strength > 0)) {
    return { image: bytes, grain_applied: false };
  }
  const { data, info } = await sharp(bytes)
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels < 3) {
    throw new Error(`applyFilmGrain expects at least three channels, got ${channels}`);
  }

  const rand = mulberry32(seedFromBytes(bytes));
  const mono = grainField(width, height, rand);
  const perChannel = [
    grainField(width, height, rand),
    grainField(width, height, rand),
    grainField(width, height, rand),
  ];

  const out = Buffer.from(data);
  const pixels = width * height;
  for (let p = 0; p < pixels; p += 1) {
    const base = p * channels;
    const luma = (data[base] + data[base + 1] + data[base + 2]) / (3 * 255);
    const envelope = 4 * luma * (1 - luma);
    if (envelope <= 0) continue;
    const amount = strength * envelope * 255;
    for (let c = 0; c < 3; c += 1) {
      const n = 0.8 * mono[p] + 0.2 * perChannel[c][p];
      const value = data[base + c] + amount * n;
      out[base + c] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
    }
  }

  return {
    image: await sharp(out, { raw: { width, height, channels } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer(),
    grain_applied: true,
    grain_strength: Number(strength.toFixed(4)),
  };
}

/**
 * What to ask the provider for, given the flag and what the provider can do.
 *
 * A provider that cannot be told an output size says so by not declaring
 * `maxOversample`, and then the request goes out unchanged and the receipt
 * records that the flag was set and not honoured. That distinction matters: a
 * frame delivered without oversampling is not wrong, but it is not the fix
 * either, and a receipt that hid the difference would let the flag look like it
 * was working. Measured 2026-07-25 and again on 2026-07-27: openrouter ignores
 * `size` outright, and the codex image provider takes no size at all.
 */
export function resolveOversampleRequest(finish, provider) {
  const requested = finish?.oversample ?? 1;
  if (requested <= 1) {
    return { factor: 1, requested, honoured: false, reason: 'not_requested' };
  }
  const supported = Number(provider?.maxOversample ?? 1);
  if (!Number.isFinite(supported) || supported <= 1) {
    return { factor: 1, requested, honoured: false, reason: 'provider_takes_no_output_size' };
  }
  const factor = Math.min(requested, supported);
  return { factor, requested, honoured: factor > 1, reason: 'requested' };
}
