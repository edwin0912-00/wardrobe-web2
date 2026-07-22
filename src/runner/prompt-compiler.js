import { readFile } from 'node:fs/promises';

function render(template, bindings) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name) => {
    if (!(name in bindings)) throw new Error(`Missing prompt binding: ${name}`);
    const value = bindings[name];
    if (Array.isArray(value)) return value.map((item) => `- ${item}`).join('\n');
    return String(value ?? 'NONE');
  });
}

export async function compileAvatarPrompt(job, conditionedIdentity) {
  const template = await readFile(job.prompts.avatar, 'utf8');
  return render(template, {
    IDENTITY_REFERENCE: conditionedIdentity.artifact.path,
  });
}

export async function compileOutfitPrompt(job, { conditionedIdentity, conditionedOutfit, avatar }) {
  const template = await readFile(job.prompts.outfit, 'utf8');
  return render(template, {
    IDENTITY_REFERENCE: conditionedIdentity.artifact.path,
    ORIGINAL_IDENTITY_REFERENCE: conditionedIdentity.artifact.path,
    APPROVED_AVATAR_REFERENCE: avatar.artifact.path,
    OUTFIT_REFERENCE: conditionedOutfit.artifact?.path ?? 'TEXT_ONLY',
    SUPPORTING_TEXT: job.outfit.text ?? 'NONE',
    TARGET_REGION: job.outfit.target_region ?? conditionedOutfit.facts?.target_region ?? 'outfit_region',
    MUST_MATCH: job.outfit.must_match ?? conditionedOutfit.facts?.must_match ?? [],
    OUTFIT_TEXT: job.outfit.text ?? 'NONE',
  });
}
