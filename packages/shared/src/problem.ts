import { z } from 'zod';

/** One field-level validation failure, carried in `errors` of a 422 problem. */
export const problemFieldErrorSchema = z
  .object({
    /** Where the failure is, e.g. `limit` or `items.0.name`. Empty for the whole body. */
    path: z.string(),
    message: z.string(),
  })
  .meta({ id: 'ProblemFieldError' });

/**
 * Every error response of the API (docs/10 "Errors"): RFC 9457 `application/problem+json`.
 * `type` is `about:blank` until we publish error-type URIs; `title` is the HTTP status phrase.
 */
export const problemDetailsSchema = z.object({
  type: z
    .string()
    .describe('URI reference for the problem type; about:blank for plain HTTP errors.'),
  title: z.string().describe('Short summary; the HTTP status phrase.'),
  status: z.number().int().min(400).max(599).describe('HTTP status code.'),
  detail: z.string().describe('Human-readable explanation of this occurrence.'),
  correlationId: z
    .string()
    .optional()
    .describe('Echo of X-Correlation-Id, or the request id. Quote it when reporting a problem.'),
  errors: z
    .array(problemFieldErrorSchema)
    .optional()
    .describe('Field-level failures. Present on 422 only.'),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;

export const PROBLEM_JSON = 'application/problem+json';
