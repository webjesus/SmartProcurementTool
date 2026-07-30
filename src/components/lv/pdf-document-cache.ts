export class BoundedAsyncCache<T> {
  private readonly entries = new Map<
    string,
    { promise: Promise<T>; dispose: (value: T) => void | Promise<void> }
  >();

  constructor(private readonly limit = 4) {}

  get(
    key: string,
    load: () => Promise<T>,
    dispose: (value: T) => void | Promise<void>
  ): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.promise;
    }
    const entry = { promise: load(), dispose };
    this.entries.set(key, entry);
    void entry.promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    this.evict();
    return entry.promise;
  }

  get size() {
    return this.entries.size;
  }

  has(key: string) {
    return this.entries.has(key);
  }

  clear() {
    for (const entry of this.entries.values()) {
      void entry.promise.then(entry.dispose).catch(() => undefined);
    }
    this.entries.clear();
  }

  private evict() {
    while (this.entries.size > this.limit) {
      const oldest = this.entries.entries().next().value as
        | [
            string,
            {
              promise: Promise<T>;
              dispose: (value: T) => void | Promise<void>;
            }
          ]
        | undefined;
      if (!oldest) return;
      this.entries.delete(oldest[0]);
      void oldest[1].promise
        .then(oldest[1].dispose)
        .catch(() => undefined);
    }
  }
}
