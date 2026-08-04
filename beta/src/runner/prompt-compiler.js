import { readFile } from 'node:fs/promises';
import { assertExternalPromptPrivacy, sanitizeExternalPrompt } from '../providers/provider-prompt-privacy.js';

function render(template, bindings) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name) => {
    if (!(name in bindings)) throw new Error(`Missing prompt binding: ${name}`);
    const value = bindings[name];
    if (Array.isArray(value)) return value.map((item) => `- ${item}`).join('\n');
    return String(value ?? 'NONE');
  });
}

function safeRole(value, scope, order) {
  const normalized = String(value ?? '')
    .toUpperCase()
    .replace(/ZEELY/g, 'REFERENCE')
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || `${String(scope ?? 'REFERENCE').toUpperCase()}_${order}`;
}

function orderedAttachments(references, fallback) {
  const supplied = Array.isArray(references?.ordered) && references.ordered.length > 0
    ? references.ordered
    : fallback;
  return supplied.map((reference, index) => {
    const order = index + 1;
    return {
      order,
      scope: reference.scope,
      role: safeRole(reference.role, reference.scope, order),
      label: `ATTACHMENT_${order} [${safeRole(reference.role, reference.scope, order)}]`,
    };
  });
}

function labelsFor(attachments, scope, fallback) {
  const labels = attachments.filter((item) => item.scope === scope).map((item) => item.label);
  return labels.length > 0 ? labels.join(', ') : fallback;
}

function compile(template, bindings) {
  const prompt = sanitizeExternalPrompt(render(template, bindings));
  return assertExternalPromptPrivacy(prompt);
}

export async function compileAvatarPrompt(job, conditionedIdentity, references = null) {
  const template = await readFile(job.prompts.avatar, 'utf8');
  const attachments = orderedAttachments(references, [{ scope: 'identity', role: 'IDENTITY_PRIMARY' }]);
  return compile(template, {
    REFERENCE_BINDINGS: attachments.map((item) => item.label),
    IDENTITY_REFERENCE: labelsFor(attachments, 'identity', 'ATTACHMENT_1 [IDENTITY_PRIMARY]'),
  });
}

export async function compileOutfitPrompt(job, { conditionedIdentity, conditionedOutfit, avatar, references = null }) {
  const template = await readFile(job.prompts.outfit, 'utf8');
  const fallback = [
    { scope: 'avatar', role: 'AVATAR_BASE' },
    { scope: 'identity', role: 'IDENTITY_PRIMARY' },
    ...(conditionedOutfit.artifact ? [{ scope: 'outfit', role: 'GARMENT_PRIMARY' }] : []),
  ];
  const attachments = orderedAttachments(references, fallback);
  return compile(template, {
    REFERENCE_BINDINGS: attachments.map((item) => item.label),
    IDENTITY_REFERENCE: labelsFor(attachments, 'identity', 'ATTACHMENT_2 [IDENTITY_PRIMARY]'),
    ORIGINAL_IDENTITY_REFERENCE: labelsFor(attachments, 'identity', 'ATTACHMENT_2 [IDENTITY_PRIMARY]'),
    APPROVED_AVATAR_REFERENCE: labelsFor(attachments, 'avatar', 'ATTACHMENT_1 [AVATAR_BASE]'),
    OUTFIT_REFERENCE: labelsFor(attachments, 'outfit', 'TEXT_ONLY — no outfit image attachment'),
    SUPPORTING_TEXT: job.outfit.text ?? 'NONE',
    TARGET_REGION: job.outfit.target_region ?? conditionedOutfit.facts?.target_region ?? 'outfit_region',
    MUST_MATCH: job.outfit.must_match ?? conditionedOutfit.facts?.must_match ?? [],
    OUTFIT_TEXT: job.outfit.text ?? 'NONE',
  });
}

export async function compileRepairPrompt(job, {
  defectDescription,
  repairRegion,
} = {}) {
  if (!job.prompts.repair) throw new Error('Repair prompt template is not configured');
  const template = await readFile(job.prompts.repair, 'utf8');
  return compile(template, {
    DEFECT_DESCRIPTION: defectDescription ?? 'blocking visual defect',
    REPAIR_REGION: repairRegion ?? 'declared repair region',
  });
}
