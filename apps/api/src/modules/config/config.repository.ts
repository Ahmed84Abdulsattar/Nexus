import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@nexus/db';
import { DB } from '../../common/db/database.module.js';

export const CLIENT_CONFIG_REPOSITORY = Symbol('CLIENT_CONFIG_REPOSITORY');

/** Reads for GET /v1/config. Settings, not project data, so no withProjectScope. */
export interface ClientConfigRepository {
  /** core.feature_flag as stored. */
  featureFlags(): Promise<Record<string, boolean>>;
  /** Distinct telemetry.status_map.display_status values. */
  displayStatusKeys(): Promise<string[]>;
}

@Injectable()
export class PostgresClientConfigRepository implements ClientConfigRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async featureFlags(): Promise<Record<string, boolean>> {
    const rows = await this.db
      .selectFrom('core.feature_flag')
      .select(['key', 'enabled'])
      .orderBy('key')
      .execute();
    return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
  }

  async displayStatusKeys(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('telemetry.status_map')
      .select('display_status')
      .distinct()
      .orderBy('display_status')
      .execute();
    return rows.map((r) => r.display_status);
  }
}
