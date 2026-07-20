const DB_NAME = "robo-flow-stock-lotte";
const STORE_NAME = "files";
const FILE_KEY = "active-workbook";

export type StoredStockWorkbook = {
  name: string;
  type: string;
  lastModified: number;
  bytes: ArrayBuffer;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStockWorkbook(file: File) {
  const db = await openDb();
  const value: StoredStockWorkbook = {
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    bytes: await file.arrayBuffer(),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, FILE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function loadStockWorkbook(): Promise<File | null> {
  const db = await openDb();
  const value = await new Promise<StoredStockWorkbook | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(FILE_KEY);
    request.onsuccess = () => resolve(request.result as StoredStockWorkbook | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value ? new File([value.bytes], value.name, { type: value.type, lastModified: value.lastModified }) : null;
}

export async function clearStockWorkbook() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(FILE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
