import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ALL_ALEXA_PLUS_SCOPES,
  TokenError,
  guardMcpRequest,
  isProtectedResourceMetadataPath,
  jsonRpcMethods,
  missingScope,
  normalizeScopes,
  parseRpcResponse,
  protectedResourceMetadataResponse,
  requiredScope,
  runConformance,
  summarize,
  withAlexaPlusAuth,
  type VerifiedToken,
} from '../src/index.js';

const TOKENS: Record<string, VerifiedToken<{ name: string }>> = {
  user: { subject: 'asha', scopes: [...ALL_ALEXA_PLUS_SCOPES], extra: { name: 'Asha' } },
  service: { subject: 'alexa', scopes: ['mcp:service'] },
};
const verifyToken = async (t: string) => {
  if (t === 'blocked') throw new TokenError('Not linked to a household', 403);
  const v = TOKENS[t];
  if (!v) throw new TokenError('Unknown token');
  return v;
};

function demoServer(options: { wwwAuthenticate?: boolean; withUi?: boolean } = {}) {
  let lastExtra: unknown;
  const handler = createMcpHandler((ctx) => {
    lastExtra = ctx.authInfo?.extra;
    const server = new McpServer({ name: 'demo', version: '1.0.0' });
    server.registerTool(
      'echo',
      {
        description: 'Echo text',
        inputSchema: z.object({ text: z.string().default('hi') }),
        outputSchema: z.object({ text: z.string() }),
        annotations: { readOnlyHint: true, destructiveHint: false },
        ...(options.withUi ? { _meta: { ui: { resourceUri: 'ui://demo/card' } } } : {}),
      },
      async ({ text }) => ({ content: [{ type: 'text', text }], structuredContent: { text } }),
    );
    if (options.withUi) {
      server.registerResource('card', 'ui://demo/card', { mimeType: 'text/html;profile=mcp-app' }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: '<!doctype html><html></html>' }],
      }));
    }
    return server;
  });
  const mcp = withAlexaPlusAuth(handler.fetch, { verifyToken, wwwAuthenticate: options.wwwAuthenticate });
  const app = async (req: Request) => {
    const url = new URL(req.url);
    if (isProtectedResourceMetadataPath(url.pathname)) {
      return protectedResourceMetadataResponse({ resource: 'https://demo.test/mcp', authorizationServers: ['https://auth.test'] });
    }
    if (url.pathname === '/mcp') return mcp(req);
    return new Response('not found', { status: 404 });
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => app(new Request(input, init))) as typeof fetch;
  return { fetchImpl, extra: () => lastExtra };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://demo.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('scopes', () => {
  it('maps methods to the Alexa+ two-tier scopes', () => {
    expect(requiredScope('initialize')).toBe('mcp:service');
    expect(requiredScope('tools/list')).toBe('mcp:service');
    expect(requiredScope('tools/call')).toBe('mcp:tools');
    expect(requiredScope('resources/read')).toBe('mcp:resources');
  });
  it('reads methods from single messages and batches', () => {
    expect(jsonRpcMethods({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toEqual(['tools/list']);
    expect(jsonRpcMethods([{ method: 'a' }, { id: 1, result: {} }, { method: 'b' }])).toEqual(['a', 'b']);
    expect(jsonRpcMethods(null)).toEqual([]);
  });
  it('strips resource-server prefixes from scope claims', () => {
    expect(normalizeScopes('kinwise/mcp:tools https://api.example.com/mcp:resources openid')).toEqual([
      'mcp:tools',
      'mcp:resources',
      'openid',
    ]);
    expect(normalizeScopes(undefined)).toEqual([]);
  });
  it('reports the first missing scope', () => {
    expect(missingScope({ method: 'tools/call' }, ['mcp:service'])).toEqual({ method: 'tools/call', scope: 'mcp:tools' });
    expect(missingScope({ method: 'tools/list' }, ['mcp:service'])).toBeUndefined();
  });
});

describe('guardMcpRequest', () => {
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

  it('401 without a token, Alexa-style (no WWW-Authenticate)', async () => {
    const out = await guardMcpRequest(post(init), { verifyToken });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(401);
      expect(out.response.headers.get('www-authenticate')).toBeNull();
    }
  });
  it('adds WWW-Authenticate with resource_metadata when enabled', async () => {
    const out = await guardMcpRequest(post(init), { verifyToken, wwwAuthenticate: true });
    if (!out.ok) {
      expect(out.response.headers.get('www-authenticate')).toBe(
        'Bearer resource_metadata="https://demo.test/.well-known/oauth-protected-resource", error="invalid_token"',
      );
    }
  });
  it('403 for a token the verifier rejects with 403', async () => {
    const out = await guardMcpRequest(post(init, { authorization: 'Bearer blocked' }), { verifyToken });
    expect(!out.ok && out.response.status).toBe(403);
  });
  it('403 for a disallowed Origin; allows configured and localhost origins', async () => {
    const bad = await guardMcpRequest(post(init, { authorization: 'Bearer user', origin: 'https://evil.example' }), { verifyToken });
    expect(!bad.ok && bad.response.status).toBe(403);
    const local = await guardMcpRequest(post(init, { authorization: 'Bearer user', origin: 'http://localhost:5173' }), { verifyToken });
    expect(local.ok).toBe(true);
    const listed = await guardMcpRequest(post(init, { authorization: 'Bearer user', origin: 'https://app.example' }), {
      verifyToken,
      allowedOrigins: ['https://app.example'],
    });
    expect(listed.ok).toBe(true);
  });
  it('400 on invalid JSON and 413 on oversized bodies', async () => {
    const bad = await guardMcpRequest(post('{nope', { authorization: 'Bearer user' }), { verifyToken });
    expect(!bad.ok && bad.response.status).toBe(400);
    const big = await guardMcpRequest(post({ pad: 'x'.repeat(200) }, { authorization: 'Bearer user' }), { verifyToken, maxBodyBytes: 100 });
    expect(!big.ok && big.response.status).toBe(413);
  });
  it('403 insufficient_scope when the service tier calls a tool', async () => {
    const out = await guardMcpRequest(
      post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo' } }, { authorization: 'Bearer service' }),
      { verifyToken },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(403);
      expect(await out.response.json()).toMatchObject({ error: 'insufficient_scope', scope: 'mcp:tools' });
    }
  });
  it('returns MCP SDK-ready authInfo and the parsed body', async () => {
    const out = await guardMcpRequest(post(init, { authorization: 'Bearer user' }), { verifyToken });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.authInfo).toMatchObject({ token: 'user', clientId: 'asha', extra: { name: 'Asha' } });
      expect(out.parsedBody).toEqual(init);
    }
  });
});

