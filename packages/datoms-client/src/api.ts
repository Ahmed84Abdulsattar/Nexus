import { randomUUID } from 'node:crypto';
import type { BudgetStore, BudgetTracker, ApiCallRecord } from './budget.js';
import type { DatomsClient } from './client.js';
import type { DatomsResponse } from './http.js';
import {
  CODE_PAGE_RESPONSE_TOO_LARGE,
  bulkRowCount,
  mapAssetListPage,
  mapBulkPage,
  type AssetListPage,
  type MappedAsset,
  type MappedBulkPage,
  type MappedReading,
} from './mapping.js';
import {
  DEFAULT_RETRY_AFTER_MS,
  MAX_RETRY_AFTER_MS,
  defaultSleep,
  parseRetryAfter,
  withRetry,
  type RetryOptions,
} from './retry.js';

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const noopLogger: Logger = { info() {}, warn() {}, error() {} };

/** Learned bulk page size. The worker backs this with `integration.cursor` (`live_poll`, `pageLimit`). */
export interface LearnedPageSize {
  limit: number;
  /** Epoch ms of the last 422 (or of the reset to the maximum). */
  learnedAt: number;
}
export interface PageSizeStore {
  get(): Promise<LearnedPageSize | undefined>;
  set(value: LearnedPageSize): Promise<void>;
}
export class InMemoryPageSizeStore implements PageSizeStore {
  constructor(private value?: LearnedPageSize) {}
  get(): Promise<LearnedPageSize | undefined> {
    return Promise.resolve(this.value);
  }
  set(value: LearnedPageSize): Promise<void> {
    this.value = value;
    return Promise.resolve();
  }
}

export type ApiErrorKind = 'validation' | 'auth' | 'rate_limited' | 'server' | 'unexpected';

/** A non-recoverable DATOMS answer. 400 is a bug (alert); 401/403 is config (alert and stop). */
export class DatomsApiError extends Error {
  override name = 'DatomsApiError';
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** The budget says wait longer than we are willing to block: skip this tick. */
export class BudgetSkippedError extends Error {
  override name = 'BudgetSkippedError';
  constructor(
    readonly waitMs: number,
    readonly reason: string,
  ) {
    super(`DATOMS call skipped by the budget tracker: ${reason}`);
  }
}

export const MAX_BULK_LIMIT = 500;
export const MAX_CATALOGUE_ASSETS = 20_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface DatomsApiOptions {
  client: DatomsClient;
  budget: BudgetTracker;
  /** Persists every call to `integration.api_call`. Optional; the worker passes the DB store. */
  callStore?: BudgetStore;
  pageSizes: PageSizeStore;
  log?: Logger;
  retry?: Pick<RetryOptions, 'maxTries' | 'random'>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Longest budget wait we accept inside a poll; longer means skip the tick. Default 10 s. */
  maxBudgetWaitMs?: number;
}

interface CallInfo {
  endpoint: string;
  mode: ApiCallRecord['mode'];
  page?: number;
}

function errorKind(status: number): ApiErrorKind {
  if (status === 400) return 'validation';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unexpected';
}

/**
 * The product-facing DATOMS API: paging walkers, id mode, budget, retries, 422 halving.
 * Telemetry comes only from the bulk endpoint (ADR 0010).
 */
export class DatomsApi {
  private readonly log: Logger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastSlowdown = 1;

  constructor(private readonly o: DatomsApiOptions) {
    this.log = o.log ?? noopLogger;
    this.sleep = o.sleep ?? defaultSleep;
    this.now = o.now ?? Date.now;
  }

  /** 1, 2 or 5: multiply every poll interval by this. Logs a warning when it changes. */
  slowdownFactor(): 1 | 2 | 5 {
    const f = this.o.budget.slowdownFactor();
    if (f !== this.lastSlowdown) {
      (f > 1 ? this.log.warn : this.log.info).call(
        this.log,
        f > 1 ? 'DATOMS budget high: slowing polls down' : 'DATOMS budget clear: normal intervals',
        { factor: f },
      );
      this.lastSlowdown = f;
    }
    if (this.o.budget.allowanceWarning()) {
      this.log.warn('DATOMS monthly credit allowance past 80%');
    }
    return f;
  }

