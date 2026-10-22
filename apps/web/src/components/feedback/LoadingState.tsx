/** Skeleton with an accessible status. Pass `label` to say what is loading. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 p-2">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-5 w-1/3 rounded-md bg-border" />
        <div className="h-4 w-full rounded-md bg-border/70" />
        <div className="h-4 w-2/3 rounded-md bg-border/70" />
      </div>
    </div>
  );
}