describe('withAlexaPlusAuth + MCP SDK v2', () => {
  it('serves a real MCP server and passes authInfo.extra to the factory', async () => {
    const { fetchImpl, extra } = demoServer();
    const res = await fetchImpl('https://demo.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer user', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('server-timing')).toMatch(/^mcp;dur=/);
    expect((await parseRpcResponse(res)).result.protocolVersion).toBe('2025-11-25');
    expect(extra()).toEqual({ name: 'Asha' });
  });
});

describe('runConformance', () => {
  it('passes a compliant server with both tiers', async () => {
    const { fetchImpl } = demoServer({ withUi: true });
    const results = await runConformance({ url: 'https://demo.test/mcp', userToken: 'user', serviceToken: 'service', fetch: fetchImpl, latencySamples: 5 });
    const s = summarize(results);
    expect(results.filter((r) => r.status === 'fail')).toEqual([]);
    expect(s.warned).toBe(0);
    expect(results.find((r) => r.id === 'mcp-apps')?.status).toBe('pass');
    expect(results.find((r) => r.id === 'service-cannot-call')?.status).toBe('pass');
  });
  it('flags a server that sends WWW-Authenticate and lacks the service tier', async () => {
    const { fetchImpl } = demoServer({ wwwAuthenticate: true });
    const results = await runConformance({ url: 'https://demo.test/mcp', userToken: 'user', fetch: fetchImpl, latencySamples: 2 });
    expect(results.find((r) => r.id === '401-header')?.status).toBe('warn');
    expect(results.find((r) => r.id === 'service-discovery')?.status).toBe('skip');
    expect(results.find((r) => r.id === 'mcp-apps')?.status).toBe('skip');
  });
  it('fails a server without authentication', async () => {
    const open = (async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} } } }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const results = await runConformance({ url: 'https://open.test/mcp', userToken: 'x', fetch: open, latencySamples: 1 });
    expect(results.find((r) => r.id === '401')?.status).toBe('fail');
    expect(results.find((r) => r.id === 'origin')?.status).toBe('fail');
  });
});
