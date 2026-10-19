const dubai = 'Asia/Dubai';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: dubai });
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: dubai,
});
const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Dubai',
});

/**
 * A single live value with its freshness. `null`/`undefined` renders "—" (never 0) with the
 * last-known time when there is one. `stale` comes from the API; this component never works it out.
 */
export function Value({
  value,
  unit,
  updatedAt,
  stale = false,
}: {
  value: string | number | null | undefined;
  unit?: string;
  updatedAt?: string | null;
  stale?: boolean;
}) {
  // Missing: null, undefined, blank text or a non-finite number. A real 0 is not missing.
  const missing =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (typeof value === 'number' && !Number.isFinite(value));
  const when = updatedAt ? new Date(updatedAt) : undefined;
  const validTime = when !== undefined && !Number.isNaN(when.getTime());
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2" data-stale={stale || undefined}>
      {missing ? (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">No data yet</span>
        </>
      ) : (
        <span>
          {value}
          {unit ? ` ${unit}` : ''}
        </span>
      )}
      {stale ? <span className="text-xs text-fg-muted">Stale</span> : null}
      {validTime ? (
        <time dateTime={when.toISOString()} className="text-xs text-fg-muted">
          updated{' '}
          {dayKey.format(when) === dayKey.format(new Date())
            ? time.format(when)
            : dateTime.format(when)}
        </time>
      ) : null}
    </span>
  );
}
