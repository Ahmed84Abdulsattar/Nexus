const icon = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

/**
 * Placeholder. It does nothing yet, so it is disabled rather than pretending to search.
 * Wide screens get the box; phones get an icon button (S1-06 does the full responsive layout).
 */
export function GlobalSearch({ label = 'Global search' }: { label?: string }) {
  return (
    <div
      role="search"
      aria-label={label}
      className="flex min-w-0 flex-1 justify-end md:justify-center"
    >
      <label className="hidden w-full max-w-md items-center gap-2 rounded-full border border-border bg-surface px-4 text-fg-muted focus-within:border-primary md:flex">
        {icon}
        <span className="sr-only">Search</span>
        <input
          type="search"
          disabled
          placeholder="Search projects and assets (coming later)"
          className="min-h-11 w-full min-w-0 bg-transparent text-sm text-fg placeholder:text-fg-muted disabled:cursor-not-allowed"
        />
      </label>
      <button
        type="button"
        disabled
        aria-label="Search (coming later)"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg-muted disabled:cursor-not-allowed md:hidden"
      >
        {icon}
      </button>
    </div>
  );
}
