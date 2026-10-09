import type { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@nexus/shared';
import { ANY_SIGNED_IN_KEY, PUBLIC_KEY, REQUIRE_PERMISSION_KEY } from './decorators.js';

/** A class or a handler function: what Reflector reads metadata from. */
type Target = Parameters<Reflector['get']>[1];

export type AccessPolicy =
  | { kind: 'public' }
  | { kind: 'any-signed-in' }
  | { kind: 'permission'; keys: PermissionKey[] }
  /** No decorator: default deny. */
  | { kind: 'none' }
  /** More than one of the three decorators on the same level: refused, treated as a bug. */
  | { kind: 'conflict' };

function readLevel(reflector: Reflector, target: Target): AccessPolicy[] {
  const found: AccessPolicy[] = [];
  if (reflector.get<boolean | undefined>(PUBLIC_KEY, target)) found.push({ kind: 'public' });
  if (reflector.get<boolean | undefined>(ANY_SIGNED_IN_KEY, target)) {
    found.push({ kind: 'any-signed-in' });
  }
  const keys = reflector.get<PermissionKey[] | undefined>(REQUIRE_PERMISSION_KEY, target);
  if (keys && keys.length > 0) found.push({ kind: 'permission', keys });
  return found;
}

/**
 * The decorators of the handler win; the class decorators apply only to handlers that have none.
 * Exactly one decorator on the chosen level is valid.
 */
export function resolveAccessPolicy(
  reflector: Reflector,
  handler: Target,
  controller: Target,
): AccessPolicy {
  for (const target of [handler, controller]) {
    const found = readLevel(reflector, target);
    if (found.length > 1) return { kind: 'conflict' };
    if (found[0]) return found[0];
  }
  return { kind: 'none' };
}
