/** Placeholder for a reserved slot (weather, manpower, materials, gallery) behind a feature flag. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-dashed border-border-strong bg-surface-raised p-5"
      data-state="coming-soon"
    >
      <h2 className="font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-0.5 text-xs font-medium text-fg-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
        Coming later.
      </p>
    </section>
  );
}
