import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Use this instead of nestjs-zod's createZodDto for every DTO.
 *
 * Why: zod 4 writes `z.string().nullable()` as `type: ["string", "null"]` (valid OpenAPI 3.1).
 * @nestjs/swagger reads a property whose `type` is an array as "an array of ...", so the document
 * said `type: array, items: string` and the generated client got `string[]` for a nullable string.
 * Here every top-level property with such a type is rewritten to `anyOf: [{ type: X }, { type:
 * "null" }]` before swagger sees it, with the value constraints (format, minimum, ...) kept on the
 * non-null branch. See apps/api/test/openapi.test.ts.
 */

type Props = Record<string, Record<string, unknown>>;
type Factory = () => Props;

// Keys that describe the value itself; they stay on the non-null branch of the anyOf.
const VALUE_KEYS = new Set([
  'format',
  'pattern',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'items',
  'minItems',
  'maxItems',
  'properties',
  'additionalProperties',
]);

/** Exported for the tests. */
export function nullableTypesToAnyOf(properties: Props): Props {
  const out: Props = {};
  for (const [key, prop] of Object.entries(properties)) {
    const type = prop['type'];
    if (!Array.isArray(type) || !type.includes('null')) {
      out[key] = prop;
      continue;
    }
    const value: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prop)) {
      if (k === 'type') continue;
      (VALUE_KEYS.has(k) ? value : rest)[k] = v;
    }
    const branches = type.filter((t) => t !== 'null').map((t) => ({ type: t, ...value }));
    // type '' is what nestjs-zod already uses for "no single type"; its cleanup removes it.
    out[key] = { ...rest, type: '', anyOf: [...branches, { type: 'null' }] };
  }
  return out;
}

/** Every DTO schema made here, so a test can check each one against the document. */
export const registeredSchemas: z.ZodType[] = [];

export function createDto<T extends z.ZodType>(schema: T) {
  const Base = createZodDto(schema);
  const patch = (cls: { _OPENAPI_METADATA_FACTORY?: Factory }): void => {
    const original = cls._OPENAPI_METADATA_FACTORY?.bind(cls);
    if (original) cls._OPENAPI_METADATA_FACTORY = () => nullableTypesToAnyOf(original());
  };
  patch(Base as never);
  const outputDescriptor = Object.getOwnPropertyDescriptor(Base, 'Output');
  if (outputDescriptor?.get) {
    const getOutput = outputDescriptor.get;
    Object.defineProperty(Base, 'Output', {
      get(this: unknown) {
        // `this` is the subclass, so the component is named after it (MeResponseDto_Output).
        const output = getOutput.call(this) as { _OPENAPI_METADATA_FACTORY?: Factory };
        patch(output);
        return output;
      },
    });
  }
  registeredSchemas.push(schema);
  return Base;
}
