import { createHmac, timingSafeEqual } from 'node:crypto';

/** `sha256=<hex>` over the exact raw body bytes. */
export function signBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

export function verifySignature(secret: string, rawBody: string, header: string | undefined | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(signBody(secret, rawBody));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}
