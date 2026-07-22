const PRIVATE_BRAND = /(?:zeely|madeforthisjob)/giu;
const POSIX_PRIVATE_PATH = /(?<![:\/\p{L}\p{N}_])\/(?:[^\s"'<>:,;!?)}\]]+\/)*[^\s"'<>:,;!?)}\]]+/giu;
const WINDOWS_PRIVATE_PATH = /\b[A-Za-z]:\\(?:[^\\\s"'<>:,;!?)}\]]+\\)*[^\\\s"'<>:,;!?)}\]]+/gu;

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function safeText(value) {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(POSIX_PRIVATE_PATH, '[private-path]')
    .replace(WINDOWS_PRIVATE_PATH, '[private-path]')
    .replace(PRIVATE_BRAND, 'application');
}

function safeScalar(value) {
  if (typeof value === 'string') return safeText(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null) return null;
  return undefined;
}

function privateKey(key) {
  const normalized = String(key)
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  return normalized === 'text'
    || normalized === 'path'
    || normalized.endsWith('_path')
    || normalized === 'directory'
    || normalized.endsWith('_directory')
    || normalized === 'root'
    || normalized.endsWith('_root')
    || normalized.includes('prompt')
    || normalized.includes('journal')
    || normalized === 'argv'
    || normalized === 'command'
    || normalized === 'url'
    || normalized.endsWith('_url')
    || normalized === 'uri'
    || normalized.endsWith('_uri');
}

function safeStructuredValue(value) {
  const scalar = safeScalar(value);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(value)) {
    return value
      .map((item) => safeStructuredValue(item))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !privateKey(key))
    .map(([key, item]) => [safeText(key), safeStructuredValue(item)])
    .filter(([, item]) => item !== undefined));
}

function artifactView(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return undefined;
  return compact({
    digest: safeText(artifact.digest),
    sha256: safeText(artifact.sha256),
    size: safeScalar(artifact.size),
    mediaType: safeText(artifact.mediaType),
    media_type: safeText(artifact.media_type),
    extension: safeText(artifact.extension),
  });
}

function normalizationView(normalization) {
  if (!normalization || typeof normalization !== 'object' || Array.isArray(normalization)) return undefined;
  const lineage = normalization.lineage && typeof normalization.lineage === 'object'
    ? compact({
      parent_sha256: safeText(normalization.lineage.parent_sha256),
      operation: safeText(normalization.lineage.operation),
      parameters: safeStructuredValue(normalization.lineage.parameters),
      output_sha256: safeText(normalization.lineage.output_sha256),
    })
    : undefined;
  return compact({
    schema_version: safeText(normalization.schema_version),
    phase: safeText(normalization.phase),
    attempt: safeScalar(normalization.attempt),
    wrote_output: safeScalar(normalization.wrote_output),
    stats: safeStructuredValue(normalization.stats),
    lineage,
    evidence_artifact: artifactView(normalization.evidence_artifact),
  });
}

function imageArtifactView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return compact({
    approved_reuse: safeScalar(value.approved_reuse),
    imported: artifactView(value.imported),
    provenance: safeStructuredValue(value.provenance),
    provider_original: artifactView(value.provider_original),
    normalized: artifactView(value.normalized),
    normalization: normalizationView(value.normalization),
  });
}

function qaCheckView(check) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) return undefined;
  return compact({
    name: safeText(check.name),
    pass: safeScalar(check.pass),
    score: safeScalar(check.score),
    evidence: safeText(check.evidence),
  });
}

function qaView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return compact({
    decision: safeText(value.decision),
    reason: safeText(value.reason),
    attempt: safeScalar(value.attempt),
    model: safeText(value.model),
    model_name: safeText(value.model_name),
    provider: safeText(value.provider),
    reused: safeScalar(value.reused),
    source_run_id: safeText(value.source_run_id),
    avatar_sha256: safeText(value.avatar_sha256),
    receipt_sha256: safeText(value.receipt_sha256),
    checks: Array.isArray(value.checks) ? value.checks.map(qaCheckView).filter(Boolean) : undefined,
    defects: Array.isArray(value.defects) ? safeStructuredValue(value.defects) : undefined,
    artifact: artifactView(value.artifact),
  });
}

function namedViews(values, view) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  return Object.fromEntries(Object.entries(values)
    .filter(([key]) => !privateKey(key))
    .map(([key, value]) => [safeText(key), view(value)])
    .filter(([, value]) => value !== undefined));
}

function outputView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return compact({
    sha256: safeText(value.sha256 ?? value.digest),
    media_type: safeText(value.media_type ?? value.mediaType),
  });
}

function modelView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return compact({
    name: safeText(value.name),
    job_set_type: safeText(value.job_set_type),
    reused: safeScalar(value.reused),
    source_run_id: safeText(value.source_run_id),
  });
}

function promptReceiptView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return compact({
    phase: safeText(value.phase),
    attempt: safeScalar(value.attempt),
    sha256: safeText(value.sha256 ?? value.digest),
  });
}

/**
 * Pure, allowlisted projection for both newly exported receipts and historical
 * receipts served over HTTP. The hash-bound internal receipt remains untouched.
 */
export function publicManifestView(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('Run manifest must be a JSON object');
  }
  return compact({
    schema_version: safeText(manifest.schema_version),
    run_id: safeText(manifest.run_id),
    job_id: safeText(manifest.job_id),
    job_hash: safeText(manifest.job_hash),
    execution_hash: safeText(manifest.execution_hash),
    state: safeText(manifest.state),
    outputs: namedViews(manifest.outputs, outputView),
    attempts: safeStructuredValue(manifest.attempts),
    models: namedViews(manifest.models, modelView),
    image_artifacts: namedViews(manifest.image_artifacts, imageArtifactView),
    prompts: namedViews(manifest.prompts, promptReceiptView),
    qa: namedViews(manifest.qa, qaView),
  });
}
