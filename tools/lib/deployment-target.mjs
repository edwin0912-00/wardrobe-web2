// This module owns the single public endpoint that may attest a release or
// recovery.  Callers must not derive, normalize, or substitute this target.
export const CANONICAL_EXTERNAL_HEALTH_URL = 'https://beta.madeforthisjob.com/api/health';

export function assertCanonicalExternalHealthUrl(value) {
  if (value !== CANONICAL_EXTERNAL_HEALTH_URL) {
    throw new Error(
      `--external-health-url must equal ${CANONICAL_EXTERNAL_HEALTH_URL}`,
    );
  }
  return CANONICAL_EXTERNAL_HEALTH_URL;
}
