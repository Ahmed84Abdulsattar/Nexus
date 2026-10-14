import {
  type Expression,
  type ExpressionBuilder,
  type SelectQueryBuilder,
  type SqlBool,
  type StringReference,
  sql,
} from 'kysely';
import type { AccessContext } from './access-context.js';

/**
 * Project scope for Kysely queries (docs/08 section 2 step 5, docs/06 section 5, CLAUDE.md rule 6).
 * Every repository query that returns project data goes through this, never a controller:
 *
 *   withProjectScope(db.selectFrom('core.asset as a').select(...), access, 'a.project_id')
 *
 * - a user whose role has all_projects is not filtered;
 * - everybody else sees only rows whose project is in their project ids;
 * - a user with no projects sees nothing (never "no filter").
 * Pass the column that holds the project id (`p.id` when the table is core.project). Rows whose
 * column is NULL (an asset not yet linked to a project) are never visible to a scoped user.
 */
export function projectScope<DB, TB extends keyof DB>(
  access: AccessContext,
  column: StringReference<DB, TB>,
): (eb: ExpressionBuilder<DB, TB>) => Expression<SqlBool> {
  return (eb) => {
    if (access.allProjects) return sql<SqlBool>`true`;
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
): SelectQueryBuilder<DB, TB, O> {
  if (access.allProjects) return qb;
  return qb.where(projectScope<DB, TB>(access, column));
}
