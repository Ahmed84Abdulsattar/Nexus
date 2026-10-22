const MAX_CHARS = 300;

/**
 * Error text that is safe to log and to store in `sync_run.error` (L2). Database driver errors can
 * carry connection details or row values, so for those only the name and the SQLSTATE code are
 * kept. Everything else is cut to about 300 characters with control characters removed.
 */
export function sanitizeErrorText(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
    return `${clean(error.name)} (SQLSTATE ${code})`;
  }
  return clean(`${error.name}: ${error.message}`);
}

function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return stripped.length > MAX_CHARS ? `${stripped.slice(0, MAX_CHARS)}...` : stripped;
}
