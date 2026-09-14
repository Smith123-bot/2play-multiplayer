import { describe, expect, it } from 'vitest';
import { socketClientKey } from './clientIp';

describe('socketClientKey (proxy-aware rate-limit key)', () => {
  const handshake = (headers: Record<string, string>, address = '10.0.0.1') => ({
    address,
    headers,
  });

  it('uses the raw socket address when no proxy is trusted (default)', () => {
    // TRUST_PROXY = 0 must ignore X-Forwarded-For entirely so the key cannot
    // be spoofed on a direct deployment.
    const key = socketClientKey(handshake({ 'x-forwarded-for': '1.2.3.4' }), 0);
    expect(key).toBe('10.0.0.1');
  });

  it('resolves the client behind exactly one trusted hop', () => {
    const key = socketClientKey(handshake({ 'x-forwarded-for': '1.2.3.4' }), 1);
    expect(key).toBe('1.2.3.4');
  });

  it('trusts only the configured number of hops from the right', () => {
    // client, proxy1, proxy2 — trusting 1 hop yields proxy2 (the immediate peer).
    const key = socketClientKey(handshake({ 'x-forwarded-for': '1.2.3.4, 10.0.0.2, 10.0.0.3' }), 1);
    expect(key).toBe('10.0.0.3');
    // Trusting 2 hops yields proxy1.
    const key2 = socketClientKey(handshake({ 'x-forwarded-for': '1.2.3.4, 10.0.0.2, 10.0.0.3' }), 2);
    expect(key2).toBe('10.0.0.2');
    // Trusting all 3 hops yields the real client.
    const key3 = socketClientKey(handshake({ 'x-forwarded-for': '1.2.3.4, 10.0.0.2, 10.0.0.3' }), 3);
    expect(key3).toBe('1.2.3.4');
  });

  it('never trusts beyond the configured hops (short chain fails closed)', () => {
    // Chain shorter than the trust: the socket address wins.
    const key = socketClientKey(handshake({ 'x-forwarded-for': '1.2.3.4' }), 3);
    expect(key).toBe('10.0.0.1');
  });

  it('falls back to the socket address without the header', () => {
    const key = socketClientKey(handshake({}), 1);
    expect(key).toBe('10.0.0.1');
  });

  it('rejects malformed or oversized header values', () => {
    expect(socketClientKey(handshake({ 'x-forwarded-for': ',,,' }), 1)).toBe('10.0.0.1');
    expect(socketClientKey(handshake({ 'x-forwarded-for': 'x'.repeat(5000) }), 1)).toBe('10.0.0.1');
  });

  it('accepts the array form of the header', () => {
    const key = socketClientKey(
      { address: '10.0.0.1', headers: { 'x-forwarded-for': ['1.2.3.4'] } },
      1,
    );
    expect(key).toBe('1.2.3.4');
  });
});
