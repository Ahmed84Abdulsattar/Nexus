import type { RateLimitHeaders } from './http.js';

/**
 * Budget tracker (docs/07 section 4 item 2, ADR 0005).
 *
 * Sliding windows of credits spent and requests made. Caps follow the DATOMS bulk limits with
 * F = fleet size rounded up to 500 (minimum 500), each multiplied by `maxShare`. The quota is
 * organisation-wide, so the server's headers are the truth and are folded in after every call.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface WindowSpec {
  name: string;
  ms: number;
  /** Credit cap before `maxShare`, as a multiple of F. */
  perF: number;
}

export const CREDIT_WINDOWS: readonly WindowSpec[] = [
  { name: '1m', ms: MIN, perF: 4 },
  { name: '5m', ms: 5 * MIN, perF: 8 },
  { name: '1h', ms: HOUR, perF: 100 },
  { name: '24h', ms: DAY, perF: 2_500 },
  { name: '30d', ms: 30 * DAY, perF: 60_000 },
];

/** Request limit for bulk: 240 per 60 s per credential and organisation. */
export const REQUESTS_PER_MINUTE = 240;

/** Wait or skip when a call would go past this share of any cap. */
export const CALL_THRESHOLD = 0.9;
/** Slow every interval down once any window passes this share. */
export const SLOW_2X_AT = 0.8;
/** ... and by 5 once any window passes this share. */
export const SLOW_5X_AT = 0.9;
/** Warn at this share of the monthly allowance. */
export const ALLOWANCE_WARN_AT = 0.8;

/** One line of `integration.api_call`. The worker supplies the DB-backed store. */
export interface ApiCallRecord {
  /** Epoch ms. */
  at: number;
  endpoint: string;
  mode: 'fleet' | 'id' | 'assets';
  page?: number;
  status: number;
  durationMs: number;
  credits: number;
  requests: number;
  unit?: string;
  limit?: number;
  remaining?: number;
  reset?: number;
  correlationId: string;
}

/** Persistence seam. The DB implementation is built with the worker (S1-01 / S3-03). */
export interface BudgetStore {
  append(record: ApiCallRecord): Promise<void>;
  /** Calls with `at >= sinceMs`, used on restart so a restart does not forget usage. */
  loadSince(sinceMs: number): Promise<ApiCallRecord[]>;
}

export class InMemoryBudgetStore implements BudgetStore {
  readonly records: ApiCallRecord[] = [];
  append(record: ApiCallRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
  loadSince(sinceMs: number): Promise<ApiCallRecord[]> {
    return Promise.resolve(this.records.filter((r) => r.at >= sinceMs));
  }
}

export interface BudgetOptions {
  /** Number of assets in the fleet; F is this rounded up to 500, minimum 500. */
  fleetSize: number;
  /** `budget.max_share`: prod 1.0, dev small. Multiplies every cap. */
  maxShare: number;
  /** Contract allowance per month (credits), from config. Optional. */
  monthlyAllowance?: number;
  now?: () => number;
}

export interface WindowUsage {
  name: string;
  cap: number;
  used: number;
  fraction: number;
}

export type BudgetDecision =
  | { allowed: true; waitMs: 0 }
  | { allowed: false; waitMs: number; reason: string }
  /** The call can never fit inside the cap: skip it, do not wait. */
  | { allowed: false; waitMs: typeof Infinity; reason: string };

interface ServerView {
  unit: string;
  remaining: number;
  /** Epoch ms when the server window resets. */
  resetAt: number;
}

export function fleetUnit(fleetSize: number): number {
  return Math.max(500, Math.ceil(fleetSize / 500) * 500);
}

export class BudgetTracker {
  private calls: { at: number; credits: number; requests: number }[] = [];
  private readonly now: () => number;
  private readonly f: number;
  private server: ServerView | undefined;

  constructor(private readonly opts: BudgetOptions) {
    // Fail closed: bad numbers would silently disable the caps.
    if (!Number.isFinite(opts.fleetSize) || opts.fleetSize < 0) {
      throw new RangeError('budget: fleetSize must be a finite number >= 0');
    }
    if (!Number.isFinite(opts.maxShare) || opts.maxShare <= 0 || opts.maxShare > 1) {
      throw new RangeError('budget: maxShare must be in (0, 1]');
    }
    if (
      opts.monthlyAllowance !== undefined &&
      (!Number.isFinite(opts.monthlyAllowance) || opts.monthlyAllowance <= 0)
    ) {
      throw new RangeError('budget: monthlyAllowance must be undefined or a finite number > 0');
    }
    this.now = opts.now ?? Date.now;
    this.f = fleetUnit(opts.fleetSize);
  }

  /** Load earlier usage after a restart. */
  async restore(store: BudgetStore): Promise<void> {
    const since = this.now() - 30 * DAY;
    for (const r of await store.loadSince(since)) this.record(r.at, r.credits, r.requests);
  }

  record(at: number, credits: number, requests = 1): void {
    this.calls.push({ at, credits, requests });
    this.prune();
  }

