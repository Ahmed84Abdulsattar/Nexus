import { cn } from '../ui/cn';

/**
 * The Innovo graphic device: large Aqua circles and rings on Slate, plus one solid Aqua dot.
 * Decorative only (aria-hidden). Place it inside a `relative overflow-hidden` Slate panel; it fills
 * the panel and is clipped by it. Colours come from the brand tokens.
 */
export function BrandRings({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 300 300"
      preserveAspectRatio="xMidYMid slice"
      className={cn(
        'pointer-events-none absolute top-0 right-0 h-1/2 w-full md:inset-y-0 md:h-full md:w-3/5',
        className,
      )}
      fill="none"
    >
      <circle
        cx="210"
        cy="150"
        r="150"
        stroke="var(--brand-aqua)"
        strokeOpacity="0.14"
        strokeWidth="1.5"
      />
      <circle
        cx="210"
        cy="150"
        r="110"
        stroke="var(--brand-aqua)"
        strokeOpacity="0.28"
        strokeWidth="1.5"
      />
      <circle
        cx="210"
        cy="150"
        r="72"
        stroke="var(--brand-aqua)"
        strokeOpacity="0.55"
        strokeWidth="2"
      />
      <circle cx="210" cy="150" r="38" fill="var(--brand-aqua)" fillOpacity="0.1" />
      <circle cx="210" cy="150" r="8" fill="var(--brand-aqua)" />
    </svg>
  );
}
