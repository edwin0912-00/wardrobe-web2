const DB_NAME = 'zeely-upload-draft';
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'current';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(mode, action) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => database.close();
    tx.onabort = () => reject(tx.error);
  }));
}

function packFile(file) {
  if (!file) return null;
  return { blob: file.slice(0, file.size, file.type), name: file.name, type: file.type, lastModified: file.lastModified };
}

function unpackFile(value) {
  if (!value?.blob) return null;
  return new File([value.blob], value.name, { type: value.type, lastModified: value.lastModified });
}

export async function saveDraft({ person, identityDetail, garments, outfitText, generateScene }) {
  const value = {
    version: 1,
    savedAt: new Date().toISOString(),
    person: packFile(person),
    identityDetail: packFile(identityDetail),
    garments: garments.map(packFile),
    outfitText,
    generateScene,
  };
  await transaction('readwrite', (store) => store.put(value, DRAFT_KEY));
  return value.savedAt;
}

export async function loadDraft() {
  const value = await transaction('readonly', (store) => store.get(DRAFT_KEY));
  if (!value) return null;
  return {
    savedAt: value.savedAt,
    person: unpackFile(value.person),
    identityDetail: unpackFile(value.identityDetail),
    garments: (value.garments || []).map(unpackFile).filter(Boolean),
    outfitText: value.outfitText || '',
    generateScene: value.generateScene !== false,
  };
}

export async function clearDraft() {
  await transaction('readwrite', (store) => store.delete(DRAFT_KEY));
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
