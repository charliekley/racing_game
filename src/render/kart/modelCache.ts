/**
 * A tiny "least recently used" cache: keeps the last few things that were asked for, throws the oldest away
 * (calling `dispose` on it) when it is full. The selection stage keeps a few built kart models per quadrant, so
 * flipping between two characters is instant, but memory stays bounded. Generic and DOM-free, so it can be tested.
 */
export class LruCache<T> {
  /** A Map remembers insertion order, so the first entry is the oldest. */
  private readonly items = new Map<string, T>();

  constructor(
    private readonly capacity: number,
    private readonly dispose: (value: T, key: string) => void = () => {},
  ) {}

  get size(): number {
    return this.items.size;
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  /** The cached value for `key`, built by `make` on a miss. Using a key makes it the newest. */
  get(key: string, make: () => T): T {
    let v = this.items.get(key);
    if (v !== undefined) {
      this.items.delete(key); // re-insert at the end = most recently used
    } else {
      v = make();
      while (this.items.size >= Math.max(1, this.capacity)) this.evictOldest(key);
    }
    this.items.set(key, v);
    return v;
  }

  /** Dispose and forget everything. */
  clear(): void {
    for (const [k, v] of this.items) this.dispose(v, k);
    this.items.clear();
  }

  private evictOldest(keep: string): void {
    for (const [k, v] of this.items) {
      if (k === keep) continue;
      this.items.delete(k);
      this.dispose(v, k);
      return;
    }
  }
}