  // -------------------------------------------------------------------------------------------
  // The one place a request leaves: budget check, retries, accounting, logging.
  // -------------------------------------------------------------------------------------------
  private async call<T>(
    info: CallInfo,
    estimatedCredits: number,
    fn: () => Promise<DatomsResponse<T>>,
    creditsOf: (body: T | undefined) => number,
  ): Promise<DatomsResponse<T>> {
    // Always checked, also for the catalogue (0 credits): the request window counts.
    const d = this.o.budget.check(estimatedCredits, info.mode === 'assets' ? 'assets' : 'bulk');
    if (!d.allowed) {
      const max = this.o.maxBudgetWaitMs ?? 10_000;
      // A non-finite wait means the call can never fit: always skip.
      if (!Number.isFinite(d.waitMs) || d.waitMs > max) {
        throw new BudgetSkippedError(d.waitMs, d.reason);
      }
      this.log.warn('DATOMS budget wait', { waitMs: d.waitMs, reason: d.reason });
      await this.sleep(d.waitMs);
    }
    const correlationId = randomUUID();
    const result = await withRetry(
      async () => {
        const res = await fn();
        // 422 is refunded, errors are not charged: only successful rows cost credits.
        const credits = res.ok ? creditsOf(res.body) : 0;
        this.account(info, res, credits, correlationId);
        return res;
      },
      {
        ...this.o.retry,
        sleep: this.sleep,
        onWait: (w) => this.log.warn('DATOMS retry wait', { ...info, ...w, correlationId }),
      },
    );
    if (result.status === 429) {
      const waitMs = parseRetryAfter(result.rateLimit.retryAfter) ?? DEFAULT_RETRY_AFTER_MS;
      if (waitMs > MAX_RETRY_AFTER_MS) {
        // DATOMS asks for a longer pause than we will wait: skip this tick.
        this.log.warn('DATOMS 429 with a long Retry-After: skipping this tick', {
          ...info,
          waitMs,
          correlationId,
        });
        throw new BudgetSkippedError(waitMs, 'DATOMS Retry-After above the cap');
      }
      // Otherwise still limited after the retries: the caller raises rate_limited.
    }
    return result;
  }

