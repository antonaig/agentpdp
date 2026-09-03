/** In-memory TTL cache for successful extractions. Keyed by normalized URL. */

export const CACHE_TTL_MS = 5 * 60 * 1000;

interface Entry<T> {
  value: T;
  expires: number;
}

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(private ttlMs = CACHE_TTL_MS, private maxEntries = 500) {}

  get(key: string, now = Date.now()): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.delete(key);
    this.map.set(key, { value, expires: now + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
