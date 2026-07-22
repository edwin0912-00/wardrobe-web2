import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageModelName } from '../runner/model-policy.js';

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function mediaType(filename) {
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(filename).toLowerCase()];
}

export class HiggsfieldAssetGenerator {
  constructor({ provider }) { this.provider = provider; }

  async #generate({ phase, model, prompt, references, workDirectory, operationId }) {
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
    const idempotencyKey = digest(`${operationId}:${phase}:${model}:${prompt}:${ordered.map((item) => item.sha256).join(':')}`);
    return this.provider.generate({
      operation: 'generate', phase, attempt: 1, model, model_name: imageModelName(model), job_set_type: model,
      prompt, references: { ordered }, idempotencyKey, jobId: operationId, workDirectory,
    });
  }

  generateGarment({ sourcePath, sourcePaths = sourcePath ? [sourcePath] : [], model, prompt, workDirectory, operationId }) {
    return this.#generate({ phase: 'garment', model, prompt, workDirectory, operationId,
      references: sourcePaths.map((filename, index) => ({ path: filename, scope: 'outfit', role: `GARMENT_RAW_VIEW_${index + 1}`, source: 'CONDITIONED' })) });
  }

  generateScene({ approvedOutfitPath, model, prompt, workDirectory, operationId }) {
    return this.#generate({ phase: 'scene', model, prompt, workDirectory, operationId,
      references: [{ path: approvedOutfitPath, scope: 'avatar', role: 'APPROVED_OUTFIT', source: 'APPROVED_AVATAR' }] });
  }
}
