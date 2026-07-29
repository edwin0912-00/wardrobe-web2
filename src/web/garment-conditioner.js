import { createHash } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { normalizeWhitePngBytes } from '../qa/white-normalizer.mjs';
import { removeBorderConnectedWhiteToAlpha } from '../conditioning/transparent-cutout.mjs';
import { IMAGE_MODEL_ROUTE } from '../runner/model-policy.js';
import { assertExternalPromptPrivacy, sanitizeExternalPrompt } from '../providers/provider-prompt-privacy.js';
import { compileFullLookText, findGarmentConflicts, garmentLocks, groupGarmentViews } from './garment-passport.js';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
let immutableWriteSequence = 0;
async function atomicWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filename);
}
async function immutableWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const payload = Buffer.from(bytes);
  const temporary = `${filename}.${process.pid}.${Date.now()}.${immutableWriteSequence += 1}.tmp`;
  await writeFile(temporary, payload, { flag: 'wx' });
  try {
    // link() is a no-replace publish on one filesystem. A restart can therefore
    // never overwrite an already persisted candidate or its QA decision.
    await link(temporary, filename);
    await unlink(temporary);
    return payload;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(filename);
    if (sha256(existing) !== sha256(payload)) {
      throw new Error(`Immutable garment checkpoint conflict: ${path.basename(filename)}`);
    }
    return existing;
  }
}
function attemptReceiptPath(itemDirectory, attempt) {
  return path.join(itemDirectory, 'attempts', `attempt-${String(attempt).padStart(2, '0')}.json`);
}
function candidatePathForAttempt(itemDirectory, attempt) {
  return path.join(itemDirectory, `candidate-${attempt}.png`);
}
function validQaDecision(qa) {
  return qa && ['PASS', 'RETRY', 'REJECT', 'NEEDS_INPUT'].includes(qa.decision)
    && typeof qa.reason === 'string' && Array.isArray(qa.checks) && Array.isArray(qa.defects);
}
async function sourceHashes(sourcePaths) {
  return Promise.all(sourcePaths.map(async (sourcePath) => ({
    filename: path.basename(sourcePath),
    sha256: sha256(await readFile(sourcePath)),
  })));
}
async function loadAttemptReceipt({ itemDirectory, attempt, model, runId, referenceSetId, sources }) {
  const receiptPath = attemptReceiptPath(itemDirectory, attempt);
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Garment attempt receipt is invalid: ${path.basename(receiptPath)}`);
  }
  const expectedCandidatePath = candidatePathForAttempt(itemDirectory, attempt);
  const sourceMatches = Array.isArray(receipt.sources)
    && JSON.stringify(receipt.sources) === JSON.stringify(sources);
  if (receipt.schema_version !== '1.0.0' || receipt.kind !== 'GARMENT_ATTEMPT'
    || receipt.run_id !== runId || receipt.reference_set_id !== referenceSetId
    || receipt.attempt !== attempt || receipt.model !== model || !sourceMatches
    || receipt.candidate?.filename !== path.basename(expectedCandidatePath)
    || !/^[a-f0-9]{64}$/.test(receipt.candidate?.sha256 ?? '')
    || !validQaDecision(receipt.qa)) {
    throw new Error(`Garment attempt receipt does not match immutable run evidence: ${path.basename(receiptPath)}`);
  }
  const candidate = await readFile(expectedCandidatePath);
  if (sha256(candidate) !== receipt.candidate.sha256) {
    throw new Error(`Garment attempt candidate hash mismatch: ${path.basename(expectedCandidatePath)}`);
  }
  return {
    attempt,
    model,
    candidate: { path: expectedCandidatePath, sha256: receipt.candidate.sha256 },
    qa: receipt.qa,
    provider: receipt.provider ?? {},
    image: candidate,
  };
}
async function persistAttemptReceipt({ itemDirectory, attempt, model, runId, referenceSetId, sources, candidatePath, candidate, qa, provider, clock }) {
  const receipt = {
    schema_version: '1.0.0',
    kind: 'GARMENT_ATTEMPT',
    run_id: runId,
    reference_set_id: referenceSetId,
    attempt,
    model,
    sources,
    candidate: { filename: path.basename(candidatePath), sha256: sha256(candidate) },
    qa,
    provider: provider ?? {},
    created_at: clock().toISOString(),
  };
  await immutableWrite(
    attemptReceiptPath(itemDirectory, attempt),
    Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`),
  );
  return receipt;
}
function canonicalPrompt(item, referenceCount) {
  const locks = garmentLocks(item).map((value) => `- ${value}`).join('\n');
  const bindings = Array.from({ length: referenceCount }, (_, index) => `- ATTACHMENT_${index + 1} [GARMENT_RAW_VIEW_${index + 1}]`).join('\n');
  const prompt = `Create a canonical ecommerce reference of the exact same primary wardrobe item visible across the attached views. Every attachment is evidence for the same item. Show the complete item alone, centered, in the most evidence-preserving orientation on uniform pure #FFFFFF. Preserve the primary raw view orientation unless multiple attached views visibly establish a different canonical angle. Remove the person, hands, hanger, room, floor, props and shadows. Preserve every observable color, material, pattern, seam, closure, logo, text and construction detail exactly. Do not invent hidden details, branding or decoration. If part of the item is obscured, use the most conservative structurally neutral completion.\n\nREFERENCE BINDINGS:\n${bindings}\n\nOBSERVED LOCKS:\n${locks}`;
  return assertExternalPromptPrivacy(sanitizeExternalPrompt(prompt));
}

