import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "I'm calling now" button in a push notification. The phone has no login, so the link itself
 * carries the authority: which household and which call, HMAC-signed and valid for an hour.
 */

export const ACK_URL_TTL_S = 60 * 60;

export interface AckClaim {
  householdId: string;
  callId: string;
}

/** Derived from the hub's ingest secret with its own label, so a speech link can never stand in for it. */
export function ackKey(secret: string): string {
  return createHmac('sha256', secret).update('kinwise-ack-url').digest('hex');
}

function mac(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url').slice(0, 32);
}

export function signAck(key: string, claim: AckClaim, nowMs: number, ttlS = ACK_URL_TTL_S): string {
  const payload = Buffer.from(JSON.stringify({ h: claim.householdId, k: claim.callId, e: Math.floor(nowMs / 1000) + ttlS })).toString('base64url');
  return `${payload}.${mac(key, payload)}`;
}

/** The claim a link carries, or undefined if it is forged, malformed or expired. */
export function verifyAck(key: string, token: string, nowMs: number): AckClaim | undefined {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return undefined;
  const expected = mac(key, payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
  try {
    const { h, k, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { h?: unknown; k?: unknown; e?: unknown };
    if (typeof h !== 'string' || typeof k !== 'string' || typeof e !== 'number' || e * 1000 < nowMs) return undefined;
    return { householdId: h, callId: k };
  } catch {
    return undefined;
  }
}
