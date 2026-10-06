/**
 * Alexa+ add-on scopes. Alexa+ uses a two-tier model:
 *  - a service token (client_credentials) with `mcp:service` for discovery (initialize, tools/list, …);
 *  - a user token (authorization code + PKCE, i.e. account linking) with `mcp:tools` / `mcp:resources`
 *    for acting on the user's behalf.
 */
export const ALEXA_PLUS_SCOPES = {
  service: 'mcp:service',
  tools: 'mcp:tools',
  resources: 'mcp:resources',
} as const;

export const ALL_ALEXA_PLUS_SCOPES: readonly string[] = [
  ALEXA_PLUS_SCOPES.service,
  ALEXA_PLUS_SCOPES.tools,
  ALEXA_PLUS_SCOPES.resources,
];

/** The scope an Alexa+ add-on should require for a JSON-RPC method. */
export function requiredScope(method: string): string {
  if (method === 'tools/call') return ALEXA_PLUS_SCOPES.tools;
  if (method === 'resources/read' || method === 'resources/subscribe' || method === 'resources/unsubscribe') {
    return ALEXA_PLUS_SCOPES.resources;
  }
  return ALEXA_PLUS_SCOPES.service;
}

/** Methods of a JSON-RPC message or batch (responses and malformed entries are skipped). */
export function jsonRpcMethods(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages
    .map((m) => (m && typeof m === 'object' && 'method' in m ? String((m as { method: unknown }).method) : ''))
    .filter(Boolean);
}

/**
 * Normalise an OAuth `scope` claim. Resource-server prefixes are stripped, so a Cognito
 * `"kinwise/mcp:tools https://api.example.com/mcp:resources"` becomes `["mcp:tools", "mcp:resources"]`.
 */
export function normalizeScopes(raw: string | readonly string[] | undefined | null): string[] {
  const list = typeof raw === 'string' ? raw.split(/\s+/) : [...(raw ?? [])];
  return list
    .filter(Boolean)
    .map((s) => {
      const i = s.lastIndexOf('/');
      return i >= 0 ? s.slice(i + 1) : s;
    });
}

/** First method whose required scope is missing, if any. */
export function missingScope(
  body: unknown,
  granted: readonly string[],
  scopeFor: (method: string) => string = requiredScope,
): { method: string; scope: string } | undefined {
  for (const method of jsonRpcMethods(body)) {
    const scope = scopeFor(method);
    if (!granted.includes(scope)) return { method, scope };
  }
  return undefined;
}
