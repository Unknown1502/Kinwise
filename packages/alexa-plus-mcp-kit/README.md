# alexa-plus-mcp-kit

**Make a self-hosted MCP server speak Alexa+'s add-on auth contract, and prove it with one command.**

Alexa+ add-ons are MCP servers (spec **2025-11-25+**, **Streamable HTTP**). Alexa+ has auth rules that generic MCP tutorials don't cover:

| Alexa+ expects | Generic MCP servers often… |
|---|---|
| **Two-tier OAuth**. A *service* token (client credentials, `mcp:service`) may only discover (`initialize`, `tools/list`). A *user* token (account linking, auth code + PKCE) carries `mcp:tools` / `mcp:resources` | check "is there a token?" and nothing else |
| Discovery through **RFC 9728** metadata at `/.well-known/oauth-protected-resource` | don't serve it |
| A **401 without `WWW-Authenticate`** (Alexa+ doesn't use the header) | always send it |
| **403 for a bad `Origin`** (required by MCP 2025-11-25) | skip Origin validation |
| Round trips **under 500 ms** | never measure |

This package handles all of that in a few lines, for any server built on the official MCP TypeScript SDK v2. It also ships a **conformance checker** for any MCP endpoint.

- Framework-agnostic: web-standard `Request`/`Response`. Works with Node, Hono, AWS Lambda, Cloudflare Workers, Deno and Bun.
- Zero runtime dependencies.
- Apache-2.0.

## Install

```bash
npm install alexa-plus-mcp-kit
```

## Protect an MCP server

```ts
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import {
  TokenError,
  normalizeScopes,
  isProtectedResourceMetadataPath,
  protectedResourceMetadataResponse,
  withAlexaPlusAuth,
} from 'alexa-plus-mcp-kit';

const mcp = createMcpHandler((ctx) => {
  const user = ctx.authInfo?.extra;            // whatever your verifier returned as `extra`
  const server = new McpServer({ name: 'my-addon', version: '1.0.0' });
  // …register tools for `user`…
  return server;
});

const handleMcp = withAlexaPlusAuth(mcp.fetch, {
  allowedOrigins: ['https://my-web-client.example'],          // server-to-server calls (no Origin) are always allowed
  verifyToken: async (token) => {
    const claims = await verifyJwtSomehow(token);             // e.g. aws-jwt-verify for Cognito
    if (!claims) throw new TokenError('Invalid token');       // → 401 (no WWW-Authenticate by default)
    return { subject: claims.sub, scopes: normalizeScopes(claims.scope), extra: { userId: claims.sub } };
  },
});

export default {
  async fetch(request: Request) {
    const { pathname } = new URL(request.url);
    if (isProtectedResourceMetadataPath(pathname)) {
      return protectedResourceMetadataResponse({
        resource: 'https://api.example.com/mcp',
        authorizationServers: ['https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXX'],
      });
    }
    if (pathname === '/mcp') return handleMcp(request);
    return new Response('Not found', { status: 404 });
  },
};
```

What `withAlexaPlusAuth` does, in order:
1. **Origin**: a disallowed `Origin` gets 403.
2. **Bearer token**: missing or invalid gets 401 `invalid_token`. Pass `wwwAuthenticate: true` to add `WWW-Authenticate: Bearer resource_metadata="…"` for non-Alexa clients.
3. **Body**: invalid JSON gets 400, and an oversized body gets 413.
4. **Two-tier scopes per JSON-RPC method**: `tools/call` needs `mcp:tools`, `resources/read` needs `mcp:resources`, everything else needs `mcp:service`. A missing scope gets 403 `insufficient_scope` with the required `scope`.
5. Hands the SDK a ready `authInfo` and `parsedBody`, and adds `server-timing: mcp;dur=…` so you can watch the 500 ms budget.

Lower-level pieces are exported too: `guardMcpRequest`, `requiredScope`, `missingScope`, `jsonRpcMethods`, `normalizeScopes` (strips Cognito resource-server prefixes such as `my-api/mcp:tools`), and `protectedResourceMetadata`.

## Check any MCP server against the Alexa+ contract

```bash
npx alexa-mcp-conformance --url https://api.example.com/mcp --token <user token> --service-token <client_credentials token>
```

```
  ✔ initialize negotiates 2025-11-25 over Streamable HTTP
  ✔ RFC 9728 protected resource metadata is served
  ✔ requests without a token get 401
  ✔ 401 omits WWW-Authenticate (Alexa+ discovers metadata via RFC 9728)
  ✔ a disallowed Origin gets 403
  ✔ tools declare outputSchema (structured results)
  ✔ tools declare readOnlyHint/destructiveHint annotations
  ✔ MCP Apps UI resources are served as text/html;profile=mcp-app
  ✔ service token can initialize and list tools
  ✔ service token cannot call tools (needs mcp:tools)
  ✔ tools/list p95 under 500 ms  — p50 5 ms · p95 7 ms
16 passed · 0 warnings · 0 failed · 0 skipped
```

It exits non-zero on failures, so it can gate CI. Programmatic use: `runConformance({ url, userToken, serviceToken, fetch })`.

## Used in production code by

[Kinwise](../../README.md): a consent-first family safety add-on, and the reason this kit exists. Its hub serves Alexa+ MCP through `withAlexaPlusAuth`.

## Sources

- MCP spec 2025-11-25: Streamable HTTP transport and authorization (RFC 9728, Origin validation).
- Alexa+ add-on MCP Toolkit authentication docs: two-tier scopes, no DCR, no `WWW-Authenticate` on 401.

## Development

```bash
npm test          # 15 tests: scope mapping, guard matrix, a real MCP SDK v2 server end to end, conformance runner
npm run build
```

## License

Apache-2.0
