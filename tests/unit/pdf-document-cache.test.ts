import { describe, expect, it, vi } from "vitest";
import { BoundedAsyncCache } from "@/components/lv/pdf-document-cache";

describe("bounded PDF document cache", () => {
  it("reuses one load promise for the same document revision", async () => {
    const cache = new BoundedAsyncCache<{ id: string }>(4);
    const load = vi.fn(async () => ({ id: "revision-1" }));
    const dispose = vi.fn();
    const first = cache.get("revision-1", load, dispose);
    const second = cache.get("revision-1", load, dispose);
    expect(second).toBe(first);
    expect(await second).toEqual({ id: "revision-1" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("evicts only the least-recently-used document beyond the bound", async () => {
    const cache = new BoundedAsyncCache<{ id: string }>(2);
    const disposed: string[] = [];
    const load = (id: string) =>
      cache.get(
        id,
        async () => ({ id }),
        (value) => {
          disposed.push(value.id);
        }
      );
    await load("a");
    await load("b");
    await load("a");
    await load("c");
    await Promise.resolve();
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(disposed).toEqual(["b"]);
  });
});
