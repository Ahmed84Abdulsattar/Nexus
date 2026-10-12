import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  type OperationObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { PROBLEM_JSON } from '@nexus/shared';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { BEARER_AUTH } from '../common/auth/decorators.js';
import { ProblemDetails } from '../common/http/problem.dto.js';

export const DOCS_PATH = 'docs';
export const OPENAPI_JSON_PATH = 'openapi.json';

const PROBLEM_REF = { $ref: '#/components/schemas/ProblemDetails' };
const problemResponse = (description: string): Record<string, unknown> => ({
  description,
  content: { [PROBLEM_JSON]: { schema: PROBLEM_REF } },
});

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'];

/**
 * Builds the OpenAPI 3.1 document from the running route table. Error responses are added here,
 * from facts already in the document, so no handler has to repeat them (docs/10 "Errors"):
 * - 401 and 403 on every route that needs a token (it has the bearer `security` requirement);
 * - 404 on every route with a path parameter (unknown id, or out of the caller's project scope);
 * - 422 on every route that takes a body or query parameters.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Nexus API')
    .setDescription(
      'Read-only monitoring API for Innovo construction sites. Errors are application/problem+json (RFC 9457).',
    )
    .setVersion('1')
    .setOpenAPIVersion('3.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'Entra ID access token' },
      BEARER_AUTH,
    )
    .build();
  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, config, { extraModels: [ProblemDetails] }),
  );

  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item) as [string, OperationObject][]) {
      if (!HTTP_METHODS.includes(method) || typeof operation !== 'object') continue;
      const responses = (operation.responses ??= {});
      const add = (status: string, description: string): void => {
        responses[status] ??= problemResponse(description) as never;
      };
      if (operation.security?.length) {
        add('401', 'Missing, expired or invalid token.');
        add('403', 'Valid token, but missing the access_as_user scope or the required permission.');
      }
      if (/\{[^}]+\}/.test(path)) add('404', "Not found, or out of the caller's project scope.");
      const takesInput =
        operation.requestBody !== undefined ||
        operation.parameters?.some((p) => 'in' in p && p.in === 'query');
      if (takesInput) add('422', 'Validation failed; see `errors`.');
    }
  }
  return document;
}

/**
 * Swagger UI at /docs and the spec at /openapi.json, for local and dev only. In prod neither is
 * mounted (docs/10). Returns whether they were mounted.
 */
export function mountDocs(app: INestApplication, appEnv: 'local' | 'dev' | 'prod'): boolean {
  if (appEnv === 'prod') return false;
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app), {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
  });
  return true;
}
