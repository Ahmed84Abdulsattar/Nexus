import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@nexus/db';
import { DB } from '../../common/db/database.module.js';

export interface StoredProfile {
  name: string | null;
  email: string | null;
}

export const ME_REPOSITORY = Symbol('ME_REPOSITORY');

/** The caller's own stored profile. Not project data, so no withProjectScope. */
export interface MeRepository {
  profile(userId: string): Promise<StoredProfile>;
}

@Injectable()
export class PostgresMeRepository implements MeRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async profile(userId: string): Promise<StoredProfile> {
    const row = await this.db
      .selectFrom('access.app_user')
      .select(['display_name', 'email'])
      .where('id', '=', userId)
      .executeTakeFirst();
    return { name: row?.display_name ?? null, email: row?.email ?? null };
  }
}
