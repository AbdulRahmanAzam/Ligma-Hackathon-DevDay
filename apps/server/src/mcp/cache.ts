/**
 * Simple in-memory TTL cache for MCP explanation/diagram responses.
 */
import type { CacheStats } from "./types.js";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class ResponseCache<T = unknown> {
  private store = new Map<string, Entry<T>>();
  private hits = 0;
  private misses = 0;
  private readonly ttlMs: number;

  constructor(ttlSeconds: number) {
    this.ttlMs = Math.max(1, ttlSeconds) * 1000;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Remove every entry whose key contains the substring (used for invalidation). */
  invalidateContaining(substr: string): number {
    let removed = 0;
    for (const k of this.store.keys()) {
      if (k.includes(substr)) {
        this.store.delete(k);
        removed++;
      }
    }
    return removed;
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) {
        this.store.delete(k);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }
}
