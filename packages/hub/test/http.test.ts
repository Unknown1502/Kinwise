import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { signBody } from '../src/http/hmac.js';
import { UI_URIS } from '../src/mcp/server.js';

type App = Awaited<ReturnType<typeof bootstrap>>['app'];

async function makeApp(env: Record<string, string> = {}) {
  const config = loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '', ...env } as NodeJS.ProcessEnv);
  return bootstrap(config);
}

async function connect(app: App, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL('http://kinwise.test/mcp'), {
    fetch: async (url, init) => app.fetch(new Request(url, init)),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'kinwise-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const rpc = (app: App, body: unknown, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request('http://kinwise.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
};

async function readJsonRpc(res: Response): Promise<any> {
  const text = await res.text();
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    return JSON.parse(data);
  }
  return JSON.parse(text);
}

describe('MCP server over Streamable HTTP', () => {
  let app: App;
  beforeEach(async () => {
    ({ app } = await makeApp());
  });

  it('negotiates protocol 2025-11-25 on initialize', async () => {
    const res = await rpc(app, INIT, { authorization: 'Bearer dev-service' });
    expect(res.status).toBe(200);
    const msg = await readJsonRpc(res);
    expect(msg.result.protocolVersion).toBe('2025-11-25');
    expect(msg.result.serverInfo).toMatchObject({ name: 'kinwise', title: 'Kinwise' });
    expect(msg.result.instructions).toMatch(/consent-first/);
  });

  it('scopes the tool catalog by role', async () => {
    const names = async (token: string) => (await (await connect(app, token)).listTools()).tools.map((t) => t.name).sort();
    const asha = await names('dev-asha');
    const priya = await names('dev-priya');
    const service = await names('dev-service');
    expect(asha).toContain('kinwise_check_call');
    expect(asha).not.toContain('kinwise_send_family_message');
    expect(priya).toContain('kinwise_send_family_message');
    expect(priya).not.toContain('kinwise_check_call');
    expect(service).toEqual([...new Set([...asha, ...priya])].sort());
  });

  it('declares output schemas, annotations, icons and MCP Apps UI links', async () => {
    const { tools } = await (await connect(app, 'dev-asha')).listTools();
    const check = tools.find((t) => t.name === 'kinwise_check_call')!;
    expect(check.outputSchema).toBeDefined();
    expect(check.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect((check._meta as any)?.ui?.resourceUri).toBe(UI_URIS.screening);
    const today = tools.find((t) => t.name === 'kinwise_get_today')!;
    expect(today.annotations?.readOnlyHint).toBe(true);
    const privacy = tools.find((t) => t.name === 'kinwise_set_privacy_hour')!;
    expect(privacy.icons?.[0]?.mimeType).toBe('image/svg+xml');
  });

  it('returns structured content that matches the declared schema', async () => {
    const client = await connect(app, 'dev-asha');
    const r = await client.callTool({
      name: 'kinwise_check_call',
      arguments: { description: 'The bank fraud department says a courier will pick up my gold. Do not tell anyone.' },
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ mode: 'check', level: 'high', caregiverName: 'Priya' });
    expect((r.content as any[])[0].text).toMatch(/warning signs of a scam/);
  });

  it('turns domain errors into tool errors the model can explain', async () => {
    const client = await connect(app, 'dev-asha');
    const r = await client.callTool({
      name: 'kinwise_respond_to_alert',
      arguments: { alertId: 'nope', action: 'dismiss' },
    });
    expect(r.isError).toBe(true);
    expect((r.content as any[])[0].text).toBe('No such alert');
  });

  it('serves MCP Apps UI resources', async () => {
    const client = await connect(app, 'dev-asha');
    const res = await client.readResource({ uri: UI_URIS.pause });
    expect(res.contents[0]).toMatchObject({ uri: UI_URIS.pause, mimeType: 'text/html;profile=mcp-app' });
    expect(String((res.contents[0] as any).text)).toMatch(/<html/i);
  });

  it('runs a caregiver flow end to end: message → TV', async () => {
    const priya = await connect(app, 'dev-priya');
    const r = await priya.callTool({ name: 'kinwise_send_family_message', arguments: { text: 'Love you, Mom' } });
    expect(r.isError).toBeFalsy();
    const tv = await app.fetch(new Request('http://kinwise.test/tv/state', { headers: { authorization: 'Bearer dev-tv' } }));
    expect((await tv.json()).today.messages[0].text).toBe('Love you, Mom');
  });
});

describe('MCP auth (Alexa+ two-tier model)', () => {
  it('401 without a token and no WWW-Authenticate by default', async () => {
    const { app } = await makeApp();
    const res = await rpc(app, INIT);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'invalid_token' });
  });

  it('adds WWW-Authenticate with resource_metadata when enabled', async () => {
    const { app } = await makeApp({ MCP_WWW_AUTHENTICATE: 'on', PUBLIC_BASE_URL: 'https://hub.example' });
    const res = await rpc(app, INIT);
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://hub.example/.well-known/oauth-protected-resource"',
    );
  });

  it('serves RFC 9728 protected resource metadata', async () => {
    const { app } = await makeApp({ PUBLIC_BASE_URL: 'https://hub.example' });
    const res = await app.fetch(new Request('http://kinwise.test/.well-known/oauth-protected-resource'));
    expect(await res.json()).toMatchObject({
      resource: 'https://hub.example/mcp',
      scopes_supported: ['mcp:service', 'mcp:tools', 'mcp:resources'],
      bearer_methods_supported: ['header'],
    });
  });

  it('service tier may discover but not call tools or read resources', async () => {
    const { app } = await makeApp();
    const list = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { authorization: 'Bearer dev-service' });
    expect(list.status).toBe(200);
    const call = await rpc(
      app,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kinwise_get_today', arguments: {} } },
      { authorization: 'Bearer dev-service' },
    );
    expect(call.status).toBe(403);
    expect(await call.json()).toMatchObject({ error: 'insufficient_scope', scope: 'mcp:tools' });
    const read = await rpc(
      app,
      { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: UI_URIS.today } },
      { authorization: 'Bearer dev-service' },
    );
    expect(read.status).toBe(403);
  });

  it('rejects a disallowed Origin with 403', async () => {
    const { app } = await makeApp();
    const res = await rpc(app, INIT, { authorization: 'Bearer dev-asha', origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('allows a configured Origin', async () => {
    const { app } = await makeApp();
    const res = await rpc(app, INIT, { authorization: 'Bearer dev-asha', origin: 'http://localhost:5173' });
    expect(res.status).toBe(200);
  });

  it('answers read tools well inside the 500 ms Alexa+ budget', async () => {
    const { app } = await makeApp();
    const client = await connect(app, 'dev-asha');
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      await client.callTool({ name: 'kinwise_get_today', arguments: {} });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(p95).toBeLessThan(500);
  });
});

describe('signed event ingestion', () => {
  const event = (id: string) => ({
    householdId: 'hh-asha',
    eventId: id,
    deviceId: 'front-door',
    occurredAt: new Date().toISOString(),
    source: 'demo',
    ringEventType: 'button_press',
    perception: { personPresent: true, peopleCount: 1, description: 'A person at the front door' },
  });

  it('accepts a correctly signed event and dedupes replays', async () => {
    const { app } = await makeApp();
    const raw = JSON.stringify(event('e-1'));
    const post = () =>
      app.fetch(
        new Request('http://kinwise.test/events/visitor', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-kinwise-signature': signBody('dev-ingest-secret', raw) },
          body: raw,
        }),
      );
    const first = await post();
    expect(first.status).toBe(200);
    expect((await first.json()).duplicate).toBe(false);
    expect((await (await post()).json()).duplicate).toBe(true);
  });

  it('rejects a bad signature', async () => {
    const { app } = await makeApp();
    const raw = JSON.stringify(event('e-2'));
    const res = await app.fetch(
      new Request('http://kinwise.test/events/visitor', {
        method: 'POST',
        headers: { 'x-kinwise-signature': 'sha256=deadbeef' },
        body: raw,
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('Fire TV API', () => {
  it('requires a token and returns the TV state', async () => {
    const { app } = await makeApp();
    expect((await app.fetch(new Request('http://kinwise.test/tv/state'))).status).toBe(401);
    const res = await app.fetch(new Request('http://kinwise.test/tv/state', { headers: { authorization: 'Bearer dev-tv' } }));
    const body = await res.json();
    expect(body.resident.name).toBe('Asha');
    expect(body.caregiver).toMatchObject({ name: 'Priya', relationship: 'daughter' });
  });

  it('stops caregivers from changing the resident’s consent', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(
      new Request('http://kinwise.test/tv/consent', {
        method: 'POST',
        headers: { authorization: 'Bearer dev-priya', 'content-type': 'application/json' },
        body: JSON.stringify({ doorAwareness: false }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe('hosted-mode hardening', () => {
  const hosted = {
    AUTH_MODE: 'cognito',
    COGNITO_USER_POOL_ID: 'us-east-1_AbCdEfGhI',
    COGNITO_CLIENT_IDS: 'client-a',
    INGEST_SECRET: 'hosted-secret',
    DEV_ROUTES: 'true',
    AWS_LAMBDA_FUNCTION_NAME: 'kinwise-hub',
  };

  it('requires a household token for demo helpers outside dev mode', async () => {
    const { app } = await makeApp(hosted);
    const res = await app.fetch(new Request('https://abc.execute-api.us-east-1.amazonaws.com/dev/visitor', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('does not accept dev tokens outside dev mode', async () => {
    const { app } = await makeApp(hosted);
    const res = await app.fetch(
      new Request('https://abc.execute-api.us-east-1.amazonaws.com/tv/state', { headers: { authorization: 'Bearer dev-tv' } }),
    );
    expect(res.status).toBe(401);
  });

  it('derives the resource URL from the request on Lambda', async () => {
    const { app } = await makeApp(hosted);
    const res = await app.fetch(new Request('https://abc.execute-api.us-east-1.amazonaws.com/.well-known/oauth-protected-resource'));
    expect(await res.json()).toMatchObject({
      resource: 'https://abc.execute-api.us-east-1.amazonaws.com/mcp',
      authorization_servers: ['https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEfGhI'],
    });
  });
});

describe('demo tokens', () => {
  it('derives stable, persona-specific tokens from a seed', async () => {
    const { deriveDemoToken, demoTokenIdentities } = await import('../src/auth/secrets.js');
    const a = deriveDemoToken('seed-1', 'asha');
    expect(a).toMatch(/^kw_asha_[A-Za-z0-9_-]{32}$/);
    expect(deriveDemoToken('seed-1', 'asha')).toBe(a);
    expect(deriveDemoToken('seed-2', 'asha')).not.toBe(a);
    const ids = demoTokenIdentities('seed-1', 'hh-asha');
    expect(ids[a]).toMatchObject({ role: 'resident', householdId: 'hh-asha' });
    expect(ids[deriveDemoToken('seed-1', 'tv')]?.role).toBe('device');
  });
});
