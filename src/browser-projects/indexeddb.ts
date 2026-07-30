import type {
  BrowserAnalysisSnapshot,
  BrowserDocumentBlobRecord,
  BrowserDocumentRecord,
  BrowserProcessingRun,
  BrowserProjectRecord,
  BrowserSelectionRecord,
  BrowserWorkspaceRecord
} from "@/browser-projects/types";

export const BROWSER_DATABASE_NAME = "smart-procurement-tool";
export const BROWSER_DATABASE_VERSION = 2;

export const BROWSER_STORES = [
  "projects",
  "documents",
  "documentBlobs",
  "processingRuns",
  "analysisSnapshots",
  "basisPositions",
  "supplierLines",
  "supplierOptions",
  "bundles",
  "operatorSelections",
  "workspaceStates",
  "exportsMetadata"
] as const;

export type BrowserStoreName = (typeof BROWSER_STORES)[number];

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_REQUEST_FAILED"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED"));
  });
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters
) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function migrate(database: IDBDatabase, transaction: IDBTransaction, oldVersion: number) {
  if (oldVersion < 1) {
    database.createObjectStore("projects", { keyPath: "projectId" });
    database.createObjectStore("documents", {
      keyPath: ["projectId", "documentId"]
    });
    database.createObjectStore("documentBlobs", {
      keyPath: ["projectId", "documentId"]
    });
    database.createObjectStore("processingRuns", {
      keyPath: ["projectId", "runId"]
    });
    database.createObjectStore("analysisSnapshots", {
      keyPath: ["projectId", "analysisVersionId"]
    });
    database.createObjectStore("basisPositions", {
      keyPath: ["projectId", "analysisVersionId", "positionId"]
    });
    database.createObjectStore("supplierLines", {
      keyPath: ["projectId", "analysisVersionId", "supplierLineId"]
    });
    database.createObjectStore("supplierOptions", {
      keyPath: ["projectId", "analysisVersionId", "optionId"]
    });
    database.createObjectStore("bundles", {
      keyPath: ["projectId", "analysisVersionId", "bundleId"]
    });
    database.createObjectStore("operatorSelections", {
      keyPath: ["projectId", "positionId"]
    });
    database.createObjectStore("workspaceStates", { keyPath: "projectId" });
  }
  if (oldVersion < 2 && !database.objectStoreNames.contains("exportsMetadata")) {
    database.createObjectStore("exportsMetadata", {
      keyPath: ["projectId", "exportId"]
    });
  }

  const stores = Object.fromEntries(
    BROWSER_STORES.map((name) => [name, transaction.objectStore(name)])
  ) as Record<BrowserStoreName, IDBObjectStore>;
  ensureIndex(stores.projects, "createdAt", "createdAt");
  ensureIndex(stores.projects, "updatedAt", "updatedAt");
  ensureIndex(stores.projects, "lastOpenedAt", "lastOpenedAt");
  for (const name of BROWSER_STORES.filter(
    (candidate) => !["projects", "workspaceStates"].includes(candidate)
  )) {
    ensureIndex(stores[name], "projectId", "projectId");
  }
  ensureIndex(stores.documents, "documentType", "documentType");
  ensureIndex(stores.documents, "supplierId", "supplierName");
  ensureIndex(stores.basisPositions, "positionNumber", "positionNumber");
  for (const name of [
    "analysisSnapshots",
    "basisPositions",
    "supplierLines",
    "supplierOptions",
    "bundles"
  ] as const) {
    ensureIndex(stores[name], "analysisVersionId", "analysisVersionId");
  }
}

export class BrowserProjectDatabase {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly indexedDb: IDBFactory = globalThis.indexedDB,
    readonly name = BROWSER_DATABASE_NAME
  ) {}

  open(): Promise<IDBDatabase> {
    if (!this.indexedDb) {
      return Promise.reject(new Error("INDEXEDDB_UNAVAILABLE"));
    }
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.name, BROWSER_DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        if (!request.transaction) {
          reject(new Error("INDEXEDDB_MIGRATION_TRANSACTION_MISSING"));
          return;
        }
        try {
          migrate(
            request.result,
            request.transaction,
            (event as IDBVersionChangeEvent).oldVersion
          );
        } catch (error) {
          request.transaction.abort();
          reject(
            new Error("INDEXEDDB_MIGRATION_FAILED", { cause: error })
          );
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("INDEXEDDB_OPEN_FAILED"));
      request.onblocked = () => reject(new Error("INDEXEDDB_MIGRATION_BLOCKED"));
    });
    return this.databasePromise;
  }

  async get<T>(storeName: BrowserStoreName, key: IDBValidKey): Promise<T | null> {
    const database = await this.open();
    const request = database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .get(key);
    return ((await requestResult(request)) as T | undefined) ?? null;
  }

  async getAll<T>(
    storeName: BrowserStoreName,
    indexName?: string,
    query?: IDBValidKey | IDBKeyRange
  ): Promise<T[]> {
    const database = await this.open();
    const store = database.transaction(storeName, "readonly").objectStore(storeName);
    const source = indexName ? store.index(indexName) : store;
    return (await requestResult(source.getAll(query))) as T[];
  }

  async put(storeName: BrowserStoreName, value: unknown): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionComplete(transaction);
  }

  async delete(storeName: BrowserStoreName, key: IDBValidKey): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionComplete(transaction);
  }

  async deleteProject(projectId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([...BROWSER_STORES], "readwrite");
    transaction.objectStore("projects").delete(projectId);
    transaction.objectStore("workspaceStates").delete(projectId);
    for (const storeName of BROWSER_STORES.filter(
      (name) => !["projects", "workspaceStates"].includes(name)
    )) {
      const store = transaction.objectStore(storeName);
      const index = store.index("projectId");
      const cursor = index.openKeyCursor(projectId);
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        store.delete(current.primaryKey);
        current.continue();
      };
    }
    await transactionComplete(transaction);
  }

  close() {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = null;
  }
}

