export interface LimitResult {
  allowed: boolean;
  /** Seconds until the window resets (at least 1). Meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

/** Entries kept at most; a flood of distinct keys evicts the oldest instead of growing memory. */
const MAX_KEYS = 100_000;

/**
 * Fixed-window request counter, one window of `windowMs` per key. In memory, so it is per API
 * instance: with N replicas behind the load balancer a client can make up to N times the limit
 * (docs/08 section 6). A shared store (Postgres or Redis) is deliberately not used: it would put
 * a database write on every request for a guard against runaway clients, not a security boundary.
 * A fixed window lets a client burst up to twice the limit across a window edge; accepted.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { resetAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): LimitResult {
    const now = this.now();
    let w = this.windows.get(key);
    if (w === undefined || w.resetAt <= now) {
      if (w === undefined && this.windows.size >= MAX_KEYS) this.makeRoom(now);
      // Re-insert so the Map's order stays oldest-window-first.
      this.windows.delete(key);
      w = { resetAt: now + this.windowMs, count: 0 };
      this.windows.set(key, w);
    }
    w.count += 1;
    return {
      allowed: w.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
    };
  }

  private makeRoom(now: number): void {
    for (const [k, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(k);
      else break; // insertion order is window-start order, so the rest are still open
    }
    while (this.windows.size >= MAX_KEYS) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }
}
