import { STATE_STATUS_TOKENS, type StateStatusToken } from '../../styles/tokens';
import type { MapMarker } from './types';

/**
 * The token that colours a marker (docs/11 rule 1: colours only from the API's state or status).
 * A project uses a `state-*` token and an asset a `status-*` token, so `unknown` is unambiguous.
 * A key with no token (a new API value) falls back to the neutral `status-unknown`, never a guess.
 */
export function markerToken(marker: Pick<MapMarker, 'kind' | 'colorKey'>): StateStatusToken {
  const prefix = marker.kind === 'project' ? 'state' : 'status';
  const candidate = `${prefix}-${marker.colorKey.replaceAll('_', '-')}`;
  return STATE_STATUS_TOKENS.find((token) => token === candidate) ?? 'status-unknown';
}

/** Resolves a token to its current CSS colour (light or dark theme) from tokens.css. */
export function readTokenColor(token: string, root: Element = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(`--${token}`).trim();
}
