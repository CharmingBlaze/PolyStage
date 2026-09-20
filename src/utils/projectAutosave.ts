import type { PolyStageProject } from './projectDocument';
import { parseProjectDocument, serializeProject } from './projectDocument';

const DB_NAME = 'polystage';
const STORE = 'autosave';
const KEY = 'session';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function writeAutosave(project: PolyStageProject): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('autosave write failed'));
    tx.objectStore(STORE).put(serializeProject(project), KEY);
  });
  db.close();
}

export async function readAutosave(): Promise<PolyStageProject | null> {
  try {
    const db = await openDb();
    const raw = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error || new Error('autosave read failed'));
    });
    db.close();
    if (!raw) return null;
    return parseProjectDocument(raw).project;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('autosave clear failed'));
      tx.objectStore(STORE).delete(KEY);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function hasAutosave(): Promise<boolean> {
  const doc = await readAutosave();
  return Boolean(doc?.scenes?.length);
}
