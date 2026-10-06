/**
 * Alexa+ add-on conformance checks for any Streamable HTTP MCP server.
 * Dependency-free (plain JSON-RPC over fetch) so it can run anywhere Node 20+ runs.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
}

export interface ConformanceOptions {
  /** MCP endpoint URL, e.g. https://api.example.com/mcp */
  url: string;
  /** User-tier token (account linking: mcp:tools + mcp:resources). Required. */
  userToken: string;
  /** Service-tier token (client_credentials: mcp:service only). Enables the two-tier checks. */
  serviceToken?: string;
  /** Protocol version to request (default 2025-11-25, the Alexa+ minimum). */
  protocolVersion?: string;
  /** Origin used for the "bad Origin must get 403" check. */
  badOrigin?: string;
  /** Number of tools/list calls for the latency check (default 20). */
  latencySamples?: number;
  /** Latency budget for p95 in ms (default 500, the Alexa+ round-trip budget). */
  latencyBudgetMs?: number;
  fetch?: typeof fetch;
}

interface RpcResult {
  status: number;
  headers: Headers;
  body: any;
}

export async function parseRpcResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return undefined;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const events = text.split(/\r?\n\r?\n/);
    for (const ev of events) {
      const data = ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!data) continue;
      const msg = JSON.parse(data);
      if (msg && (msg.result !== undefined || msg.error !== undefined)) return msg;
    }
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class RpcClient {
  private id = 0;
  private sessionId?: string;

  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly version: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(method: string, params: unknown, extraHeaders: Record<string, string> = {}, notify = false): Promise<RpcResult> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': this.version,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...extraHeaders,
    };
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++this.id, method, params };
    const res = await this.fetchImpl(this.url, { method: 'POST', headers, body: JSON.stringify(body) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    return { status: res.status, headers: res.headers, body: notify ? undefined : await parseRpcResponse(res) };
  }

  async initialize(): Promise<RpcResult> {
    const r = await this.send('initialize', {
      protocolVersion: this.version,
      capabilities: {},
      clientInfo: { name: 'alexa-mcp-conformance', version: '0.1.0' },
    });
    if (r.status === 200) await this.send('notifications/initialized', {}, {}, true);
    return r;
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

export async function runConformance(opts: ConformanceOptions): Promise<CheckResult[]> {
  const f = opts.fetch ?? fetch;
  const version = opts.protocolVersion ?? '2025-11-25';
  const results: CheckResult[] = [];
  const add = (id: string, title: string, status: CheckStatus, detail?: string) => results.push({ id, title, status, detail });
  const endpoint = new URL(opts.url);

  // ── Transport & version ──
  const user = new RpcClient(opts.url, opts.userToken, version, f);
  const init = await user.initialize();
  const negotiated = init.body?.result?.protocolVersion;
  add(
    'initialize',
    `initialize negotiates ${version} over Streamable HTTP`,
    init.status === 200 && negotiated === version ? 'pass' : 'fail',
    `HTTP ${init.status}, protocolVersion=${negotiated ?? 'none'}`,
  );
  const caps = init.body?.result?.capabilities ?? {};
  add('capabilities', 'server advertises tools capability', caps.tools ? 'pass' : 'fail');

  // ── RFC 9728 ──
  const prmUrls = [`${endpoint.origin}/.well-known/oauth-protected-resource`, `${endpoint.origin}/.well-known/oauth-protected-resource${endpoint.pathname}`];
  let prm: any;
  for (const u of prmUrls) {
    const res = await f(u);
    if (res.ok) {
      prm = await res.json().catch(() => undefined);
      if (prm) break;
    }
  }
  add('prm', 'RFC 9728 protected resource metadata is served', prm ? 'pass' : 'fail', prm ? undefined : prmUrls.join(' | '));
  if (prm) {
    add('prm-resource', 'metadata `resource` matches the MCP endpoint', prm.resource === opts.url ? 'pass' : 'warn', String(prm.resource));
    add(
      'prm-as',
      'metadata lists an authorization server',
      Array.isArray(prm.authorization_servers) && prm.authorization_servers.length > 0 ? 'pass' : 'fail',
    );
    const scopes: string[] = prm.scopes_supported ?? [];
    add(
      'prm-scopes',
      'metadata advertises mcp:service, mcp:tools, mcp:resources',
      ['mcp:service', 'mcp:tools', 'mcp:resources'].every((s) => scopes.includes(s)) ? 'pass' : 'warn',
      scopes.join(' '),
    );
  }

  // ── Auth behaviour ──
  const anon = new RpcClient(opts.url, undefined, version, f);
  const noToken = await anon.initialize();
  add('401', 'requests without a token get 401', noToken.status === 401 ? 'pass' : 'fail', `HTTP ${noToken.status}`);
  add(
    '401-header',
    '401 omits WWW-Authenticate (Alexa+ discovers metadata via RFC 9728)',
    noToken.headers.get('www-authenticate') ? 'warn' : 'pass',
    noToken.headers.get('www-authenticate') ?? undefined,
  );
  const badOrigin = await new RpcClient(opts.url, opts.userToken, version, f).send(
    'initialize',
    { protocolVersion: version, capabilities: {}, clientInfo: { name: 'origin-check', version: '0' } },
    { origin: opts.badOrigin ?? 'https://attacker.invalid' },
  );
  add('origin', 'a disallowed Origin gets 403', badOrigin.status === 403 ? 'pass' : 'fail', `HTTP ${badOrigin.status}`);

  // ── Catalog (user tier) ──
  const listed = await user.send('tools/list', {});
  const tools: any[] = listed.body?.result?.tools ?? [];
  add('tools-list', 'tools/list works with the user token', listed.status === 200 && tools.length > 0 ? 'pass' : 'fail', `${tools.length} tools`);
  if (tools.length) {
    const noSchema = tools.filter((t) => !t.outputSchema).map((t) => t.name);
    add('output-schema', 'tools declare outputSchema (structured results)', noSchema.length ? 'warn' : 'pass', noSchema.join(', ') || undefined);
    const noAnn = tools.filter((t) => !t.annotations || typeof t.annotations.readOnlyHint !== 'boolean').map((t) => t.name);
    add('annotations', 'tools declare readOnlyHint/destructiveHint annotations', noAnn.length ? 'warn' : 'pass', noAnn.join(', ') || undefined);
    const uiUris = [
      ...new Set(
        tools.map((t) => t._meta?.ui?.resourceUri ?? t._meta?.['ui/resourceUri']).filter((u): u is string => typeof u === 'string'),
      ),
    ];
    if (uiUris.length === 0) {
      add('mcp-apps', 'MCP Apps UI resources', 'skip', 'no tool links a ui:// resource');
    } else {
      let bad = 0;
      for (const uri of uiUris) {
        const r = await user.send('resources/read', { uri });
        const c = r.body?.result?.contents?.[0];
        if (!(c?.mimeType === 'text/html;profile=mcp-app' && typeof c.text === 'string')) bad++;
      }
      add('mcp-apps', 'MCP Apps UI resources are served as text/html;profile=mcp-app', bad ? 'fail' : 'pass', `${uiUris.length} resources`);
    }
  }

  // ── Two-tier model (service token) ──
  if (opts.serviceToken) {
    const svc = new RpcClient(opts.url, opts.serviceToken, version, f);
    const sInit = await svc.initialize();
    const sList = await svc.send('tools/list', {});
    add('service-discovery', 'service token can initialize and list tools', sInit.status === 200 && sList.status === 200 ? 'pass' : 'fail');
    const firstTool = (sList.body?.result?.tools ?? tools)[0]?.name;
    if (firstTool) {
      const call = await svc.send('tools/call', { name: firstTool, arguments: {} });
      add(
        'service-cannot-call',
        'service token cannot call tools (needs mcp:tools)',
        call.status === 403 || call.status === 401 ? 'pass' : 'fail',
        `HTTP ${call.status}`,
      );
    }
  } else {
    add('service-discovery', 'two-tier checks', 'skip', 'pass --service-token to check the service tier');
  }

  // ── Latency ──
  const samples: number[] = [];
  for (let i = 0; i < (opts.latencySamples ?? 20); i++) {
    const t = performance.now();
    await user.send('tools/list', {});
    samples.push(performance.now() - t);
  }
  const p95 = percentile(samples, 0.95);
  const budget = opts.latencyBudgetMs ?? 500;
  add('latency', `tools/list p95 under ${budget} ms`, p95 < budget ? 'pass' : 'fail', `p50 ${percentile(samples, 0.5).toFixed(0)} ms · p95 ${p95.toFixed(0)} ms`);

  return results;
}

export function summarize(results: CheckResult[]): { passed: number; warned: number; failed: number; skipped: number } {
  const count = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  return { passed: count('pass'), warned: count('warn'), failed: count('fail'), skipped: count('skip') };
}