  /**
   * Fold the server's rate-limit headers in. The Unit is read FIRST: Limit/Remaining only mean
   * credits when Unit is `asset-read-credits`. `GET /assets` and the per-asset latest call send no Unit at
   * all (seen 2026-10-12); those headers are ignored here, the local estimate stays in charge.
   */
  applyHeaders(h: RateLimitHeaders): void {
    const unit = h.unit;
    if (unit === undefined) return;
    const remaining = Number(h.remaining);
    const resetS = Number(h.reset);
    if (!Number.isFinite(remaining)) return;
    this.server = {
      unit,
      remaining,
      resetAt: this.now() + (Number.isFinite(resetS) ? resetS * 1000 : 60_000),
    };
  }

  private prune(): void {
    const cutoff = this.now() - 30 * DAY;
    if (this.calls.length > 0 && (this.calls[0]?.at ?? cutoff) < cutoff) {
      this.calls = this.calls.filter((c) => c.at >= cutoff);
    }
  }

  private cap(spec: WindowSpec): number {
    return spec.perF * this.f * this.opts.maxShare;
  }

  private usedIn(ms: number, kind: 'credits' | 'requests'): number {
    const from = this.now() - ms;
    let total = 0;
    for (const c of this.calls) if (c.at > from) total += c[kind];
    return total;
  }

  usage(): WindowUsage[] {
    const out: WindowUsage[] = CREDIT_WINDOWS.map((w) => {
      const cap = this.cap(w);
      const used = this.usedIn(w.ms, 'credits');
      return { name: w.name, cap, used, fraction: used / cap };
    });
    if (this.opts.monthlyAllowance !== undefined) {
      const cap = this.opts.monthlyAllowance * this.opts.maxShare;
      const used = this.usedIn(30 * DAY, 'credits');
      out.push({ name: 'monthly-allowance', cap, used, fraction: used / cap });
    }
    const reqCap = REQUESTS_PER_MINUTE * this.opts.maxShare;
    const reqUsed = this.usedIn(MIN, 'requests');
    out.push({ name: 'requests-1m', cap: reqCap, used: reqUsed, fraction: reqUsed / reqCap });
    return out;
  }

  /** 1, 2 or 5: multiply every poll interval by this (docs/07 section 4 item 3). */
  slowdownFactor(): 1 | 2 | 5 {
    const worst = Math.max(...this.usage().map((u) => u.fraction));
    if (worst > SLOW_5X_AT) return 5;
    if (worst > SLOW_2X_AT) return 2;
    return 1;
  }

  /** True once usage of the monthly allowance passes 80% (log a warning). */
  allowanceWarning(): boolean {
    const u = this.usage().find((w) => w.name === 'monthly-allowance');
    return u !== undefined && u.fraction >= ALLOWANCE_WARN_AT;
  }

  /**
   * Before a call: may `estimatedCredits` be spent now? Waits or skips if it would pass 90% of
   * any cap, or exceeds what the server says is left.
   */
  check(estimatedCredits: number): BudgetDecision {
    const now = this.now();
    let waitMs = 0;
    let reason = '';

    const windows: { name: string; ms: number; cap: number; kind: 'credits' | 'requests' }[] =
      CREDIT_WINDOWS.map((w) => ({ name: w.name, ms: w.ms, cap: this.cap(w), kind: 'credits' }));
    if (this.opts.monthlyAllowance !== undefined) {
      windows.push({
        name: 'monthly-allowance',
        ms: 30 * DAY,
        cap: this.opts.monthlyAllowance * this.opts.maxShare,
        kind: 'credits',
      });
    }
    windows.push({
      name: 'requests-1m',
      ms: MIN,
      cap: REQUESTS_PER_MINUTE * this.opts.maxShare,
      kind: 'requests',
    });

    for (const w of windows) {
      const est = w.kind === 'credits' ? estimatedCredits : 1;
      // A call that spends no credits (the catalogue) only counts against the request window.
      if (w.kind === 'credits' && est <= 0) continue;
      const limit = CALL_THRESHOLD * w.cap;
      if (est > limit) {
        return {
          allowed: false,
          waitMs: Infinity,
          reason: `${w.name}: call of ${est} exceeds ${CALL_THRESHOLD * 100}% of cap ${w.cap}`,
        };
      }
      const from = now - w.ms;
      const live = this.calls.filter((c) => c.at > from).sort((a, b) => a.at - b.at);
      let used = live.reduce((s, c) => s + c[w.kind], 0);
      if (used + est <= limit) continue;
      // Find when enough of the oldest calls leave the window.
      let t = now;
      for (const c of live) {
        used -= c[w.kind];
        t = c.at + w.ms;
        if (used + est <= limit) break;
      }
      if (t - now > waitMs) {
        waitMs = t - now;
        reason = `${w.name}: ${w.kind} window would pass ${CALL_THRESHOLD * 100}% of cap`;
      }
    }

    // The server's own count wins when it says less is left than we need.
    const s = this.server;
    if (s && s.unit === 'asset-read-credits' && now < s.resetAt && estimatedCredits > s.remaining) {
      const w = s.resetAt - now;
      if (w > waitMs) {
        waitMs = w;
        reason = `server reports ${s.remaining} credits left until reset`;
      }
    }

    return waitMs > 0
      ? { allowed: false, waitMs: Math.ceil(waitMs), reason }
      : { allowed: true, waitMs: 0 };
  }
}
