import { missingScope, requiredScope } from './scopes.js';

/** What your token verifier returns for a valid bearer token. */
export interface VerifiedToken<Extra = unknown> {
  /** Stable subject (user id, or client id for service tokens). */
  subject: string;
  /** Normalised scopes (see `normalizeScopes`). */
  scopes: string[];
  /** Anything you want available to your MCP server factory (e.g. the household member). */
  extra?: Extra;
  /** Expiry in seconds since epoch, if known. */
  expiresAt?: number;
}

/** Throw from a verifier: 401 = invalid/expired token, 403 = valid token that may not use this server. */
export class TokenError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 401,
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

export type TokenVerifier<Extra = unknown> = (token: string, request: Request) => Promise<VerifiedToken<Extra>>;

export interface GuardOptions<Extra = unknown> {
  verifyToken: TokenVerifier<Extra>;
  /**
   * Allowed browser Origins. Requests without an Origin header (server-to-server, like Alexa+) are always allowed.
   * The MCP spec requires rejecting an invalid Origin with 403. Default: localhost origins only.
   */
  allowedOrigins?: readonly string[] | ((origin: string) => boolean);
  /**
   * Add `WWW-Authenticate: Bearer resource_metadata=…` to 401s. Alexa+ does not use it and documents
   * discovery via RFC 9728 instead, so the default is false. The MCP 2025-11-25 spec makes it optional.
   */
  wwwAuthenticate?: boolean;
  /** Public metadata URL for the WWW-Authenticate header (default: derived from the request URL). */
  resourceMetadataUrl?: (request: Request) => string;
  /** Override the method → scope mapping. */
  scopeFor?: (method: string) => string;
  /** Maximum POST body size in bytes (default 4 MiB). */
  maxBodyBytes?: number;
}

/** Shape compatible with the MCP SDK v2 `AuthInfo` passed to `createMcpHandler().fetch(req, { authInfo })`. */
export interface GuardAuthInfo<Extra = unknown> {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  extra?: Extra;
}

export type GuardOutcome<Extra = unknown> =
  | { ok: true; authInfo: GuardAuthInfo<Extra>; parsedBody: unknown; verified: VerifiedToken<Extra> }
  | { ok: false; response: Response };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function originAllowed(origin: string, allowed: GuardOptions['allowedOrigins']): boolean {
  if (!allowed) return LOCALHOST.test(origin);
  return typeof allowed === 'function' ? allowed(origin) : allowed.includes(origin);
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1];
}

export function resourceMetadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource`;
}

/**
 * Validate an MCP request the way an Alexa+ add-on must:
 *  1. Origin check (403), 2. bearer token (401, Alexa-style: no WWW-Authenticate by default),
 *  3. JSON body parse (400), 4. two-tier scope check per JSON-RPC method (403 insufficient_scope).
 * On success, returns `authInfo` + `parsedBody` ready for the MCP SDK v2 handler.
 */
export async function guardMcpRequest<Extra = unknown>(
  request: Request,
  options: GuardOptions<Extra>,
): Promise<GuardOutcome<Extra>> {
  const origin = request.headers.get('origin');
  if (origin && !originAllowed(origin, options.allowedOrigins)) {
    return { ok: false, response: json(403, { jsonrpc: '2.0', error: { code: -32600, message: 'Origin not allowed' }, id: null }) };
  }

  const unauthorized = (description: string) =>
    json(
      401,
      { error: 'invalid_token', error_description: description },
      options.wwwAuthenticate
        ? {
            'www-authenticate': `Bearer resource_metadata="${(options.resourceMetadataUrl ?? resourceMetadataUrl)(request)}", error="invalid_token"`,
          }
        : {},
    );

  const token = bearerToken(request);
  if (!token) return { ok: false, response: unauthorized('Missing bearer token') };

  let verified: VerifiedToken<Extra>;
  try {
    verified = await options.verifyToken(token, request);
  } catch (err) {
    if (err instanceof TokenError && err.status === 403) {
      return { ok: false, response: json(403, { error: 'forbidden', error_description: err.message }) };
    }
    return { ok: false, response: unauthorized(err instanceof Error ? err.message : 'Invalid token') };
  }

  let parsedBody: unknown;
  if (request.method === 'POST') {
    const raw = await request.text();
    if (raw.length > (options.maxBodyBytes ?? 4 * 1024 * 1024)) {
      return { ok: false, response: json(413, { jsonrpc: '2.0', error: { code: -32600, message: 'Request too large' }, id: null }) };
    }
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return { ok: false, response: json(400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }) };
    }
    const missing = missingScope(parsedBody, verified.scopes, options.scopeFor ?? requiredScope);
    if (missing) {
      return {
        ok: false,
        response: json(403, {
          error: 'insufficient_scope',
          error_description: `${missing.method} requires ${missing.scope}`,
          scope: missing.scope,
        }),
      };
    }
  }

  return {
    ok: true,
    verified,
    parsedBody,
    authInfo: {
      token,
      clientId: verified.subject,
      scopes: verified.scopes,
      ...(verified.expiresAt ? { expiresAt: verified.expiresAt } : {}),
      ...(verified.extra !== undefined ? { extra: verified.extra } : {}),
    },
  };
}

export type McpFetch<Extra = unknown> = (
  request: Request,
  options: { authInfo: GuardAuthInfo<Extra>; parsedBody: unknown },
) => Promise<Response>;

/**
 * Wrap an MCP SDK v2 handler: `withAlexaPlusAuth(createMcpHandler(factory).fetch, { verifyToken })`.
 * Adds a `server-timing` header so you can watch Alexa+'s latency budget.
 */
export function withAlexaPlusAuth<Extra = unknown>(handler: McpFetch<Extra>, options: GuardOptions<Extra>) {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    const outcome = await guardMcpRequest(request, options);
    if (!outcome.ok) return outcome.response;
    // The body was consumed by the guard; the SDK accepts it pre-parsed.
    const res = await handler(request, { authInfo: outcome.authInfo, parsedBody: outcome.parsedBody });
    const headers = new Headers(res.headers);
    headers.set('server-timing', `mcp;dur=${(performance.now() - started).toFixed(1)}`);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
