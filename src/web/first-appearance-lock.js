import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { removeBorderConnectedWhiteToAlpha } from '../conditioning/transparent-cutout.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class FirstAppearanceNeedsInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FirstAppearanceNeedsInputError';
    this.code = 'FIRST_APPEARANCE_NEEDS_INPUT';
    this.details = details;
  }
}

async function writeImmutable(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.immutable`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await link(temporary, filename);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(filename);
    if (!existing.equals(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))) {
      throw new Error(`Immutable first-appearance artifact conflict: ${path.basename(filename)}`);
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function visibleBounds(data, { width, height, channels }) {
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] === 0) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function crop(bytes, region) {
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate();
  const metadata = await image.metadata();
  const cropped = await image.extract(region).png().toBuffer();
  const cropMeta = await sharp(cropped).metadata();
  if (!cropMeta.width || !cropMeta.height || cropMeta.width < 128 || cropMeta.height < 128) {
    throw new FirstAppearanceNeedsInputError('Visible lower-body crop is too small to lock', { region, metadata });
  }
  const scale = Math.min(2, Math.max(1, 256 / Math.min(cropMeta.width, cropMeta.height)));
  return scale === 1 ? cropped : sharp(cropped)
    .resize({ width: Math.round(cropMeta.width * scale), height: Math.round(cropMeta.height * scale), kernel: 'lanczos3' })
    .png().toBuffer();
}

async function reopenImmutableLock({ recordPath, outputDirectory, runId, approvedLookSha256 }) {
  let bytes;
  try {
    bytes = await readFile(recordPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Immutable first-appearance record is not valid JSON');
  }
  if (record?.kind !== 'FIRST_APPEARANCE_ITEM_LOCK'
    || record.run_id !== runId
    || record.approved_look_sha256 !== approvedLookSha256
    || !Array.isArray(record.items)
    || record.items.length !== 2
    || record.items[0]?.category !== 'bottom'
    || record.items[1]?.category !== 'footwear') {
    throw new Error('Immutable first-appearance record conflicts with this approved look');
  }

  const lockRoot = `${path.resolve(outputDirectory)}${path.sep}`;
  for (const item of record.items) {
    for (const artifact of [item.source, item.reference_card, item.cutout]) {
      if (!artifact || typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string'
        || !path.resolve(artifact.path).startsWith(lockRoot)) {
        throw new Error('Immutable first-appearance record contains an invalid artifact binding');
      }
      const artifactBytes = await readFile(artifact.path);
      if (sha256(artifactBytes) !== artifact.sha256) {
        throw new Error(`Immutable first-appearance artifact hash mismatch: ${path.basename(artifact.path)}`);
      }
    }
  }
  return { record, recordPath, items: record.items };
}

/**
 * Creates evidence only from pixels already visible in a white-background
 * full-body approved look. It never calls an image generator.
 */
export async function lockFirstAppearance({ approvedLookPath, outputDirectory, runId, vlm, clock = () => new Date() }) {
  const look = await readFile(approvedLookPath);
  const recordPath = path.join(outputDirectory, 'lock.json');
  const approvedLookSha256 = sha256(look);
  const existing = await reopenImmutableLock({
    recordPath,
    outputDirectory,
    runId,
    approvedLookSha256,
  });
  if (existing) return existing;
  const isolated = await removeBorderConnectedWhiteToAlpha(look, {
    removeBorderConnectedNeutralGradient: true,
    removeDetachedLowContrastResidue: true,
  });
  const { data, info } = await sharp(isolated.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = visibleBounds(data, info);
  if (!bounds || bounds.height < info.height * 0.55) {
    throw new FirstAppearanceNeedsInputError('Approved look is not a usable full-body white-background source', { bounds, width: info.width, height: info.height });
  }
  const pad = Math.max(2, Math.round(bounds.width * 0.04));
  const left = Math.max(0, bounds.left - pad);
  const width = Math.min(info.width - left, bounds.width + pad * 2);
  const regions = [
    { category: 'bottom', role: 'GARMENT_BOTTOM', name: 'bottom', top: Math.round(bounds.top + bounds.height * 0.50), height: Math.max(128, Math.round(bounds.height * 0.36)) },
    { category: 'footwear', role: 'GARMENT_FOOTWEAR', name: 'footwear', top: Math.round(bounds.top + bounds.height * 0.90), height: Math.max(128, Math.round(bounds.height * 0.10)) },
  ].map((item) => ({ ...item, left, width, top: Math.min(info.height - 1, item.top), height: Math.min(info.height - item.top, item.height) }));
  const sourceDirectory = path.join(outputDirectory, 'sources');
  const sourcePaths = [];
  for (const region of regions) {
    const bytes = await crop(look, region);
    const filename = path.join(sourceDirectory, `${region.name}.png`);
    await writeImmutable(filename, bytes);
    sourcePaths.push(filename);
  }
  // This is a separate VLM observation boundary from the user's garment
  // upload. It only classifies two deterministic crops produced from the
  // already approved white-background look; callers can therefore preserve
  // their upload-passport behaviour without weakening this lock.
  const passport = await vlm.inspectGarments(sourcePaths, {
    purpose: 'FIRST_APPEARANCE_LOCK',
    required_categories: ['bottom', 'footwear'],
  });
  if (passport?.status !== 'READY' || !Array.isArray(passport.items) || passport.items.length !== 2) {
    throw new FirstAppearanceNeedsInputError('First-appearance crops could not be identified reliably', { passport });
  }
  const locked = [];
  for (const [index, expected] of regions.entries()) {
    const observed = passport.items[index];
    if (observed?.category !== expected.category || !observed.observed || observed.confidence < 0.7) {
      throw new FirstAppearanceNeedsInputError('First-appearance crop category is not reliably visible', { expected: expected.category, observed });
    }
    const source = await readFile(sourcePaths[index]);
    const cutout = await removeBorderConnectedWhiteToAlpha(source, {
      removeBorderConnectedNeutralGradient: true,
      removeDetachedLowContrastResidue: true,
    });
    const directory = path.join(outputDirectory, String(index + 1).padStart(2, '0'));
    const referenceCard = path.join(directory, 'reference-card.png');
    const cutoutPath = path.join(directory, 'cutout.png');
    await writeImmutable(referenceCard, source);
    await writeImmutable(cutoutPath, cutout.image);
    locked.push({
      order: index + 1,
      role: expected.role,
      category: expected.category,
      reference_set_id: `first-appearance-${expected.category}`,
      source_indexes: [index],
      same_item_confidence: 1,
      grouping_evidence: ['One immutable crop from the approved full-body look.'],
      confidence: observed.confidence,
      observed: observed.observed,
      unknowns: observed.unknowns ?? [],
      source: { path: sourcePaths[index], sha256: sha256(source) },
      reference_card: { path: referenceCard, sha256: sha256(source) },
      cutout: { path: cutoutPath, sha256: sha256(cutout.image) },
    });
  }
  const record = {
    schema_version: '1.0.0', kind: 'FIRST_APPEARANCE_ITEM_LOCK', run_id: runId,
    approved_look_sha256: approvedLookSha256, provenance: 'OBSERVED_FROM_APPROVED_LOOK',
    policy: 'LOCK_ON_FIRST_APPEARANCE', immutable_after_creation: true,
    items: locked.map(({ source, reference_card, cutout, ...item }) => ({ ...item, source, reference_card, cutout })),
    created_at: clock().toISOString(),
  };
  await writeImmutable(recordPath, Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
  return { record, recordPath, items: locked };
}
