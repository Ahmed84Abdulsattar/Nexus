import { ApiError } from './client';

export type ErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'invalid'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'unknown';

/** What the UI shows for a failed request. Plain text only; nothing here is ever rendered as HTML. */
export interface ErrorView {
  kind: ErrorKind;
  /** Our own headline for the situation. */
  title: string;
  /** Our own explanation (includes the Retry-After wait for 429). */
  message: string;
  /** The API's problem+json `title` and `detail`, when it sent them. Shown as text. */
  problemTitle?: string;
  problemDetail?: string;
  correlationId?: string;
  retryAfterSeconds?: number;
}

const MAX_TEXT = 300;

/** Keeps API-provided text short and free of control characters. */
function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function byStatus(
  status: number,
  retryAfter?: number,
): Pick<ErrorView, 'kind' | 'title' | 'message'> {
  if (status === 401) {
    // TODO(S0-08): once MSAL sign-in exists, start the sign-in redirect from here.
    return {
      kind: 'unauthenticated',
      title: 'Sign-in needed',
      message: 'You need to sign in to see this. Sign-in is not available yet.',
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      title: 'No access',
      message: 'You do not have access to this. Ask an administrator if you think you should.',
    };
  }
  if (status === 404) {
    return {
      kind: 'not-found',
      title: 'Not found',
      message: 'This does not exist, or it is not available to you.',
    };
  }
  if (status === 429) {
    return {
      kind: 'rate-limited',
      title: 'Too many requests',
      message:
        retryAfter === undefined
          ? 'Too many requests. Wait a moment, then try again.'
          : `Too many requests. Retry after ${retryAfter} s.`,
    };
  }
  if (status === 422 || status === 400) {
    return {
      kind: 'invalid',
      title: 'Request not accepted',
      message: 'The request was not accepted.',
    };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      title: 'Service problem',
      message: 'The service had a problem. Try again in a moment.',
    };
  }
  return { kind: 'unknown', title: 'Something went wrong', message: 'The request failed.' };
}

/** Maps any thrown value from the generated client to what the UI shows. Never exposes stack traces. */
export function describeError(error: unknown): ErrorView {
  if (error instanceof ApiError) {
    const view: ErrorView = { ...byStatus(error.status, error.retryAfterSeconds) };
    const title = clean(error.problem?.title);
    const detail = clean(error.problem?.detail);
    const correlationId = clean(error.problem?.correlationId);
    if (title) view.problemTitle = title;
    if (detail) view.problemDetail = detail;
    if (correlationId) view.correlationId = correlationId;
    if (error.retryAfterSeconds !== undefined) view.retryAfterSeconds = error.retryAfterSeconds;
    return view;
  }
  if (error instanceof TypeError) {
    // fetch() rejects with TypeError when the network is down or the request was blocked.
    return {
      kind: 'network',
      title: 'Cannot reach the service',
      message: 'Check your connection, then try again.',
    };
  }
  return { kind: 'unknown', title: 'Something went wrong', message: 'The request failed.' };
}

/** TanStack Query retry policy: never retry 4xx (including 429); retry 5xx and network errors twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) return error.status >= 500;
  return error instanceof TypeError;
}

/** Exponential back-off: 1 s, 2 s, 4 s … capped at 10 s. */
export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000);
}
