const DB_NAME = "cyberlog";
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entries")) {
        const entries = db.createObjectStore("entries", { keyPath: "id" });
        entries.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("media")) {
        db.createObjectStore("media", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function readStore(storeName, id) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = id == null ? tx.objectStore(storeName).getAll() : tx.objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  }));
}

export function listEntries() {
  return readStore("entries").then((entries) => entries || []);
}

export function getEntry(id) {
  return readStore("entries", id).then((entry) => entry || null);
}

export function getMedia(id) {
  return readStore("media", id).then((media) => media || null);
}

export function putLog(entry, media) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["entries", "media"], "readwrite");
    tx.objectStore("entries").put(entry);
    tx.objectStore("media").put(media);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("The archive transaction was aborted."));
  }));
}

export function deleteLog(id) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["entries", "media"], "readwrite");
    tx.objectStore("entries").delete(id);
    tx.objectStore("media").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("The archive transaction was aborted."));
  }));
}
