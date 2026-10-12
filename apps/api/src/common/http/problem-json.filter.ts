import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { PROBLEM_JSON, type ProblemDetails, type ProblemFieldError } from '@nexus/shared';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

interface Reply {
  status(code: number): Reply;
  header(name: string, value: string): Reply;
  send(body: unknown): Reply;
}
interface Req {
  id?: string;
  headers: Record<string, string | string[] | undefined>;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

/**
 * RFC 9457 errors for every response (docs/10): { type, title, status, detail, correlationId }.
 * The body matches `problemDetailsSchema` in @nexus/shared, which is also the OpenAPI component.
 * Input that fails a zod DTO is 422 with the field failures in `errors` (docs/10), not Nest's 400.
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<Reply>();
    const request = http.getRequest<Req>();

    const cid = correlationId(request);
    let status = 500;
    let detail = GENERIC_DETAIL;
    let errors: ProblemFieldError[] | undefined;
    if (exception instanceof ZodValidationException) {
      status = 422;
      const issues = (exception.getZodError() as ZodError).issues;
      errors = issues.slice(0, MAX_FIELD_ERRORS).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      const omitted = issues.length - errors.length;
      detail =
        'The request did not pass validation.' +
        (omitted > 0 ? ` ${omitted} more error${omitted === 1 ? '' : 's'} not shown.` : '');
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      detail = detailFor(status, () => messageOf(exception));
    } else {
      // Errors raised by the framework itself (malformed JSON, oversized body) carry a 4xx code.
      const code = (exception as { statusCode?: unknown } | null)?.statusCode;
      if (typeof code === 'number' && code >= 400 && code < 500) {
        status = code;
        detail = detailFor(status, () => GENERIC_DETAIL);
      }
    }
    if (status >= 500) {
      // Never put the cause in the response; the correlationId links it to this log line.
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`status=${status} correlationId=${cid ?? '-'} ${stack}`);
    }

    reply.status(status).header('content-type', PROBLEM_JSON);
    if (status === 401) reply.header('www-authenticate', 'Bearer');
    const body: ProblemDetails = {
      type: 'about:blank',
      title: TITLES[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error'),
      status,
      detail,
      correlationId: cid,
      ...(errors ? { errors } : {}),
    };
    reply.send(body);
  }
}

const GENERIC_DETAIL = 'Unexpected error.';
const MAX_FIELD_ERRORS = 20;
/** Only these statuses may show the handler's own message; everything else gets fixed text. */
const OWN_MESSAGE = new Set([401, 403, 409, 429]);

function detailFor(status: number, own: () => string): string {
  if (OWN_MESSAGE.has(status)) return own();
  if (status === 404) return 'Not found.';
  if (status >= 500) return GENERIC_DETAIL;
  return `${TITLES[status] ?? 'Request error'}.`;
}

function messageOf(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : exception.message;
}

function correlationId(request: Req): string | undefined {
  const header = request.headers['x-correlation-id'];
  const value = Array.isArray(header) ? header[0] : header;
  // Echo a caller-supplied id only if it is short and harmless.
  if (value && /^[\w-]{1,64}$/.test(value)) return value;
  return request.id;
}
