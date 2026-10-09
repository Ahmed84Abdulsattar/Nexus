import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { resolveAccessPolicy, type AccessPolicy } from '../../src/common/auth/access-policy.js';

// Values of PATH_METADATA / METHOD_METADATA in @nestjs/common/constants (not exported by the package).
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

export interface RegisteredHandler {
  controller: string;
  handler: string;
  httpMethod: number;
  policy: AccessPolicy;
}

/**
 * Every route handler of every controller registered in the app, with its access policy, read
 * from Nest metadata (not from source text).
 */
export function scanHandlers(app: INestApplication): RegisteredHandler[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer));
  const scanner = new MetadataScanner();
  const reflector = new Reflector();
  const out: RegisteredHandler[] = [];
  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype;
    const instance: unknown = wrapper.instance;
    if (!metatype || !instance) continue;
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const fn = prototype[name];
      if (typeof fn !== 'function') continue;
      const isRoute =
        Reflect.getMetadata(PATH_METADATA, fn) !== undefined &&
        Reflect.getMetadata(METHOD_METADATA, fn) !== undefined;
      if (!isRoute) continue;
      out.push({
        controller: metatype.name,
        handler: name,
        httpMethod: Reflect.getMetadata(METHOD_METADATA, fn) as number,
        policy: resolveAccessPolicy(reflector, fn, metatype),
      });
    }
  }
  return out;
}

/** Handlers that do not have exactly one valid access decorator. */
export function unprotected(handlers: RegisteredHandler[]): RegisteredHandler[] {
  return handlers.filter((h) => h.policy.kind === 'none' || h.policy.kind === 'conflict');
}
