import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageModelName } from '../runner/model-policy.js';
import { resolveImageGenerationMode } from '../providers/image-generation-mode.js';

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function mediaType(filename) {
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(filename).toLowerCase()];
}

export class ImageAssetGenerator {
  constructor({ provider }) { this.provider = provider; }

  async #generate({ phase, model, generationProfile = null, prompt, references, workDirectory, operationId, imageGenerationMode = 'slow' }) {
    const mode = resolveImageGenerationMode(imageGenerationMode);
    const ordered = [];
    for (const [index, reference] of references.entries()) {
      const filename = path.resolve(reference.path);
      ordered.push({
        order: index + 1,
        scope: reference.scope,
        role: reference.role,
        path: filename,
        sha256: digest(await readFile(filename)),
        mediaType: mediaType(filename),
        source: reference.source,
      });
    }
    // A retry may deliberately use the same model with a different immutable
    // quality/resolution profile. It must never coalesce with the earlier
    // provider request merely because the model name is identical.
    const profileIdentity = generationProfile
      ? `${generationProfile.id}:${generationProfile.resolution}:${generationProfile.quality ?? ''}`
      : 'legacy-default-profile';
    const requestIdentity = `${operationId}:${phase}:${model}:${profileIdentity}:${prompt}:${ordered.map((item) => item.sha256).join(':')}`;
    const idempotencyKey = digest(mode === 'fast' ? `${requestIdentity}:image-mode:fast` : requestIdentity);
    return this.provider.generate({
      operation: 'generate', phase, attempt: 1, model, model_name: imageModelName(model), job_set_type: model,
      prompt, references: { ordered }, idempotencyKey, jobId: operationId, workDirectory,
      imageGenerationMode: mode,
      ...(generationProfile ? {
        generation_profile: generationProfile,
        resolution: generationProfile.resolution,
        quality: generationProfile.quality,
      } : {}),
    });
  }

  generateGarment({ sourcePath, sourcePaths = sourcePath ? [sourcePath] : [], model, generationProfile = null, prompt, workDirectory, operationId, imageGenerationMode = 'slow' }) {
    return this.#generate({ phase: 'garment', model, generationProfile, prompt, workDirectory, operationId,
      imageGenerationMode,
      references: sourcePaths.map((filename, index) => ({ path: filename, scope: 'outfit', role: `GARMENT_RAW_VIEW_${index + 1}`, source: 'CONDITIONED' })) });
  }

  generateScene({ approvedOutfitPath, model, generationProfile = null, prompt, workDirectory, operationId, imageGenerationMode = 'slow' }) {
    return this.#generate({ phase: 'scene', model, generationProfile, prompt, workDirectory, operationId,
      imageGenerationMode,
      references: [{ path: approvedOutfitPath, scope: 'avatar', role: 'APPROVED_OUTFIT', source: 'APPROVED_AVATAR' }] });
  }
}
