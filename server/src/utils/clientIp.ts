interface HandshakeLike {
  address?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Proxy-aware client key for rate limiting.
 *
 * Direct deployments (TRUST_PROXY = 0, the default) use the raw socket
 * address — the same value the HTTP side uses via `req.ip`, and header values
 * are ignored so the key cannot be spoofed.
 *
 * Reverse-proxy deployments opt in with TRUST_PROXY = <hop count>, mirroring
 * Express' `trust proxy` semantics: exactly the last `hops` entries of
 * `X-Forwarded-For` are trusted (each trusted proxy appends the address it
 * forwarded). If the chain is shorter than the configured trust, the socket
 * address wins — a shorter chain must never widen the trust.
 *
 * Without this, every player behind one proxy shares a single limiter bucket
 * and the whole deployment intermittently refuses connections (reported as
 * "the server keeps disappearing"), while a direct deployment is unaffected.
 */
export function socketClientKey(
  handshake: HandshakeLike,
  trustProxyHops: number,
  fallback?: string,
): string {
  const address = handshake.address || fallback || 'unknown';
  if (!Number.isInteger(trustProxyHops) || trustProxyHops <= 0) return address;

  const raw = handshake.headers?.['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string' || header.length === 0 || header.length > 4096) return address;

  const chain = header.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  const index = chain.length - trustProxyHops;
  if (index < 0) return address;
  const candidate = chain[index];
  return candidate && candidate.length > 0 ? candidate : address;
}
