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

/**
 * Innovo brand palette (Brand Guidelines 1.9) as token names. The hex values are NOT written here:
 * the components page reads them from tokens.css at run time (the only place colours are defined).
 */
export const BRAND_COLOURS = [
  { group: 'Primary', name: 'Slate', token: 'brand-slate', use: 'Text, header, dark surfaces' },
  { group: 'Primary', name: 'Aqua', token: 'brand-aqua', use: 'Accent, dark-theme actions' },
  { group: 'Primary', name: 'White', token: 'brand-white', use: 'Surfaces, text on Slate' },
  { group: 'Secondary', name: 'Grey', token: 'brand-grey', use: 'Muted text on Slate' },
  { group: 'Secondary', name: 'Steel', token: 'brand-steel', use: 'Strong borders' },
  { group: 'Secondary', name: 'Sky', token: 'brand-sky', use: 'Small supporting accents' },
  { group: 'Support', name: 'Red', token: 'brand-support-red', use: 'Data only' },
  { group: 'Support', name: 'Teal', token: 'brand-support-teal', use: 'Data only' },
  { group: 'Support', name: 'Periwinkle', token: 'brand-support-periwinkle', use: 'Data only' },
  { group: 'Support', name: 'Blue', token: 'brand-support-blue', use: 'Data only' },
  { group: 'Support', name: 'Sand', token: 'brand-support-sand', use: 'Data only' },
  { group: 'Support', name: 'Yellow', token: 'brand-support-yellow', use: 'Data only' },
] as const;
