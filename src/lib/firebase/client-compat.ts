/**
 * Firestore + Storage compat layer using the Firebase Web SDK on the server.
 * Used when FIREBASE_SERVICE_ACCOUNT_JSON is not set (no-auth open rules mode).
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QueryConstraint,
  type WhereFilterOp,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref,
  type FirebaseStorage,
} from "firebase/storage";
import {
  getServerFirestore,
  getServerStorage,
} from "@/lib/firebase/server-firebase";

type OrderDirection = "asc" | "desc";

type QueryPart =
  | { type: "where"; field: string; op: WhereFilterOp; value: unknown }
  | { type: "orderBy"; field: string; direction: OrderDirection }
  | { type: "limit"; count: number };

export function useClientSdkOnServer(): boolean {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true") return false;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) return false;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return false;
  return true;
}

function toConstraints(parts: QueryPart[]): QueryConstraint[] {
  return parts.map((part) => {
    if (part.type === "where") {
      return where(part.field, part.op, part.value);
    }
    if (part.type === "orderBy") {
      return orderBy(part.field, part.direction);
    }
    return limit(part.count);
  });
}

function pathToSegments(path: string[]): [string, ...string[]] {
  if (path.length === 0) {
    throw new Error("Firestore path cannot be empty.");
  }
  return path as [string, ...string[]];
}

class CompatDocumentReference {
  constructor(
    private readonly firestore: Firestore,
    private readonly pathSegments: string[],
    readonly id: string
  ) {}

  get ref(): CompatDocumentReference {
    return this;
  }

  collection(name: string): CompatCollectionReference {
    return new CompatCollectionReference(this.firestore, [
      ...this.pathSegments,
      this.id,
      name,
    ]);
  }

  toDocRef() {
    return doc(this.firestore, ...pathToSegments([...this.pathSegments, this.id]));
  }

  async get() {
    const snap = await getDoc(this.toDocRef());
    return {
      exists: snap.exists(),
      id: snap.id,
      data: () => snap.data(),
      ref: this,
    };
  }

  async set(data: Record<string, unknown>) {
    await setDoc(this.toDocRef(), data);
  }

  async update(data: Record<string, unknown>) {
    await updateDoc(this.toDocRef(), data);
  }

  async delete() {
    await deleteDoc(this.toDocRef());
  }
}

class CompatQuery {
  constructor(
    private readonly firestore: Firestore,
    private readonly pathSegments: string[],
    private readonly parts: QueryPart[]
  ) {}

  where(field: string, op: WhereFilterOp, value: unknown) {
    return new CompatQuery(this.firestore, this.pathSegments, [
      ...this.parts,
      { type: "where", field, op, value },
    ]);
  }

  orderBy(field: string, direction: OrderDirection = "asc") {
    return new CompatQuery(this.firestore, this.pathSegments, [
      ...this.parts,
      { type: "orderBy", field, direction },
    ]);
  }

  limit(count: number) {
    return new CompatQuery(this.firestore, this.pathSegments, [
      ...this.parts,
      { type: "limit", count },
    ]);
  }

  select(..._fields: string[]) {
    return this;
  }

  async get() {
    const colRef = collection(this.firestore, ...pathToSegments(this.pathSegments));
    const q =
      this.parts.length > 0
        ? query(colRef, ...toConstraints(this.parts))
        : colRef;
    const snap = await getDocs(q);
    return {
      empty: snap.empty,
      docs: snap.docs.map((d) => ({
        exists: d.exists(),
        id: d.id,
        data: () => d.data(),
        ref: new CompatDocumentReference(
          this.firestore,
          this.pathSegments,
          d.id
        ),
      })),
    };
  }
}

class CompatCollectionReference {
  constructor(
    private readonly firestore: Firestore,
    private readonly pathSegments: string[]
  ) {}

  doc(id?: string): CompatDocumentReference {
    if (id === undefined) {
      const colRef = collection(this.firestore, ...pathToSegments(this.pathSegments));
      const newRef = doc(colRef);
      return new CompatDocumentReference(
        this.firestore,
        this.pathSegments,
        newRef.id
      );
    }
    return new CompatDocumentReference(this.firestore, this.pathSegments, id);
  }

  where(field: string, op: WhereFilterOp, value: unknown) {
    return new CompatQuery(this.firestore, this.pathSegments, [
      { type: "where", field, op, value },
    ]);
  }

  orderBy(field: string, direction: OrderDirection = "asc") {
    return new CompatQuery(this.firestore, this.pathSegments, [
      { type: "orderBy", field, direction },
    ]);
  }

  select(...fields: string[]) {
    return new CompatQuery(this.firestore, this.pathSegments, []).select(
      ...fields
    );
  }

  count() {
    return {
      get: async () => {
        const colRef = collection(this.firestore, ...pathToSegments(this.pathSegments));
        const snap = await getCountFromServer(query(colRef));
        return { data: () => ({ count: snap.data().count }) };
      },
    };
  }

  async get() {
    return new CompatQuery(this.firestore, this.pathSegments, []).get();
  }

  async add(data: Record<string, unknown>) {
    const colRef = collection(this.firestore, ...pathToSegments(this.pathSegments));
    const newRef = await addDoc(colRef, data);
    return new CompatDocumentReference(
      this.firestore,
      this.pathSegments,
      newRef.id
    );
  }
}

class CompatWriteBatch {
  private readonly batch;

  constructor(firestore: Firestore) {
    this.batch = writeBatch(firestore);
  }

  set(ref: CompatDocumentReference, data: Record<string, unknown>) {
    this.batch.set(ref.toDocRef(), data);
  }

  delete(ref: CompatDocumentReference) {
    this.batch.delete(ref.toDocRef());
  }

  async commit() {
    await this.batch.commit();
  }
}

class CompatFirestore {
  constructor(private readonly firestore: Firestore) {}

  collection(path: string): CompatCollectionReference {
    const segments = path.split("/").filter(Boolean);
    return new CompatCollectionReference(this.firestore, segments);
  }

  batch() {
    return new CompatWriteBatch(this.firestore);
  }
}

async function deleteStoragePrefix(
  storage: FirebaseStorage,
  prefix: string
): Promise<void> {
  const folderRef = ref(storage, prefix.endsWith("/") ? prefix : `${prefix}/`);
  try {
    const listing = await listAll(folderRef);
    await Promise.all(listing.items.map((item) => deleteObject(item)));
    await Promise.all(
      listing.prefixes.map((sub) => deleteStoragePrefix(storage, sub.fullPath))
    );
  } catch {
    /* folder may not exist */
  }
}

