/*
 * The cinematic form deliberately does not upload a person's photographs until
 * they press “Створити образ”.  Browser File objects vanish on a reload,
 * however, which made a harmless deploy/reload look like the site had erased
 * the form.  Keep the prepared image bytes locally in IndexedDB instead.
 *
 * This is device-local only: there is no network request, no account record and
 * no generation side effect.  The draft is erased as soon as beta accepts the
 * real run, or when the user removes the final input.
 */

const DB_NAME = 'wardrobe-cinematic-draft-media-v1';
const STORE_NAME = 'drafts';
const CURRENT_DRAFT_KEY = 'current';
const SCHEMA_VERSION = 1;

function database(indexedDBImpl = globalThis.indexedDB) {
  if (!indexedDBImpl || typeof indexedDBImpl.open !== 'function') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDBImpl.open(DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('DRAFT_MEDIA_DB_OPEN_FAILED'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('DRAFT_MEDIA_TRANSACTION_ABORTED'));
    transaction.onerror = () => reject(transaction.error || new Error('DRAFT_MEDIA_TRANSACTION_FAILED'));
  });
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('DRAFT_MEDIA_READ_FAILED'));
  });
}

function close(db) {
  if (db && typeof db.close === 'function') db.close();
}

export function storedFile(file) {
  if (!file || typeof file.name !== 'string' || !(file instanceof Blob)) return null;
  return {
    blob: file,
    name: file.name,
    type: file.type || 'application/octet-stream',
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now(),
  };
}

export function fileFromStored(record, FileImpl = globalThis.File) {
  if (!record || !(record.blob instanceof Blob) || typeof FileImpl !== 'function') return null;
  return new FileImpl([record.blob], record.name || 'image', {
    type: record.type || record.blob.type || 'application/octet-stream',
    lastModified: Number.isFinite(record.lastModified) ? record.lastModified : Date.now(),
  });
}

/* Exported separately so the schema stays testable without a browser database. */
export function serializeDraftMedia({ main = null, face = null, items = [] } = {}) {
  const serializedItems = Array.isArray(items) ? items.map((item) => ({
    name: typeof item?.name === 'string' ? item.name : 'Річ',
    file: storedFile(item?.file),
  })).filter((item) => item.file || item.name) : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: Date.now(),
    main: storedFile(main),
    face: storedFile(face),
    items: serializedItems,
  };
}

export function deserializeDraftMedia(record, FileImpl = globalThis.File) {
  if (!record || record.schemaVersion !== SCHEMA_VERSION) return null;
  const main = fileFromStored(record.main, FileImpl);
  const face = fileFromStored(record.face, FileImpl);
  const items = (Array.isArray(record.items) ? record.items : []).map((item) => ({
    name: typeof item?.name === 'string' ? item.name : 'Річ',
    file: fileFromStored(item?.file, FileImpl),
  })).filter((item) => item.file || item.name);
  if (!main && !face && !items.length) return null;
  return { main, face, items };
}

export async function saveDraftMedia(draft, { indexedDBImpl = globalThis.indexedDB } = {}) {
  const db = await database(indexedDBImpl);
  if (!db) return false;
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(serializeDraftMedia(draft), CURRENT_DRAFT_KEY);
    await transactionDone(transaction);
    return true;
  } finally {
    close(db);
  }
}

export async function loadDraftMedia({ indexedDBImpl = globalThis.indexedDB, FileImpl = globalThis.File } = {}) {
  const db = await database(indexedDBImpl);
  if (!db) return null;
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const record = await readRequest(transaction.objectStore(STORE_NAME).get(CURRENT_DRAFT_KEY));
    await transactionDone(transaction);
    return deserializeDraftMedia(record, FileImpl);
  } finally {
    close(db);
  }
}

export async function clearDraftMedia({ indexedDBImpl = globalThis.indexedDB } = {}) {
  const db = await database(indexedDBImpl);
  if (!db) return false;
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(CURRENT_DRAFT_KEY);
    await transactionDone(transaction);
    return true;
  } finally {
    close(db);
  }
}
