import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Role } from '../domain/types.js';
import { ALL_MCP_SCOPES, AuthError, SCOPES, type Identity } from './identity.js';

export interface TokenVerifier {
  /** Resolve a bearer token to an identity, or throw AuthError(401). */
  verify(token: string): Promise<Identity>;
}

export interface DirectoryEntry {
  householdId: string;
  role: Role;
  name: string;
  /** Member id inside the household; defaults to the directory key. */
  memberId?: string;
}

/** Static tokens for local development and judges running the repo (AUTH_MODE=dev). */
export class StaticTokenVerifier implements TokenVerifier {
  constructor(private readonly tokens: Record<string, Identity>) {}

  async verify(token: string): Promise<Identity> {
    const identity = this.tokens[token];
    if (!identity) throw new AuthError('Unknown or expired token', 401);
    return identity;
  }
}

export function devTokens(householdId: string): Record<string, Identity> {
  return {
    'dev-asha': { userId: 'asha', householdId, role: 'resident', name: 'Asha', scopes: [...ALL_MCP_SCOPES] },
    'dev-priya': { userId: 'priya', householdId, role: 'caregiver', name: 'Priya', scopes: [...ALL_MCP_SCOPES] },
    // Discovery-only service token, like Alexa+'s client_credentials tier.
    'dev-service': { userId: 'alexa-service', householdId, role: 'service', name: 'Alexa+ (service)', scopes: [SCOPES.service] },
    'dev-tv': { userId: 'tv-living-room', householdId, role: 'device', name: 'Living room TV', scopes: [] },
  };
}

/** Strip a Cognito resource-server prefix: "https://api.kinwise.app/mcp:tools" → "mcp:tools". */
export function normalizeScope(scope: string): string {
  const i = scope.lastIndexOf('/');
  return i >= 0 ? scope.slice(i + 1) : scope;
}

/**
 * Verifies Cognito access tokens. Two tiers, mirroring Alexa+:
 *  - client_credentials tokens (no `username`): service identity, discovery scopes only;
 *  - user tokens (auth code + PKCE): mapped to a household member via the directory.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  private readonly verifier;

  constructor(
    opts: { userPoolId: string; clientIds: string[] },
    private readonly directory: Record<string, DirectoryEntry>,
    private readonly serviceHouseholdId: string,
  ) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: opts.userPoolId,
      tokenUse: 'access',
      clientId: opts.clientIds,
    });
  }

  async verify(token: string): Promise<Identity> {
    let claims: Record<string, unknown>;
    try {
      claims = (await this.verifier.verify(token)) as unknown as Record<string, unknown>;
    } catch {
      throw new AuthError('Invalid or expired access token', 401);
    }
    const scopes = String(claims.scope ?? '')
      .split(' ')
      .filter(Boolean)
      .map(normalizeScope);
    const username = typeof claims.username === 'string' ? claims.username : undefined;
    if (!username) {
      return {
        userId: String(claims.client_id ?? claims.sub),
        householdId: this.serviceHouseholdId,
        role: 'service',
        name: 'Alexa+ (service)',
        scopes: scopes.filter((s) => s === SCOPES.service),
      };
    }
    const entry = this.directory[username];
    if (!entry) throw new AuthError('This account is not linked to a Kinwise household', 403, 'forbidden');
    return { userId: entry.memberId ?? username, householdId: entry.householdId, role: entry.role, name: entry.name, scopes };
  }
}

/** Accept the first verifier that recognises the token (e.g. device tokens, then Cognito). */
export class ChainVerifier implements TokenVerifier {
  constructor(private readonly verifiers: TokenVerifier[]) {}

  async verify(token: string): Promise<Identity> {
    let last: unknown;
    for (const v of this.verifiers) {
      try {
        return await v.verify(token);
      } catch (err) {
        last = err;
        if (err instanceof AuthError && err.status === 403) throw err;
      }
    }
    throw last instanceof AuthError ? last : new AuthError('Invalid token', 401);
  }
}