class CompatStorageFile {
  constructor(
    private readonly storage: FirebaseStorage,
    private readonly path: string
  ) {}

  async delete() {
    await deleteObject(ref(this.storage, this.path));
  }

  async getSignedUrl(_options?: {
    action?: string;
    expires?: number;
  }): Promise<[string]> {
    const url = await getDownloadURL(ref(this.storage, this.path));
    return [url];
  }
}

class CompatStorageBucket {
  constructor(private readonly storage: FirebaseStorage) {}

  file(path: string) {
    return new CompatStorageFile(this.storage, path);
  }

  async deleteFiles({ prefix }: { prefix: string }) {
    await deleteStoragePrefix(this.storage, prefix);
  }
}

class CompatStorage {
  constructor(private readonly storage: FirebaseStorage) {}

  bucket(_name: string) {
    return new CompatStorageBucket(this.storage);
  }
}

let compatDb: CompatFirestore | undefined;
let compatStorage: CompatStorage | undefined;

export function getCompatDb(): CompatFirestore {
  if (!compatDb) {
    compatDb = new CompatFirestore(getServerFirestore());
  }
  return compatDb;
}

export function getCompatStorage(): CompatStorage {
  if (!compatStorage) {
    compatStorage = new CompatStorage(getServerStorage());
  }
  return compatStorage;
}