  private account(
    info: CallInfo,
    res: DatomsResponse,
    credits: number,
    correlationId: string,
  ): void {
    const rl = res.rateLimit;
    const at = this.now();
    this.o.budget.record(at, credits, 1, info.mode === 'assets' ? 'assets' : 'bulk');
    this.o.budget.applyHeaders(rl);
    this.log.info('DATOMS call', {
      ...info,
      status: res.status,
      durationMs: res.durationMs,
      credits,
      rateLimit: rl,
      correlationId,
    });
    const num = (v: string | undefined): number | undefined =>
      v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined;
    const record: ApiCallRecord = {
      at,
      endpoint: info.endpoint,
      mode: info.mode,
      status: res.status,
      durationMs: res.durationMs,
      credits,
      requests: 1,
      correlationId,
    };
    if (info.page !== undefined) record.page = info.page;
    if (rl.unit !== undefined) record.unit = rl.unit;
    const limit = num(rl.limit);
    if (limit !== undefined) record.limit = limit;
    const remaining = num(rl.remaining);
    if (remaining !== undefined) record.remaining = remaining;
    const reset = num(rl.reset);
    if (reset !== undefined) record.reset = reset;
    // Fire and forget: a failed audit write must not break a poll.
    void this.o.callStore?.append(record).catch((err: unknown) => {
      this.log.error('could not persist api_call', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }

  private fail(res: DatomsResponse, info: CallInfo): never {
    const kind = errorKind(res.status);
    const code = res.error?.code;
    const msg = `DATOMS ${info.endpoint} failed: HTTP ${res.status}${code ? ` ${code}` : ''}`;
    // 400 is a bug and 401/403 is config: log loudly, and never retried (see withRetry).
    this.log.error(msg, { ...info, status: res.status, code, kind });
    throw new DatomsApiError(res.status, code, kind, msg);
  }

  // -------------------------------------------------------------------------------------------
  // GET /assets (catalogue)
  // -------------------------------------------------------------------------------------------

  /** Walks `GET /assets` page by page; the caller processes and releases each page. */
  async *walkAssets(
    limit = 1000,
    state: { capped?: boolean; incomplete?: boolean; invalidRows?: number } = {},
    signal?: AbortSignal,
  ): AsyncGenerator<AssetListPage> {
    let page = 1;
    // Hard stop for a server that reports absurd pagination: the fleet is at most 20,000 assets.
    const maxPages = Math.ceil(MAX_CATALOGUE_ASSETS / limit) + 2;
    for (;;) {
      signal?.throwIfAborted();
      if (page > maxPages) {
        state.capped = true;
        this.log.error('catalogue walk hit the page cap', { maxPages });
        return;
      }
      const info: CallInfo = { endpoint: '/assets', mode: 'assets', page };
      const res = await this.call(
        info,
        0,
        () => this.o.client.listAssets(page, limit),
        () => 0,
      );
      if (!res.ok || !res.body) this.fail(res, info);
      const mapped = mapAssetListPage(res.body, limit);
      state.invalidRows = (state.invalidRows ?? 0) + mapped.invalidRows;
      if (mapped.droppedRows > 0) {
        // More rows than the page size we asked for: not trusted, the walk is capped.
        state.capped = true;
        this.log.error('catalogue page has more rows than the limit', { page, limit });
      }
      if (!mapped.pagination) {
        state.incomplete = true;
        this.log.error('catalogue page has no pagination: walk is not complete', { page });
      }
      yield mapped;
      const totalPages = mapped.pagination?.totalPages ?? page;
      if (page >= totalPages) return;
      page++;
    }
  }

  /**
   * A whole catalogue walk. `complete` is true only when the number of assets seen equals
   * `pagination.total`: the safe-retire rule (docs/07 section 6) needs it.
   */
  async collectAssets(
    limit = 1000,
    signal?: AbortSignal,
  ): Promise<{
    assets: MappedAsset[];
    total: number | undefined;
    complete: boolean;
    /** Rows that failed validation (count only). */
    invalidRows: number;
    /** True when the page, row or total cap was hit. */
    capped: boolean;
  }> {
    const assets: MappedAsset[] = [];
    let total: number | undefined;
    let invalidRows = 0;
    const state: { capped?: boolean; incomplete?: boolean; invalidRows?: number } = {};
    for await (const p of this.walkAssets(limit, state, signal)) {
      assets.push(...p.assets);
      total = p.pagination?.total ?? total;
      if (assets.length > MAX_CATALOGUE_ASSETS) {
        assets.length = MAX_CATALOGUE_ASSETS;
        state.capped = true;
        this.log.error('catalogue walk hit the asset cap', { max: MAX_CATALOGUE_ASSETS });
        break;
      }
    }
    invalidRows = state.invalidRows ?? 0;
    // Complete needs the UNIQUE ids to equal the total (a duplicate must not stand in for a
    // missing asset), no invalid row (its id is unknown), and no cap.
    const unique = new Set(assets.map((a) => a.externalId)).size;
    return {
      assets,
      total,
      invalidRows,
      capped: state.capped === true,
      complete:
        !state.capped &&
        !state.incomplete &&
        invalidRows === 0 &&
        total !== undefined &&
        assets.length === total &&
        unique === total,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Bulk, fleet mode
  // -------------------------------------------------------------------------------------------

  /** Page size to start with: the learned one, but try the maximum again once a day. */
  private async startLimit(): Promise<number> {
    const learned = await this.o.pageSizes.get();
    if (!learned || learned.limit >= MAX_BULK_LIMIT) return MAX_BULK_LIMIT;
    if (this.now() - learned.learnedAt >= DAY_MS) {
      this.log.info('retrying the maximum bulk page size', { limit: MAX_BULK_LIMIT });
      return MAX_BULK_LIMIT;
    }
    return learned.limit;
  }

  /**
   * Fleet-mode walk (`{page, limit}`): yields one mapped page at a time. On 422
   * PAGE_RESPONSE_TOO_LARGE it halves the page size and resumes from the right page:
   * `new_limit = max(1, floor(old_limit / 2))`,
   * `resume_page = floor(((old_page - 1) * old_limit) / new_limit) + 1`.
   */
  async *walkFleet(): AsyncGenerator<MappedBulkPage> {
    let limit = await this.startLimit();
    let page = 1;
    let total: number | undefined;
    for (;;) {
      const info: CallInfo = { endpoint: '/assets/telemetry/latest/query', mode: 'fleet', page };
      const est =
        total === undefined ? limit : Math.max(0, Math.min(limit, total - (page - 1) * limit));
      const res = await this.call(
        info,
        Math.max(1, est),
        () => this.o.client.bulkLatestFleet(page, limit),
        bulkRowCount,
      );
      if (res.status === 422 && res.error?.code === CODE_PAGE_RESPONSE_TOO_LARGE) {
        if (limit <= 1) this.fail(res, info);
        const newLimit = Math.max(1, Math.floor(limit / 2));
        const resume = Math.floor(((page - 1) * limit) / newLimit) + 1;
        this.log.warn('DATOMS 422 page too large: halving', {
          oldLimit: limit,
          newLimit,
          oldPage: page,
          resumePage: resume,
        });
        limit = newLimit;
        page = resume;
        await this.o.pageSizes.set({ limit, learnedAt: this.now() });
        continue;
      }
      if (!res.ok || !res.body) this.fail(res, info);
      const mapped = mapBulkPage(res.body);
      if (!mapped.pagination) {
        // Never a silent single-page walk: the rest of the fleet would look like "no data".
        const msg = 'DATOMS fleet-mode response has no pagination';
        this.log.error(msg, { ...info });
        throw new DatomsApiError(res.status, 'MISSING_PAGINATION', 'unexpected', msg);
      }
      const learned = await this.o.pageSizes.get();
      if (limit === MAX_BULK_LIMIT && learned && learned.limit < MAX_BULK_LIMIT) {
        await this.o.pageSizes.set({ limit, learnedAt: this.now() });
      }
      total = mapped.pagination?.total ?? total;
      yield mapped;
      // Pagination echoes the limit actually used; if the server changed it, follow it.
      const totalPages = mapped.pagination?.totalPages ?? page;
      if (page >= totalPages) return;
      page++;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Bulk, id mode
  // -------------------------------------------------------------------------------------------

  /**
   * Id mode: unique ids, at most 500 per call, rows returned in request order. A 422 splits the
   * list in two. Mapped readings of all chunks are returned together.
   */
  async bulkByIds(ids: readonly string[]): Promise<Omit<MappedBulkPage, 'pagination'>> {
    const unique = [...new Set(ids)];
    const out = {
      readings: [] as MappedReading[],
      noData: [] as string[],
      invalid: [] as string[],
    };
    for (let i = 0; i < unique.length; i += MAX_BULK_LIMIT) {
      const part = await this.idChunk(unique.slice(i, i + MAX_BULK_LIMIT));
      out.readings.push(...part.readings);
      out.noData.push(...part.noData);
      out.invalid.push(...part.invalid);
    }
    return out;
  }

  private async idChunk(ids: string[]): Promise<Omit<MappedBulkPage, 'pagination'>> {
    if (ids.length === 0) return { readings: [], noData: [], invalid: [] };
    const info: CallInfo = { endpoint: '/assets/telemetry/latest/query', mode: 'id' };
    const res = await this.call(
      info,
      ids.length,
      () => this.o.client.bulkLatestById(ids),
      bulkRowCount,
    );
    if (res.status === 422 && res.error?.code === CODE_PAGE_RESPONSE_TOO_LARGE) {
      if (ids.length <= 1) this.fail(res, info);
      const mid = Math.floor(ids.length / 2);
      this.log.warn('DATOMS 422 page too large: splitting id list', { ids: ids.length });
      const a = await this.idChunk(ids.slice(0, mid));
      const b = await this.idChunk(ids.slice(mid));
      return {
        readings: [...a.readings, ...b.readings],
        noData: [...a.noData, ...b.noData],
        invalid: [...a.invalid, ...b.invalid],
      };
    }
    if (!res.ok || !res.body) this.fail(res, info);
    const { readings, noData, invalid } = mapBulkPage(res.body);
    return { readings, noData, invalid };
  }
}
