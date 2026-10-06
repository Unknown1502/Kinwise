# Changelog

## 0.1.0 (2026-10-06)

- `withAlexaPlusAuth` / `guardMcpRequest`: Origin validation, bearer verification with Alexa-compatible 401s (optional `WWW-Authenticate` with `resource_metadata`), body limits, and two-tier scope enforcement per JSON-RPC method, producing an MCP SDK v2-ready `authInfo` and `parsedBody`.
- `protectedResourceMetadata` / `protectedResourceMetadataResponse` (RFC 9728) with Alexa+ scopes.
- Scope helpers: `requiredScope`, `missingScope`, `jsonRpcMethods`, `normalizeScopes`.
- `alexa-mcp-conformance` CLI and `runConformance`: protocol version, RFC 9728, 401 behaviour, Origin 403, catalog quality (output schemas, annotations), MCP Apps resources, service-tier restrictions, latency p95.