async function hasCleanWhiteBorder(sourcePath) {
  const { data, info } = await sharp(sourcePath, { failOn: 'error', limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width: 96, height: 96, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let borderPixels = 0;
  let cleanPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (x !== 0 && y !== 0 && x !== info.width - 1 && y !== info.height - 1) continue;
      const offset = (y * info.width + x) * info.channels;
      borderPixels += 1;
      const alpha = data[offset + 3];
      if (alpha < 16 || (data[offset] >= 242 && data[offset + 1] >= 242 && data[offset + 2] >= 242)) cleanPixels += 1;
    }
  }
  return borderPixels > 0 && cleanPixels / borderPixels >= 0.96;
}

export class GarmentNeedsInputError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'GarmentNeedsInputError'; this.details = details; }
}

export class GarmentRouteExhaustedError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'GarmentRouteExhaustedError'; this.details = details; }
}

export class GarmentConditioner {
  constructor({ vlm, generator, generationRoute = IMAGE_MODEL_ROUTE, maxGarmentBindings = null, clock = () => new Date() }) {
    if (!Array.isArray(generationRoute) || generationRoute.length < 1
      || new Set(generationRoute).size !== generationRoute.length) {
      throw new TypeError('generationRoute must contain unique models');
    }
    if (maxGarmentBindings !== null && (!Number.isInteger(maxGarmentBindings) || maxGarmentBindings < 0)) {
      throw new TypeError('maxGarmentBindings must be null or a non-negative integer');
    }
    this.vlm = vlm;
    this.generator = generator;
    this.generationRoute = [...generationRoute];
    this.maxGarmentBindings = maxGarmentBindings;
    this.clock = clock;
  }

