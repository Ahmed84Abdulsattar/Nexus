/**
 * The nine state and status tokens from docs/11, with demo labels for the components page only.
 * Real screens take labels and tokens from the API (`status.display`, project `state`).
 */
export const SWATCHES = [
  { token: 'state-active', label: 'Active (demo label)' },
  { token: 'state-central-store', label: 'Central store (demo label)' },
  { token: 'state-finished', label: 'Finished (demo label)' },
  { token: 'state-in-bid', label: 'In bid (demo label)' },
  { token: 'status-running', label: 'Running (demo label)' },
  { token: 'status-idle', label: 'Idle (demo label)' },
  { token: 'status-maintenance', label: 'Maintenance (demo label)' },
  { token: 'status-off', label: 'Off (demo label)' },
  { token: 'status-unknown', label: 'Unknown (demo label)', hollow: true },
] as const;
