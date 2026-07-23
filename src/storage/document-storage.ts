import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentStorage } from "@/domain/repositories";

const LOCAL_STORAGE_DISABLED =
  "Local document storage is disabled. Set LOCAL_CORPUS_ENABLED=true only on a trusted workstation.";
const PRODUCTION_STORAGE_UNCONFIGURED =
  "Production document storage is not configured. Provide an object-storage adapter before accepting documents.";

function resolveStorageKey(root: string, key: string): string {
  if (!key || path.isAbsolute(key)) {
    throw new Error("Document storage keys must be non-empty relative paths.");
  }

  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, key);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Document storage key escapes the configured root.");
  }
  return resolvedFile;
}

export class LocalDocumentStorage implements DocumentStorage {
  constructor(
    private readonly root: string,
    enabled = process.env.LOCAL_CORPUS_ENABLED === "true"
  ) {
    if (!enabled) throw new Error(LOCAL_STORAGE_DISABLED);
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    if (!contentType) throw new Error("A content type is required.");
    const destination = resolveStorageKey(this.root, key);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: "wx" });
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(resolveStorageKey(this.root, key)));
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(resolveStorageKey(this.root, key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}

export class UnconfiguredProductionStorage implements DocumentStorage {
  private unavailable(): never {
    throw new Error(PRODUCTION_STORAGE_UNCONFIGURED);
  }

  async put(_key: string, _data: Uint8Array, _contentType: string): Promise<void> {
    void [_key, _data, _contentType];
    this.unavailable();
  }

  async get(_key: string): Promise<Uint8Array> {
    void _key;
    return this.unavailable();
  }

  async exists(_key: string): Promise<boolean> {
    void _key;
    return this.unavailable();
  }
}
