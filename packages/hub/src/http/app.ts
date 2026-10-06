import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { AuthError, PermissionError, SCOPES, hasScope, type Identity } from '../auth/identity.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { HubConfig } from '../config.js';
import type { AlertAction, Recurrence, VisitorEvent } from '../domain/types.js';
import { buildMcpServer, SERVER_VERSION } from '../mcp/server.js';
import { KinwiseService, NotFoundError, ValidationError } from '../services/kinwise.js';
import type { OutboxNotifier } from '../services/notifier.js';
import type { ConciergeClient } from './concierge.js';
import { verifySignature } from './hmac.js';

export interface AppDeps {
  config: HubConfig;
  service: KinwiseService;
  verifier: TokenVerifier;
  concierge?: ConciergeClient;
  /** Dev only: "Priya's phone" outbox for the demo. */
  outbox?: OutboxNotifier;
  /** Dev only: reseed the demo household. */
  resetDemo?: () => Promise<void>;
}

type Env = { Variables: { identity: Identity } };

const ALERT_ACTIONS: AlertAction[] = ['call_family', 'known_person', 'dismiss'];

/** JSON-RPC method → Alexa+ two-tier scope (spec §6.1). */
export function requiredScope(method: string): string {
  if (method === 'tools/call') return SCOPES.tools;
  if (method === 'resources/read' || method === 'resources/subscribe' || method === 'resources/unsubscribe') return SCOPES.resources;
  return SCOPES.service;
}

function methodsOf(body: unknown): string[] {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs
    .map((m) => (m && typeof m === 'object' && 'method' in m ? String((m as { method: unknown }).method) : ''))
    .filter(Boolean);
}

