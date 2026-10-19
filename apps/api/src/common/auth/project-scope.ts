import {
  type Expression,
  type ExpressionBuilder,
  type SelectQueryBuilder,
  type SqlBool,
  type StringReference,
  sql,
} from 'kysely';
import type { AccessContext } from './access-context.js';

export interface ProjectScopeOptions {
  /**
   * Also return rows with no project (assets not yet linked, docs/06 decision 8). Only the admin
   * linking screen passes this, and the caller must hold `admin.projects.manage` (docs/08 section 3, R-63);
   * otherwise an error is thrown, so a misuse cannot go unnoticed.
   */
  includeUnlinked?: boolean;
}

/**
 * Project scope for Kysely queries (docs/08 section 2 step 5, docs/06 section 5, CLAUDE.md rule 6).
 * Every repository query that returns project data goes through this, never a controller:
 *
 *   withProjectScope(db.selectFrom('core.asset as a').select(...), access, 'a.project_id')
 *
 * - a user whose role has all_projects is not filtered by project, but rows without a project (unlinked
 *   assets) are still left out unless `{ includeUnlinked: true }` is passed;
 * - everybody else sees only rows whose project is in their project ids (rows without a project never match);
 * - a user with no projects sees nothing (never "no filter").
 * Pass the column that holds the project id (`p.id` when the table is core.project).
 */
export function projectScope<DB, TB extends keyof DB>(
  access: AccessContext,
  column: StringReference<DB, TB>,
  options: ProjectScopeOptions = {},
): (eb: ExpressionBuilder<DB, TB>) => Expression<SqlBool> {
  if (options.includeUnlinked && !access.permissions.has('admin.projects.manage')) {
    throw new Error('includeUnlinked requires the admin.projects.manage permission');
  }
  return (eb) => {
    if (access.allProjects) {
      return options.includeUnlinked
        ? sql<SqlBool>`true`
        : sql<SqlBool>`${eb.ref(column)} is not null`;
    }
    const ids = [...access.projectIds];
    if (ids.length === 0) return sql<SqlBool>`false`;
    return sql<SqlBool>`${eb.ref(column)} = any(${ids}::uuid[])`;
  };
}

/** Adds the project-scope condition to a select (also usable on update and delete builders via {@link projectScope}). */
export function withProjectScope<DB, TB extends keyof DB, O>(
  qb: SelectQueryBuilder<DB, TB, O>,
  access: AccessContext,
  column: StringReference<DB, TB>,
  options: ProjectScopeOptions = {},
): SelectQueryBuilder<DB, TB, O> {
  return qb.where(projectScope<DB, TB>(access, column, options));
}
