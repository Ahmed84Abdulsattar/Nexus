/**
 * Names of the state and status tokens declared in tokens.css (docs/11). Token names only, never
 * labels or colours. test/tokens-contrast.test.ts checks this list against tokens.css.
 */
export const STATE_STATUS_TOKENS = [
  'state-active',
  'state-central-store',
  'state-finished',
  'state-in-bid',
  'status-running',
  'status-idle',
  'status-maintenance',
  'status-off',
  'status-unknown',
] as const;

export type StateStatusToken = (typeof STATE_STATUS_TOKENS)[number];
