import { ALL_ALEXA_PLUS_SCOPES } from './scopes.js';

export interface ProtectedResourceOptions {
  /** Absolute URL of the MCP endpoint, e.g. https://api.example.com/mcp */
  resource: string;
  /** OAuth authorization server issuer URLs (e.g. a Cognito user pool issuer). */
  authorizationServers: string[];
  scopes?: readonly string[];
  resourceName?: string;
  documentation?: string;
}

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata. Alexa+ discovers it at
 * `/.well-known/oauth-protected-resource` instead of reading a `WWW-Authenticate` header.
 */
export function protectedResourceMetadata(opts: ProtectedResourceOptions): Record<string, unknown> {
  return {
    resource: opts.resource,
    authorization_servers: opts.authorizationServers,
    scopes_supported: [...(opts.scopes ?? ALL_ALEXA_PLUS_SCOPES)],
    bearer_methods_supported: ['header'],
    ...(opts.resourceName ? { resource_name: opts.resourceName } : {}),
    ...(opts.documentation ? { resource_documentation: opts.documentation } : {}),
  };
}

export function protectedResourceMetadataResponse(opts: ProtectedResourceOptions): Response {
  return new Response(JSON.stringify(protectedResourceMetadata(opts)), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  });
}

/** Both well-known paths: the root form and the path-suffixed form for an endpoint at `/mcp`. */
export function isProtectedResourceMetadataPath(pathname: string): boolean {
  return pathname === '/.well-known/oauth-protected-resource' || pathname.startsWith('/.well-known/oauth-protected-resource/');
}