export class BrowserIndexedDbProjectRepository {
  constructor(private readonly database: BrowserProjectDatabase) {}
  get(projectId: string) {
    return this.database.get<BrowserProjectRecord>("projects", projectId);
  }
  list() {
    return this.database.getAll<BrowserProjectRecord>("projects");
  }
  save(project: BrowserProjectRecord) {
    return this.database.put("projects", project);
  }
  delete(projectId: string) {
    return this.database.deleteProject(projectId);
  }
}

export class BrowserIndexedDbDocumentRepository {
  constructor(private readonly database: BrowserProjectDatabase) {}
  get(projectId: string, documentId: string) {
    return this.database.get<BrowserDocumentRecord>("documents", [
      projectId,
      documentId
    ]);
  }
  list(projectId: string) {
    return this.database.getAll<BrowserDocumentRecord>(
      "documents",
      "projectId",
      projectId
    );
  }
  save(document: BrowserDocumentRecord) {
    return this.database.put("documents", document);
  }
  delete(projectId: string, documentId: string) {
    return this.database.delete("documents", [projectId, documentId]);
  }
}

export class BrowserIndexedDbDocumentBlobRepository {
  constructor(private readonly database: BrowserProjectDatabase) {}
  async get(projectId: string, documentId: string) {
    return (
      await this.database.get<BrowserDocumentBlobRecord>("documentBlobs", [
        projectId,
        documentId
      ])
    )?.blob ?? null;
  }
  save(record: BrowserDocumentBlobRecord) {
    return this.database.put("documentBlobs", record);
  }
  delete(projectId: string, documentId: string) {
    return this.database.delete("documentBlobs", [projectId, documentId]);
  }
}

export class BrowserIndexedDbAnalysisRepository {
  constructor(private readonly database: BrowserProjectDatabase) {}
  get(projectId: string, analysisVersionId: string) {
    return this.database.get<BrowserAnalysisSnapshot>("analysisSnapshots", [
      projectId,
      analysisVersionId
    ]);
  }
  async latest(projectId: string) {
    const snapshots = await this.list(projectId);
    return snapshots.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    ).at(-1) ?? null;
  }
  list(projectId: string) {
    return this.database.getAll<BrowserAnalysisSnapshot>(
      "analysisSnapshots",
      "projectId",
      projectId
    );
  }
  async save(snapshot: BrowserAnalysisSnapshot) {
    await this.database.put("analysisSnapshots", snapshot);
    const analysis = snapshot.pilot.analysis;
    if (!analysis) return;
    await Promise.all([
      ...analysis.basisPositions.map((position) =>
        this.database.put("basisPositions", {
          projectId: snapshot.projectId,
          analysisVersionId: snapshot.analysisVersionId,
          positionId: position.id,
          positionNumber: position.positionNumber,
          value: position
        })
      ),
      ...snapshot.pilot.runs.flatMap((run) =>
        run.result.envelope.extraction.offerGroups.flatMap((group) =>
          group.lines.map((line) =>
            this.database.put("supplierLines", {
              projectId: snapshot.projectId,
              analysisVersionId: snapshot.analysisVersionId,
              supplierLineId: line.id,
              documentId: run.document.id,
              value: line
            })
          )
        )
      ),
      ...analysis.supplierOptions.map((option) =>
        this.database.put("supplierOptions", {
          projectId: snapshot.projectId,
          analysisVersionId: snapshot.analysisVersionId,
          optionId: option.id,
          value: option
        })
      ),
      ...analysis.supplierOptions.map((option) =>
        this.database.put("bundles", {
          projectId: snapshot.projectId,
          analysisVersionId: snapshot.analysisVersionId,
          bundleId: option.id,
          value: {
            supplierOptionId: option.id,
            lineIds: option.matchedOfferLineIds
          }
        })
      )
    ]);
  }
}

export class BrowserIndexedDbSelectionRepository {
  constructor(private readonly database: BrowserProjectDatabase) {}
  get(projectId: string, positionId: string) {
    return this.database.get<BrowserSelectionRecord>("operatorSelections", [
      projectId,
      positionId
    ]);
  }
  list(projectId: string) {
    return this.database.getAll<BrowserSelectionRecord>(
      "operatorSelections",
      "projectId",
      projectId
    );
  }
  save(selection: BrowserSelectionRecord) {
    return this.database.put("operatorSelections", selection);
  }
  delete(projectId: string, positionId: string) {
    return this.database.delete("operatorSelections", [projectId, positionId]);
  }
}

export class BrowserIndexedDbWorkspaceRepository {
  constructor(private readonly database: BrowserProjectDatabase) {}
  get(projectId: string) {
    return this.database.get<BrowserWorkspaceRecord>("workspaceStates", projectId);
  }
  save(workspace: BrowserWorkspaceRecord) {
    return this.database.put("workspaceStates", workspace);
  }
}

export class BrowserIndexedDbProcessingRunRepository {
  constructor(private readonly database: BrowserProjectDatabase) {}
  async current(projectId: string) {
    const runs = await this.database.getAll<BrowserProcessingRun>(
      "processingRuns",
      "projectId",
      projectId
    );
    return runs.sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt)
    ).at(-1) ?? null;
  }
  save(run: BrowserProcessingRun) {
    return this.database.put("processingRuns", run);
  }
}
