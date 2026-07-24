const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function descriptor(value, { requireDigest = true } = {}) {
  if (!value || typeof value !== 'object') return null;
  const normalized = {
    id: typeof value.id === 'string' ? value.id : '',
    sha256: typeof value.sha256 === 'string' ? value.sha256.toLowerCase() : null,
    size: Number(value.size),
    mimetype: typeof value.mimetype === 'string' ? value.mimetype : '',
  };
  if (!normalized.id
    || (requireDigest && !SHA256_PATTERN.test(normalized.sha256 ?? ''))
    || !Number.isSafeInteger(normalized.size)
    || normalized.size < 1
    || !MIME_TYPES.has(normalized.mimetype)) {
    throw new Error('Сервер повернув некоректний опис файла чернетки');
  }
  return normalized;
}

export function draftBindingsFromManifest(manifest, { requireDigest = true } = {}) {
  return {
    person: descriptor(manifest?.person, { requireDigest }),
    identity: descriptor(manifest?.identity, { requireDigest }),
    garments: (manifest?.garments ?? []).map((item) => descriptor(item, { requireDigest })),
  };
}

export function draftRefsFromBindings(bindings) {
  return {
    person: bindings.person?.id ?? null,
    identity: bindings.identity?.id ?? null,
    garments: bindings.garments.map((item) => item.id),
  };
}

export function finalizationFileManifest(bindings) {
  const copy = (item) => item ? descriptor(item) : null;
  return {
    version: 1,
    person: copy(bindings.person),
    identity: copy(bindings.identity),
    garments: bindings.garments.map(copy),
  };
}

export function sameDraftFile(left, right) {
  return Boolean(left && right
    && left.sha256 === right.sha256
    && left.size === right.size
    && left.mimetype === right.mimetype);
}

export async function sha256Blob(blob, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Browser не підтримує безпечну перевірку файлів');
  const hash = await cryptoApi.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function desiredDescriptor(value) {
  if (!value) return null;
  if (!value.file || typeof value.file.arrayBuffer !== 'function') {
    throw new Error('Локальний файл чернетки недоступний');
  }
  return {
    file: value.file,
    sourceName: value.sourceName || value.file.name,
    sha256: value.sha256,
    size: value.size,
    mimetype: value.mimetype,
  };
}

function assertUploadedFile(uploaded, desired) {
  const normalized = descriptor(uploaded);
  if (!sameDraftFile(normalized, desired)) {
    throw new Error('Сервер зберіг інші байти, ніж вибрані в браузері');
  }
  return normalized;
}

/**
 * Reconciles one ordered browser selection against one server draft snapshot.
 * Files are compared by exact prepared bytes, never by count or filename.
 * A failed DELETE is propagated and the caller must reload server truth.
 */
export async function reconcileDraftFileBindings({
  desired,
  current,
  upload,
  remove,
}) {
  const wanted = {
    person: desiredDescriptor(desired.person),
    identity: desiredDescriptor(desired.identity),
    garments: desired.garments.map(desiredDescriptor),
  };
  const actual = {
    person: current.person ? descriptor(current.person, { requireDigest: false }) : null,
    identity: current.identity ? descriptor(current.identity, { requireDigest: false }) : null,
    garments: current.garments.map((item) => descriptor(item, { requireDigest: false })),
  };

  const reconcileSingleton = async (slot) => {
    const local = wanted[slot];
    const remote = actual[slot];
    if (!local) {
      if (remote) await remove(slot, remote.id);
      return null;
    }
    if (sameDraftFile(local, remote)) return remote;
    return assertUploadedFile(await upload(slot, local), local);
  };

  const person = await reconcileSingleton('person');
  const identity = await reconcileSingleton('identity');

  let prefixLength = 0;
  while (prefixLength < wanted.garments.length
    && prefixLength < actual.garments.length
    && sameDraftFile(wanted.garments[prefixLength], actual.garments[prefixLength])) {
    prefixLength += 1;
  }

  const garments = actual.garments.slice(0, prefixLength);
  for (let index = actual.garments.length - 1; index >= prefixLength; index -= 1) {
    await remove('garment', actual.garments[index].id);
  }
  for (const local of wanted.garments.slice(prefixLength)) {
    garments.push(assertUploadedFile(await upload('garment', local), local));
  }

  return { person, identity, garments };
}
