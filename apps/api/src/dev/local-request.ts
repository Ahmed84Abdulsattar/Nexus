import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'];

/**
 * Whether a request looks like it came from a browser or tool on this machine, talking to this
 * machine's API directly (docs/08 section 7). Returns the reason it does not, or null.
 *  - the socket peer (never `request.ip`, which a trusted proxy header could set) is loopback;
 *  - no forwarding header: a tunnel or local reverse proxy would add one, and none is trusted here;
 *  - `Host` is localhost / 127.0.0.1 / [::1] (a rebound DNS name or a tunnel host name is refused);
 *  - an `Origin`, when present, is one of the configured CORS origins.
 */
export function remoteRequestReason(
  headers: IncomingHttpHeaders,
  peer: string | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (peer === undefined || !LOOPBACK_PEERS.has(peer)) return 'peer is not loopback';
  for (const name of FORWARDING_HEADERS) {
    if (headers[name] !== undefined) return `forwarding header ${name}`;
  }
  const host = headers['host'];
  if (typeof host !== 'string' || !LOCAL_HOST_HEADER.test(host)) return 'Host is not local';
  const origin = headers['origin'];
  if (origin !== undefined && (typeof origin !== 'string' || !allowedOrigins.includes(origin))) {
    return 'Origin is not allowed';
  }
  return null;
}
