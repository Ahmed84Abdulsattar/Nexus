import type { MapMode } from './types';

const MODES: { value: MapMode; label: string }[] = [
  { value: '2d', label: '2D' },
  { value: 'satellite', label: 'Satellite' },
  { value: '3d', label: '3D' },
];

/**
 * The 2D / Satellite / 3D radio group (docs/09 section 4). The labels are map modes, not data.
 * Put it in the `overlays` of MapView or beside it.
 */
export function ModeSwitch({
  mode,
  onChange,
  className,
}: {
  mode: MapMode;
  onChange(mode: MapMode): void;
  className?: string;
}) {
  return (
    <fieldset
      className={`pointer-events-auto inline-flex gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-pop ${className ?? ''}`}
    >
      <legend className="sr-only">Map mode</legend>
      {MODES.map(({ value, label }) => (
        <label
          key={value}
          className="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium text-fg transition-colors hover:bg-surface has-checked:bg-primary has-checked:font-semibold has-checked:text-primary-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
        >
          <input
            type="radio"
            name="map-mode"
            value={value}
            checked={mode === value}
            onChange={() => onChange(value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
