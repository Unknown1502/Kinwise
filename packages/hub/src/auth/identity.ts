import type { Role } from '../domain/types.js';

/** Alexa+ two-tier scopes (spec §6.1). */
export const SCOPES = {
  service: 'mcp:service',
  tools: 'mcp:tools',
  resources: 'mcp:resources',
} as const;
export const ALL_MCP_SCOPES = [SCOPES.service, SCOPES.tools, SCOPES.resources];

export type ActorRole = Role | 'device' | 'service';

export interface Identity {
  /** Member id for people, device id for TVs, client id for services. */
  userId: string;
  householdId: string;
  role: ActorRole;
  name: string;
  scopes: string[];
}

/** The TV is the resident's own screen, operated with her remote: it acts as the resident. */
export function actsAsResident(identity: Identity): boolean {
  return identity.role === 'resident' || identity.role === 'device';
}

export function hasScope(identity: Identity, scope: string): boolean {
  return identity.scopes.includes(scope);
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: 'invalid_token' | 'insufficient_scope' | 'forbidden' = status === 401 ? 'invalid_token' : 'forbidden',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}
