/**
 * Kinwise MCP conformance check — run against a local or hosted hub.
 *
 *   npm run conformance -w @kinwise/hub                         # local dev hub, dev tokens
 *   HUB_URL=https://….execute-api.us-east-1.amazonaws.com \
 *   RESIDENT_TOKEN=kw_asha_… CAREGIVER_TOKEN=kw_priya_… SERVICE_TOKEN=<client_credentials token> \
 *   npm run conformance -w @kinwise/hub                         # hosted hub
 *
 * Verifies the claims in the README: protocol 2025-11-25 over Streamable HTTP, Alexa+ two-tier auth,
 * RFC 9728 metadata, Origin validation, role-scoped catalog, output schemas + annotations, MCP Apps UI
 * resources, structured results, and read-tool latency under Alexa+'s 500 ms budget.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const HUB = (process.env.HUB_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const RESIDENT = process.env.RESIDENT_TOKEN ?? 'dev-asha';
const CAREGIVER = process.env.CAREGIVER_TOKEN ?? 'dev-priya';
const SERVICE = process.env.SERVICE_TOKEN ?? 'dev-service';

let failures = 0;
const results: Array<[boolean, string, string?]> = [];
function check(ok: boolean, name: string, detail?: string) {
  results.push([ok, name, detail]);
  if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? `  — ${detail}` : ''}`);
}

async function raw(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${HUB}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...headers },
    body: JSON.stringify(body),
  });
}

async function json(res: Response): Promise<any> {
  const text = await res.text();
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    return JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join(''));
  }
  return JSON.parse(text);
}

async function connect(token: string) {
  const client = new Client({ name: 'kinwise-conformance', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${HUB}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
  );
  return client;
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'conformance', version: '1' } } };

async function main() {
  console.log(`\nKinwise MCP conformance — ${HUB}/mcp\n`);

  console.log('Transport & discovery');
  const init = await raw(INIT, { authorization: `Bearer ${SERVICE}` });
  const initBody = await json(init);
  check(init.status === 200 && initBody.result?.protocolVersion === '2025-11-25', 'initialize negotiates 2025-11-25', initBody.result?.protocolVersion);
  check(!!initBody.result?.capabilities?.tools && !!initBody.result?.capabilities?.resources, 'advertises tools + resources capabilities');
  const prm = await (await fetch(`${HUB}/.well-known/oauth-protected-resource`)).json();
  check(prm.resource === `${HUB}/mcp` && Array.isArray(prm.authorization_servers), 'RFC 9728 protected resource metadata', prm.resource);
  check(JSON.stringify(prm.scopes_supported) === JSON.stringify(['mcp:service', 'mcp:tools', 'mcp:resources']), 'advertises Alexa+ two-tier scopes');

  console.log('\nAuth (Alexa+ two-tier model)');
  const noTok = await raw(INIT);
  check(noTok.status === 401, '401 without a token');
  check(noTok.headers.get('www-authenticate') === null, 'no WWW-Authenticate on 401 (Alexa+ compatible default)');
  const badOrigin = await raw(INIT, { authorization: `Bearer ${RESIDENT}`, origin: 'https://evil.example' });
  check(badOrigin.status === 403, '403 for a disallowed Origin');
  const svcCall = await raw(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kinwise_get_today', arguments: {} } },
    { authorization: `Bearer ${SERVICE}` },
  );
  check(svcCall.status === 403 && (await svcCall.json()).scope === 'mcp:tools', 'service tier cannot call tools (needs mcp:tools)');

  console.log('\nCatalog');
  const resident = await connect(RESIDENT);
  const caregiver = await connect(CAREGIVER);
  const rTools = (await resident.listTools()).tools;
  const cTools = (await caregiver.listTools()).tools;
  check(rTools.some((t) => t.name === 'kinwise_check_call') && !rTools.some((t) => t.name === 'kinwise_send_family_message'), 'resident catalog is role-scoped');
  check(cTools.some((t) => t.name === 'kinwise_send_family_message') && !cTools.some((t) => t.name === 'kinwise_check_call'), 'caregiver catalog is role-scoped');
  const all = [...rTools, ...cTools];
  check(all.every((t) => !!t.outputSchema), 'every tool declares an outputSchema');
  check(all.every((t) => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'), 'every tool declares annotations');
  const uiTools = all.filter((t) => (t._meta as any)?.ui?.resourceUri);
  check(uiTools.length >= 5, 'MCP Apps: tools link ui:// resources', `${new Set(uiTools.map((t) => t.name)).size} tools`);

  console.log('\nMCP Apps resources');
  for (const uri of ['ui://kinwise/screening', 'ui://kinwise/today', 'ui://kinwise/pause', 'ui://kinwise/timeline']) {
    const r = await resident.readResource({ uri });
    const c = r.contents[0] as { mimeType?: string; text?: string };
    check(c?.mimeType === 'text/html;profile=mcp-app' && /<html/i.test(c.text ?? ''), `${uri} served as text/html;profile=mcp-app`, `${((c.text?.length ?? 0) / 1024).toFixed(0)} KB`);
  }

  console.log('\nStructured results');
  const today = await resident.callTool({ name: 'kinwise_get_today', arguments: {} });
  check(!today.isError && typeof (today.structuredContent as any)?.dateLabel === 'string', 'kinwise_get_today returns structuredContent');
  const check1 = await resident.callTool({ name: 'kinwise_check_call', arguments: { description: 'Is it normal for the bank to ask me to buy gift cards?' } });
  check(!check1.isError && ['none', 'elevated', 'high'].includes((check1.structuredContent as any)?.level), 'kinwise_check_call returns a level', (check1.structuredContent as any)?.level);
  const tl = await caregiver.callTool({ name: 'kinwise_get_day_timeline', arguments: {} });
  check(!!tl.structuredContent || !!tl.isError, 'kinwise_get_day_timeline answers (or respects a sharing choice)');
  const err = await resident.callTool({ name: 'kinwise_respond_to_alert', arguments: { alertId: 'does-not-exist', action: 'dismiss' } });
  check(err.isError === true, 'domain errors become isError tool results');

  console.log('\nLatency (Alexa+ budget: < 500 ms round trip)');
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await resident.callTool({ name: 'kinwise_get_today', arguments: {} });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)]!;
  const p95 = times[Math.floor(times.length * 0.95)]!;
  check(p95 < 500, 'read tool p95 under 500 ms', `p50 ${p50.toFixed(0)} ms · p95 ${p95.toFixed(0)} ms`);

  await resident.close();
  await caregiver.close();
  const passed = results.filter(([ok]) => ok).length;
  console.log(`\n${passed}/${results.length} checks passed${failures ? ` — ${failures} failed` : ''}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('\nConformance run failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