  async condition({
    imagePaths,
    outputDirectory,
    runId,
    passport: savedPassport = null,
    selections = {},
    onProgress = async () => {},
    onVisual = async () => {},
  }) {
    const emitVisual = async (checkpoint) => {
      try {
        await onVisual(checkpoint);
      } catch {
        // Live preview is observational and must never break or delay the core run.
      }
    };
    if (!savedPassport && imagePaths.length > 0) {
      await emitVisual({
        stage: 'ITEM_SOURCE_INSPECTION',
        subject: { kind: 'ITEM', index: 1, total: imagePaths.length },
        presentation: 'SOURCE_SCAN',
        truthState: 'IMMUTABLE_INPUT',
        title: 'Аналізуємо вихідне фото речі',
        status: `Вихідне фото 1 з ${imagePaths.length}`,
        layers: [{ role: 'SOURCE', path: imagePaths[0] }],
      });
    }
    const passport = savedPassport ?? await this.vlm.inspectGarments(imagePaths);
    await onProgress('GARMENT_GROUPING', 'Фото речей класифіковано та згруповано за ракурсами');
    if (passport.status !== 'READY') throw new GarmentNeedsInputError(passport.reason, { passport });
    const grouped = groupGarmentViews(passport.items, passport.reference_sets);
    const selectedIds = new Set(Object.values(selections));
    const selectedCategories = new Set(Object.keys(selections));
    const retainedIds = new Set(grouped
      .filter((item) => !selectedCategories.has(item.category) || selectedIds.has(item.reference_set_id))
      .map((item) => item.reference_set_id));
    const allReferenceSets = Array.isArray(passport.reference_sets) && passport.reference_sets.length
      ? passport.reference_sets
      : passport.items.map((item) => ({ source_indexes: [item.source_index], primary_source_index: item.source_index, same_item_confidence: 1, evidence: ['legacy singleton view'] }));
    const referenceSets = allReferenceSets.filter((set) => retainedIds.has(`set-${set.source_indexes.slice().sort((a, b) => a - b).join('-')}`));
    const retainedIndexes = new Set(referenceSets.flatMap((set) => set.source_indexes));
    const items = passport.items.filter((item) => retainedIndexes.has(item.source_index));
    const conflicts = findGarmentConflicts(items, referenceSets);
    if (conflicts.length) throw new GarmentNeedsInputError('Знайдено кілька різних речей однієї категорії — оберіть одну', { passport, conflicts });
    const conditioned = [];
    const selectedGarments = groupGarmentViews(items, referenceSets);
    if (this.maxGarmentBindings !== null && selectedGarments.length > this.maxGarmentBindings) {
      throw new GarmentNeedsInputError(
        `This generation route can carry at most ${this.maxGarmentBindings} distinct garment references with the supplied identity evidence`,
        {
          code: 'ORDERED_REFERENCE_LIMIT_EXCEEDED',
          garment_binding_count: selectedGarments.length,
          max_garment_bindings: this.maxGarmentBindings,
          action: 'Remove a distinct garment or the optional identity detail; multiple views of the same exact garment may remain grouped',
          passport,
        },
      );
    }
    for (const item of selectedGarments) {
      if (item.blockers.length) throw new GarmentNeedsInputError('На фото речі недостатньо видимих характеристик', { item });
      const sourcePaths = item.source_indexes.map((index) => imagePaths[index]);
      const sourcePath = sourcePaths[0];
      const itemDirectory = path.join(outputDirectory, String(item.source_index + 1).padStart(2, '0'));
      const sources = await sourceHashes(sourcePaths);
      let accepted;
      const attempts = [];
      // An already isolated, sufficiently sized source is stronger evidence
      // than an unnecessary regeneration. Preserve it byte-for-pixel apart
      // from deterministic alpha-to-white normalization, then let the same QA
      // gate decide. Ordinary photos still use the image worker.
      const sourceMetadata = await sharp(sourcePath, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
      const preserveSource = sourcePaths.length === 1
        && sourceMetadata.width >= 256
        && sourceMetadata.height >= 256
        && (sourceMetadata.hasAlpha === true || await hasCleanWhiteBorder(sourcePath));
      const route = preserveSource ? ['source_preserved'] : this.generationRoute;
      for (const [routeIndex, model] of route.entries()) {
        const attempt = routeIndex + 1;
        const candidatePath = candidatePathForAttempt(itemDirectory, attempt);
        const persisted = await loadAttemptReceipt({
          itemDirectory,
          attempt,
          model,
          runId,
          referenceSetId: item.reference_set_id,
          sources,
        });
        if (persisted) {
          attempts.push({
            attempt: persisted.attempt,
            model: persisted.model,
            candidate: persisted.candidate,
            qa: persisted.qa,
            provider: persisted.provider,
          });
          if (persisted.qa.decision === 'PASS') {
            accepted = {
              model,
              candidatePath,
              image: persisted.image,
              qa: persisted.qa,
              provider: persisted.provider,
            };
            break;
          }
          if (persisted.qa.decision === 'NEEDS_INPUT') {
            throw new GarmentNeedsInputError(persisted.qa.reason, { item, qa: persisted.qa, attempts });
          }
          // RETRY and REJECT are durable outcomes for this exact candidate.
          // Never re-submit it after a daemon restart.
          continue;
        }
        if (routeIndex > 0) await emitVisual({ reset: true, reason: 'ITEM_CANDIDATE_RETRY' });
        await onProgress(
          'GARMENT_GENERATING',
          preserveSource
            ? `Зберігаємо точний еталон речі ${conditioned.length + 1} з ${selectedGarments.length}`
            : `Готуємо еталонне зображення речі ${conditioned.length + 1} з ${selectedGarments.length}`,
        );
        let candidate;
        let provider;
        try {
          // A process may have exited after storing the candidate but before
          // QA was written. Resume from the pixels and evaluate them once;
          // do not pay for an identical provider retry.
          candidate = await readFile(candidatePath);
          await sharp(candidate, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
          provider = { provider: 'resumed-unreceipted-candidate' };
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const generated = preserveSource
            ? {
              image: await sharp(sourcePath, { failOn: 'error', limitInputPixels: 100_000_000 })
                .flatten({ background: '#ffffff' }).png().toBuffer(),
              metadata: { provider: 'deterministic-source-preservation', mode: 'ALREADY_ISOLATED_REFERENCE' },
            }
            : await this.generator.generateGarment({
              sourcePath, sourcePaths, model, prompt: canonicalPrompt(item, sourcePaths.length), workDirectory: itemDirectory,
              operationId: `${runId}-garment-${item.source_index}-${attempt}`,
            });
          // Canonical item reference cards are intentionally opaque white. Flattening is
          // explicit here (and nowhere in core avatar QA) before deterministic
          // border-connected white normalization and cutout creation.
          const opaqueCandidate = await sharp(generated.image).flatten({ background: '#ffffff' }).png().toBuffer();
          const normalized = await normalizeWhitePngBytes(opaqueCandidate);
          candidate = await immutableWrite(candidatePath, normalized.image);
          provider = generated.metadata ?? {};
        }
        await emitVisual({
          stage: 'ITEM_CANDIDATE_READY',
          subject: {
            kind: 'ITEM',
            index: conditioned.length + 1,
            total: selectedGarments.length,
          },
          presentation: 'CANDIDATE_REVEAL',
          truthState: 'GENERATED_CANDIDATE',
          title: preserveSource ? 'Точний еталон речі збережено' : 'Еталон речі згенеровано',
          status: preserveSource
            ? 'Чистий предметний референс не перегенеровувався; зараз проходить перевірку якості'
            : 'Показано реальний кандидат до перевірки якості',
          layers: [{
            role: 'CANDIDATE',
            path: candidatePath,
            sha256: sha256(candidate),
          }],
          metrics: { attempt },
        });
        await onProgress('GARMENT_QA', `Звіряємо підготовлену річ ${conditioned.length + 1} з оригінальними фото`);
        await emitVisual({
          stage: 'ITEM_CANDIDATE_QA',
          subject: {
            kind: 'ITEM',
            index: conditioned.length + 1,
            total: selectedGarments.length,
          },
          presentation: 'QA_SCAN',
          truthState: 'QA_IN_PROGRESS',
          title: 'Перевіряємо еталон речі',
          status: 'Реальний кандидат зараз звіряється з оригінальними фото',
          layers: [{
            role: 'CANDIDATE',
            path: candidatePath,
            sha256: sha256(candidate),
          }],
          metrics: { attempt },
        });
        const qa = await this.vlm.evaluateQa({ phase: 'garment', evidence: {
          identity: { artifact: { path: sourcePath } }, candidate: { artifact: { path: candidatePath } },
          reference_packs: { outfit: { bindings: sourcePaths.map((filename) => ({ artifact: { path: filename } })) } },
        } });
        const receipt = await persistAttemptReceipt({
          itemDirectory,
          attempt,
          model,
          runId,
          referenceSetId: item.reference_set_id,
          sources,
          candidatePath,
          candidate,
          qa,
          provider,
          clock: this.clock,
        });
        attempts.push({
          attempt,
          model,
          candidate: { path: candidatePath, sha256: receipt.candidate.sha256 },
          qa,
          provider,
        });
        if (qa.decision === 'PASS') { accepted = { model, candidatePath, image: candidate, qa, provider }; break; }
        // NEEDS_INPUT is reserved for genuinely insufficient raw garment
        // evidence. RETRY and REJECT describe this generated candidate, so both
        // advance through the fixed, bounded image-model route.
        if (qa.decision === 'NEEDS_INPUT') throw new GarmentNeedsInputError(qa.reason, { item, qa, attempts });
      }
      if (!accepted) throw new GarmentRouteExhaustedError('Маршрут підготовки речі вичерпано без проходження перевірки якості', {
        item,
        route: [...this.generationRoute],
        attempts,
      });
      const referenceCardPath = path.join(itemDirectory, 'reference-card.png');
      await atomicWrite(referenceCardPath, accepted.image);
      const cutout = await removeBorderConnectedWhiteToAlpha(accepted.image);
      const cutoutPath = path.join(itemDirectory, 'cutout.png');
      await atomicWrite(cutoutPath, cutout.image);
      await emitVisual({
        stage: 'ITEM_BACKGROUND_REMOVAL',
        subject: {
          kind: 'ITEM',
          index: conditioned.length + 1,
          total: selectedGarments.length,
        },
        presentation: 'MASK_REVEAL',
        truthState: 'DETERMINISTIC_DERIVATIVE',
        title: 'Видаляємо фон попіксельно',
        status: 'Прозорість обчислена з реальних пікселів еталонного зображення',
        layers: [
          {
            role: 'BASE',
            path: referenceCardPath,
            sha256: sha256(accepted.image),
          },
          {
            role: 'CUTOUT',
            path: cutoutPath,
            sha256: sha256(cutout.image),
          },
        ],
        metrics: {
          selected_pixels: cutout.stats.transparent_pixels,
          total_pixels: cutout.stats.width * cutout.stats.height,
          connectivity: cutout.stats.connectivity,
        },
      });
      conditioned.push({ ...item, source_path: sourcePath, source_paths: sourcePaths, reference_card: { path: referenceCardPath, sha256: sha256(accepted.image) },
        cutout: { path: cutoutPath, sha256: sha256(cutout.image), stats: cutout.stats }, attempts, selected_model: accepted.model });
    }
    const primary = conditioned[0];
    const sources = [];
    for (const item of conditioned) {
      for (const [index, sourcePath] of item.source_paths.entries()) sources.push({
        reference_set_id: item.reference_set_id,
        source_index: item.source_indexes[index],
        path: path.resolve(sourcePath),
        sha256: sha256(await readFile(sourcePath)),
      });
    }
    const pack = {
      schema_version: '1.0.0', asset_id: `${runId}-wardrobe`, kind: 'GARMENT',
      source: { path: path.resolve(primary.source_path), sha256: sha256(await readFile(primary.source_path)), immutable: true },
      sources,
      extraction: { method: 'codex_vlm_strict_schema', items: conditioned.map(({ source_index, source_indexes, reference_set_id, same_item_confidence, grouping_evidence, category, confidence, observed, unknowns }) => ({ source_index, source_indexes, reference_set_id, same_item_confidence, grouping_evidence, category, confidence, observed, unknowns })), provenance: 'OBSERVED' },
      readiness: { decision: 'READY', reasons: ['ALL_GARMENTS_CANONICALIZED_AND_QA_PASSED'], actions: [], terminal: false },
      generation_bindings: conditioned.map((item, index) => ({
        order: index + 1,
        binding_id: item.reference_set_id,
        role: `GARMENT_${item.category.toUpperCase()}`,
        path: item.cutout.path,
        sha256: item.cutout.sha256,
      })),
      created_at: this.clock().toISOString(),
    };
    const packPath = path.join(outputDirectory, 'reference-pack.json');
    await atomicWrite(packPath, Buffer.from(`${JSON.stringify(pack, null, 2)}\n`));
    return { passport, items: conditioned, conflicts: [], pack: { path: packPath, document: pack },
      outfitText: compileFullLookText(conditioned) };
  }
}
