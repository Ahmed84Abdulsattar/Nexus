import type {
  ListAssetsOptions,
  ReadScope,
  SourceCatalogue,
  SourceConnector,
  SourceReadingBatch,
  SourceSite,
} from '@nexus/connectors-core';
import { sanitizeErrorText } from '@nexus/connectors-core';
import type { DatomsConnectorHandle } from '@nexus/connectors-datoms';
import { z } from 'zod';

export interface ShareLogger {
  warn(message: string): void;
}

/**
 * The connector the worker's jobs use. It builds the DATOMS connector on first use (so creating the
 * application connects to nothing) and keeps `budget.max_share` current (ADR 0005, M4):
 *
 * - `refreshBudgetShare()` runs at the start of every job and reads the setting again;
 * - a valid new value is applied to the running budget tracker;
 * - an invalid later value keeps the LAST VALID share and logs a warning; it never falls back to 1;
 * - with no valid share yet (first read invalid or missing) the job fails closed: nothing is called.
 */
export class WorkerConnector implements SourceConnector {
  readonly sourceSystem = 'datoms';
  private handle: Promise<DatomsConnectorHandle> | undefined;
  private lastValid: number | undefined;

  constructor(
    private readonly readShare: () => Promise<unknown>,
    private readonly create: (share: number) => DatomsConnectorHandle,
    private readonly log: ShareLogger,
    /** Hard upper bound from the environment (DATOMS_MAX_SHARE_CEILING). 1 = no extra limit (prod default). */
    private readonly ceiling = 1,
    /** Called once per change of a setting that is above the ceiling. Carries numbers only. */
    private readonly onClamp?: (setting: number, ceiling: number) => void,
  ) {}
  private lastClamped: number | undefined;

  get currentShare(): number | undefined {
    return this.lastValid;
  }

  async refreshBudgetShare(): Promise<void> {
    const parsed = z
      .number()
      .gt(0)
      .max(1)
      .safeParse(await this.readShare());
    if (parsed.success) {
      // ADR 0005: the setting can be written through the API login, so the environment ceiling wins.
      const effective = Math.min(parsed.data, this.ceiling);
      if (parsed.data > this.ceiling) {
        if (this.lastClamped !== parsed.data) {
          this.lastClamped = parsed.data;
          this.onClamp?.(parsed.data, this.ceiling);
        }
      } else {
        this.lastClamped = undefined;
      }
      this.lastValid = effective;
      if (this.handle) (await this.handle).setMaxShare(effective);
      return;
    }
    if (this.lastValid === undefined) {
      throw new Error('budget.max_share is missing or invalid and there is no earlier valid value');
    }
    this.log.warn(
      `budget.max_share is invalid: keeping the last valid share (${this.lastValid}); fix the setting`,
    );
  }

  private connector(): Promise<DatomsConnectorHandle> {
    if (this.lastValid === undefined) {
      return Promise.reject(new Error('budget share not read yet: call refreshBudgetShare first'));
    }
    const share = this.lastValid;
    // A failed creation is not cached: the next run tries again.
    this.handle ??= Promise.resolve()
      .then(() => this.create(share))
      .catch((error: unknown) => {
        this.handle = undefined;
        throw new Error(`could not create the DATOMS connector: ${sanitizeErrorText(error)}`);
      });
    return this.handle;
  }

  async listAssets(options?: ListAssetsOptions): Promise<SourceCatalogue> {
    return (await this.connector()).connector.listAssets(options);
  }

  async *readLatest(scope: ReadScope): AsyncGenerator<SourceReadingBatch> {
    yield* (await this.connector()).connector.readLatest(scope);
  }

  async listSites(): Promise<SourceSite[]> {
    const c = (await this.connector()).connector;
    return c.listSites ? c.listSites() : [];
  }
}