function bearer(c: Context): string | undefined {
  const h = c.req.header('authorization');
  const m = h ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  return m?.[1];
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { config, service, verifier } = deps;
  const app = new Hono<Env>();
  const allowed = new Set(config.allowedOrigins);

  const mcp = createMcpHandler(
    (ctx) => {
      const identity = (ctx.authInfo?.extra as { identity?: Identity } | undefined)?.identity;
      if (!identity) throw new Error('MCP request reached the factory without an identity');
      return buildMcpServer(identity, service);
    },
    { legacy: 'stateless', onerror: (err) => console.error('[mcp]', err.message) },
  );

  app.use(
    '*',
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : null),
      allowHeaders: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'],
      exposeHeaders: ['mcp-session-id', 'mcp-protocol-version', 'server-timing'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json({ error: err.code, error_description: err.message }, err.status);
    if (err instanceof PermissionError) return c.json({ error: 'forbidden', error_description: err.message }, 403);
    if (err instanceof ValidationError) return c.json({ error: 'invalid_request', error_description: err.message }, 400);
    if (err instanceof NotFoundError) return c.json({ error: 'not_found', error_description: err.message }, 404);
    console.error('[hub] unhandled', err);
    return c.json({ error: 'server_error', error_description: 'Something went wrong' }, 500);
  });

  /** Public origin: configured, or derived from the request (API Gateway / Lambda Function URL). */
  const baseUrl = (c: Context) => config.publicBaseUrl ?? new URL(c.req.url).origin;

  const unauthorized = (c: Context, description: string) => {
    // Alexa+ does not use WWW-Authenticate on 401 and discovers metadata at /.well-known instead (spec §6.1).
    if (config.wwwAuthenticate) {
      c.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${baseUrl(c)}/.well-known/oauth-protected-resource", error="invalid_token"`,
      );
    }
    return c.json({ error: 'invalid_token', error_description: description }, 401);
  };

  const authenticate = async (c: Context<Env>): Promise<Identity | Response> => {
    const token = bearer(c);
    if (!token) return unauthorized(c, 'Missing bearer token');
    try {
      return await verifier.verify(token);
    } catch (err) {
      if (err instanceof AuthError && err.status === 403) return c.json({ error: 'forbidden', error_description: err.message }, 403);
      return unauthorized(c, err instanceof Error ? err.message : 'Invalid token');
    }
  };

  // ── health & discovery ──
  app.get('/health', (c) => c.json({ ok: true, service: 'kinwise-hub', version: SERVER_VERSION }));

  const prm = (c: Context) =>
    c.json({
      resource: `${baseUrl(c)}/mcp`,
      authorization_servers: config.cognito ? [config.cognito.issuer] : [`${baseUrl(c)}/dev-auth`],
      scopes_supported: [SCOPES.service, SCOPES.tools, SCOPES.resources],
      bearer_methods_supported: ['header'],
      resource_name: 'Kinwise',
      resource_documentation: 'https://github.com/kinwise-app/kinwise#alexa-mcp-add-on',
    });
  app.get('/.well-known/oauth-protected-resource', prm);
  app.get('/.well-known/oauth-protected-resource/mcp', prm);

  // ── MCP (Streamable HTTP, stateless) ──
  app.all('/mcp', async (c) => {
    const started = performance.now();
    const origin = c.req.header('origin');
    if (origin && !allowed.has(origin)) {
      return c.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Origin not allowed' }, id: null }, 403);
    }
    const auth = await authenticate(c);
    if (auth instanceof Response) return auth;

    let parsedBody: unknown;
    if (c.req.method === 'POST') {
      try {
        parsedBody = await c.req.json();
      } catch {
        return c.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, 400);
      }
      for (const method of methodsOf(parsedBody)) {
        const scope = requiredScope(method);
        if (!hasScope(auth, scope)) {
          return c.json({ error: 'insufficient_scope', error_description: `${method} requires ${scope}`, scope }, 403);
        }
      }
    }

    const authInfo: AuthInfo = { token: bearer(c)!, clientId: auth.userId, scopes: auth.scopes, extra: { identity: auth } };
    const res = await mcp.fetch(c.req.raw, { authInfo, parsedBody });
    const headers = new Headers(res.headers);
    headers.set('server-timing', `mcp;dur=${(performance.now() - started).toFixed(1)}`);
    return new Response(res.body, { status: res.status, headers });
  });

  // ── Fire TV API ──
  const tv = new Hono<Env>();
  tv.use('*', async (c, next) => {
    const auth = await authenticate(c);
    if (auth instanceof Response) return auth;
    c.set('identity', auth);
    await next();
  });
  tv.get('/state', async (c) => c.json(await service.tvState(c.get('identity'))));
  tv.post('/alerts/:id/respond', async (c) => {
    const { action } = await c.req.json<{ action: AlertAction }>();
    if (!ALERT_ACTIONS.includes(action)) throw new ValidationError('Unknown action');
    return c.json(await service.respondToAlert(c.get('identity'), c.req.param('id'), action));
  });
  tv.post('/alerts/:id/seen', async (c) => {
    await service.acknowledgeAlert(c.get('identity'), c.req.param('id'));
    return c.json({ ok: true });
  });
  // "I know this person" → remember them: the resident adds an expected visit from the TV.
  tv.post('/visits', async (c) => {
    const body = await c.req.json<{ label?: string; recurrence?: Recurrence }>();
    if (!body?.label || !body.recurrence) throw new ValidationError('label and recurrence are required');
    return c.json(await service.addExpectedVisit(c.get('identity'), { label: body.label, recurrence: body.recurrence }));
  });
  tv.post('/proposals/:id', async (c) => {
    const { decision } = await c.req.json<{ decision: 'approve' | 'decline' }>();
    if (decision !== 'approve' && decision !== 'decline') throw new ValidationError('decision must be approve or decline');
    return c.json(await service.decideProposal(c.get('identity'), c.req.param('id'), decision));
  });
  tv.post('/consent', async (c) => c.json(await service.updateConsent(c.get('identity'), await c.req.json())));
  tv.post('/privacy-hour', async (c) => {
    const { minutes } = await c.req.json<{ minutes: number }>();
    return c.json(await service.setPrivacyHour(c.get('identity'), Number(minutes)));
  });
  tv.post('/messages/:id/read', async (c) => {
    await service.markMessageRead(c.get('identity'), c.req.param('id'));
    return c.json({ ok: true });
  });
  tv.post('/safety/close', async (c) => c.json(await service.closeRiskWindow(c.get('identity'))));
  app.route('/tv', tv);

  // ── Event ingestion (HMAC-signed, from the Ring worker) ──
  app.post('/events/visitor', async (c) => {
    const raw = await c.req.text();
    if (raw.length > 16_384) return c.json({ error: 'payload_too_large' }, 413);
    if (!verifySignature(config.ingestSecret, raw, c.req.header('x-kinwise-signature'))) {
      return c.json({ error: 'invalid_signature' }, 401);
    }
    let body: { householdId?: string } & Partial<VisitorEvent>;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ValidationError('Body must be JSON');
    }
    const { householdId, ...event } = body;
    if (!householdId) throw new ValidationError('householdId is required');
    if (!event.perception || typeof event.perception.personPresent !== 'boolean') {
      throw new ValidationError('perception.personPresent is required');
    }
    const result = await service.ingestVisitor(householdId, event as VisitorEvent);
    return c.json(result);
  });

  // ── Echo Show simulator bridge ──
  app.post('/sim/ask', async (c) => {
    const auth = await authenticate(c);
    if (auth instanceof Response) return auth;
    if (!deps.concierge) return c.json({ error: 'concierge_not_configured' }, 503);
    if (auth.role !== 'resident' && auth.role !== 'caregiver') throw new PermissionError('Sign in as a household member');
    const { text, sessionId } = await c.req.json<{ text: string; sessionId?: string }>();
    if (!text?.trim()) throw new ValidationError('Say something');
    const out = await deps.concierge.ask({
      persona: auth.role,
      text: text.trim().slice(0, 2000),
      token: bearer(c)!,
      sessionId: sessionId ?? `${auth.userId}-${Date.now()}`,
      householdTimezone: await service.timezoneOf(auth.householdId),
      hubMcpUrl: `${baseUrl(c)}/mcp`,
    });
    return c.json(out);
  });

  // ── Dev-only helpers for the local demo ──
  if (config.devRoutes) {
    // Outside dev auth mode (the hosted demo) the helpers still require a household token.
    if (config.authMode !== 'dev') {
      app.use('/dev/*', async (c, next) => {
        const auth = await authenticate(c);
        if (auth instanceof Response) return auth;
        if (auth.role === 'service') throw new PermissionError('Demo helpers need a household token');
        await next();
      });
    }
    app.get('/dev/notices', (c) => c.json({ notices: deps.outbox?.outbox ?? [] }));
    app.post('/dev/reset', async (c) => {
      await deps.resetDemo?.();
      deps.outbox?.outbox.splice(0);
      return c.json({ ok: true });
    });
    // Ring a simulated doorbell from the Echo/TV dev tools without the ingest secret.
    app.post('/dev/visitor', async (c) => {
      const body = await c.req.json<{ personPresent?: boolean; description?: string; carrying?: string }>().catch(() => ({}));
      const personPresent = (body as { personPresent?: boolean }).personPresent ?? true;
      const result = await service.ingestVisitor(config.demoHouseholdId, {
        eventId: `demo-${Date.now()}`,
        deviceId: 'demo-front-door',
        occurredAt: new Date().toISOString(),
        source: 'demo',
        ringEventType: 'button_press',
        perception: {
          personPresent,
          peopleCount: personPresent ? 1 : 0,
          carrying: (body as { carrying?: string }).carrying,
          description:
            (body as { description?: string }).description ??
            (personPresent ? 'A person at the front door holding a small box' : 'Motion at the front door, no one visible'),
        },
      });
      return c.json(result);
    });
  }

  return app;
}
