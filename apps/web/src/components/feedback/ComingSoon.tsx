/** Placeholder for a reserved slot (weather, manpower, materials, gallery) behind a feature flag. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <section
      aria-label={title}
      className="rounded-md border border-dashed border-border-strong p-4"
      data-state="coming-soon"
    >
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-fg-muted">Coming later.</p>
    </section>
  );
}
