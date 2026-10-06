import { createHmac } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ALL_MCP_SCOPES, type Identity } from './identity.js';

/** Read a secret string; JSON secrets of the form {"value": "..."} or generated {"seed": "..."} are unwrapped. */
export async function readSecret(arn: string, client = new SecretsManagerClient({})): Promise<string> {
  const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  const raw = out.SecretString ?? '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed.value ?? parsed.seed ?? parsed.secret;
    if (typeof v === 'string' && v) return v;
  } catch {
    /* plain string secret */
  }
  if (!raw) throw new Error(`Secret ${arn} is empty`);
  return raw;
}

/**
 * Hosted-demo persona tokens are derived from one secret seed, so no token is ever stored in config or code.
 * `scripts/demo-tokens.mjs` prints them for the judges' testing instructions.
 */
export function deriveDemoToken(seed: string, persona: 'asha' | 'priya' | 'tv'): string {
  return `kw_${persona}_${createHmac('sha256', seed).update(`kinwise-demo:${persona}`).digest('base64url').slice(0, 32)}`;
}

export function demoTokenIdentities(seed: string, householdId: string): Record<string, Identity> {
  return {
    [deriveDemoToken(seed, 'asha')]: { userId: 'asha', householdId, role: 'resident', name: 'Asha', scopes: [...ALL_MCP_SCOPES] },
    [deriveDemoToken(seed, 'priya')]: { userId: 'priya', householdId, role: 'caregiver', name: 'Priya', scopes: [...ALL_MCP_SCOPES] },
    [deriveDemoToken(seed, 'tv')]: { userId: 'tv-living-room', householdId, role: 'device', name: 'Living room TV', scopes: [] },
  };
}
