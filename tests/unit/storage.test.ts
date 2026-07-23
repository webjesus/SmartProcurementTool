import { describe, expect, it } from "vitest";
import { LocalDocumentStorage, UnconfiguredProductionStorage } from "@/storage/document-storage";

describe("document storage boundaries", () => {
  it("requires an explicit local enable gate", () => {
    expect(() => new LocalDocumentStorage(".data/documents", false)).toThrow(
      "Local document storage is disabled"
    );
  });

  it("rejects traversal before touching the filesystem", async () => {
    const storage = new LocalDocumentStorage(".data/documents", true);
    await expect(storage.exists("../commercial.pdf")).rejects.toThrow(
      "escapes the configured root"
    );
  });

  it("fails honestly when production storage is not configured", async () => {
    const storage = new UnconfiguredProductionStorage();
    await expect(storage.exists("document.pdf")).rejects.toThrow(
      "Production document storage is not configured"
    );
  });
});
