import { createHash } from 'node:crypto';
import { sanitizeExternalPrompt } from '../providers/provider-prompt-privacy.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sanitizeApprovedItemFact(value) {
  return sanitizeExternalPrompt(String(value ?? ''))
    .replace(/\b(api[_ -]?key|access[_ -]?token|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=REDACTED')
    .replace(/\b(?:sk|hf|ghp|glpat|ek_live|AIza)[-_A-Za-z0-9]{8,}\b/g, 'REDACTED')
    .replace(/\bhttps?:\/\/[^\s,;]+/gi, 'EXTERNAL_REFERENCE')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function compileApprovedItemFacts(item) {
  const observed = item?.observed ?? {};
  const fields = [
    ['type', observed.garment_type],
    ['colors', observed.colors],
    ['materials', observed.material],
    ['patterns', observed.pattern],
    ['logos_and_text', observed.logo_text],
    ['construction', observed.construction],
  ];
  return fields
    .map(([key, value]) => {
      const values = Array.isArray(value) ? value : [value];
      const text = values
        .filter((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '')
        .map(sanitizeApprovedItemFact)
        .join(' | ');
      return `${key}=${text || 'none observed'}`;
    })
    .join('; ');
}

export function approvedItemFactsSha256(item) {
  return sha256(Buffer.from(compileApprovedItemFacts(item)));
}

export function approvedItemLogicalRecord(item) {
  return {
    order: item.order,
    role: item.role,
    category: item.category,
    reference_set_id: item.reference_set_id,
    source_indexes: [...item.source_indexes],
    ...(item.same_item_confidence === undefined ? {} : {
      same_item_confidence: item.same_item_confidence,
    }),
    ...(item.grouping_evidence === undefined ? {} : {
      grouping_evidence: [...item.grouping_evidence],
    }),
    confidence: item.confidence,
    observed: {
      garment_type: item.observed.garment_type,
      colors: [...item.observed.colors],
      material: [...item.observed.material],
      pattern: [...item.observed.pattern],
      logo_text: [...item.observed.logo_text],
      construction: [...item.observed.construction],
    },
    unknowns: [...item.unknowns],
    sha256: item.sha256,
    media_type: item.media_type,
    facts_sha256: approvedItemFactsSha256(item),
  };
}

export function approvedItemEvidenceDocument(evidence) {
  if (evidence === null || evidence === undefined) return null;
  return {
    schema_version: evidence.schema_version,
    kind: evidence.kind,
    source_run_id: evidence.source_run_id,
    reference_pack: structuredClone(evidence.reference_pack),
    items: evidence.items.map(approvedItemLogicalRecord),
  };
}
