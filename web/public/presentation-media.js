// A page may display many outputs at once.  Every API image used as a visual
// preview asks the server for a bounded WebP derivative; the original URL is
// still used only by explicit Download actions and remains the QA source.
export function presentationImageUrl(value) {
  if (typeof value !== 'string' || !value) return value;
  if (!value.startsWith('/api/')) return value;
  const [path, hash = ''] = value.split('#', 2);
  const separator = path.includes('?') ? '&' : '?';
  if (/(?:[?&])preview=1(?:&|$)/.test(path)) return value;
  return `${path}${separator}preview=1${hash ? `#${hash}` : ''}`;
}
