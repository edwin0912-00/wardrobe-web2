import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { normalizeWhitePngBytes } from '../qa/white-normalizer.mjs';
import { removeBorderConnectedWhiteToAlpha } from '../conditioning/transparent-cutout.mjs';
import { IMAGE_MODEL_ROUTE } from '../runner/model-policy.js';
import { compileFullLookText, findGarmentConflicts, garmentLocks, groupGarmentViews } from './garment-passport.js';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function atomicWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filename);
}
function canonicalPrompt(item) {
  const locks = garmentLocks(item).map((value) => `- ${value}`).join('\n');
  return `Create a canonical ecommerce reference of the exact same primary wardrobe item visible across the input views. Every input is evidence for the same garment. Show the complete item alone, centered and front-facing, on uniform pure #FFFFFF. Remove the person, hands, hanger, room, floor, props and shadows. Preserve every observable color, material, pattern, seam, closure, logo, text and construction detail exactly. Do not invent hidden details, branding or decoration. If part of the item is obscured, use the most conservative structurally neutral completion.\n\nOBSERVED LOCKS:\n${locks}`;
}

export class GarmentNeedsInputError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'GarmentNeedsInputError'; this.details = details; }
}

export class GarmentRouteExhaustedError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'GarmentRouteExhaustedError'; this.details = details; }
}

export class GarmentConditioner {
  constructor({ vlm, generator, clock = () => new Date() }) { this.vlm = vlm; this.generator = generator; this.clock = clock; }

  async condition({ imagePaths, outputDirectory, runId, passport: savedPassport = null, selections = {}, onProgress = async () => {} }) {
    const passport = savedPassport ?? await this.vlm.inspectGarments(imagePaths);
    await onProgress('GARMENT_GROUPING', 'Garment views classified and grouped');
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
    if (conflicts.length) throw new GarmentNeedsInputError('Garment slot conflicts require explicit selection', { passport, conflicts });
    const conditioned = [];
    const selectedGarments = groupGarmentViews(items, referenceSets);
    for (const item of selectedGarments) {
      if (item.blockers.length) throw new GarmentNeedsInputError('Garment contains blocking unknowns', { item });
      const sourcePaths = item.source_indexes.map((index) => imagePaths[index]);
      const sourcePath = sourcePaths[0];
      const itemDirectory = path.join(outputDirectory, String(item.source_index + 1).padStart(2, '0'));
      let accepted;
      const attempts = [];
      for (const [routeIndex, model] of IMAGE_MODEL_ROUTE.entries()) {
        await onProgress('GARMENT_GENERATING', `Generating canonical garment ${conditioned.length + 1} of ${selectedGarments.length}`);
        const generated = await this.generator.generateGarment({
          sourcePath, sourcePaths, model, prompt: canonicalPrompt(item), workDirectory: itemDirectory,
          operationId: `${runId}-garment-${item.source_index}-${routeIndex + 1}`,
        });
        // Canonical garment cards are intentionally opaque white. Flattening is
        // explicit here (and nowhere in core avatar QA) before deterministic
        // border-connected white normalization and cutout creation.
        const opaqueCandidate = await sharp(generated.image).flatten({ background: '#ffffff' }).png().toBuffer();
        const normalized = await normalizeWhitePngBytes(opaqueCandidate);
        const candidatePath = path.join(itemDirectory, `candidate-${routeIndex + 1}.png`);
        await atomicWrite(candidatePath, normalized.image);
        await onProgress('GARMENT_QA', `Checking canonical garment ${conditioned.length + 1}`);
        const qa = await this.vlm.evaluateQa({ phase: 'garment', evidence: {
          identity: { artifact: { path: sourcePath } }, candidate: { artifact: { path: candidatePath } },
          reference_packs: { outfit: { bindings: sourcePaths.map((filename) => ({ artifact: { path: filename } })) } },
        } });
        attempts.push({
          attempt: routeIndex + 1,
          model,
          candidate: { path: candidatePath, sha256: sha256(normalized.image) },
          qa,
          provider: generated.metadata ?? {},
        });
        if (qa.decision === 'PASS') { accepted = { model, candidatePath, image: normalized.image, qa, provider: generated.metadata ?? {} }; break; }
        // NEEDS_INPUT is reserved for genuinely insufficient raw garment
        // evidence. RETRY and REJECT describe this generated candidate, so both
        // advance through the fixed, bounded image-model route.
        if (qa.decision === 'NEEDS_INPUT') throw new GarmentNeedsInputError(qa.reason, { item, qa, attempts });
      }
      if (!accepted) throw new GarmentRouteExhaustedError('Garment canonicalization exhausted the quality route', {
        item,
        route: [...IMAGE_MODEL_ROUTE],
        attempts,
      });
      const referenceCardPath = path.join(itemDirectory, 'reference-card.png');
      await atomicWrite(referenceCardPath, accepted.image);
      const cutout = await removeBorderConnectedWhiteToAlpha(accepted.image);
      const cutoutPath = path.join(itemDirectory, 'cutout.png');
      await atomicWrite(cutoutPath, cutout.image);
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
      generation_bindings: conditioned.map((item, index) => ({ order: index + 1, role: `GARMENT_${item.category.toUpperCase()}`, path: item.cutout.path, sha256: item.cutout.sha256 })),
      created_at: this.clock().toISOString(),
    };
    const packPath = path.join(outputDirectory, 'reference-pack.json');
    await atomicWrite(packPath, Buffer.from(`${JSON.stringify(pack, null, 2)}\n`));
    return { passport, items: conditioned, conflicts: [], pack: { path: packPath, document: pack },
      outfitText: compileFullLookText(conditioned) };
  }
}
