/**
 * Opt-in integration test against a RUNNING hub (skipped unless KINWISE_HUB_URL is set):
 *
 *   cd packages/hub && STORE=memory npx tsx src/main.ts
 *   cd packages/echo-sim && KINWISE_HUB_URL=http://localhost:8787 npx vitest run src/lib/hub.e2e.test.ts
 *   (hosted hub: also set KINWISE_ASHA_TOKEN and KINWISE_PRIYA_TOKEN)
 *
 * Proves the simulator's MCP path end to end: our real MCP client negotiates
 * 2025-11-25, reads the MCP Apps UI resource, and an MCP Apps view's
 * callServerTool is forwarded by AppBridge → our client → the hub.
 */
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { afterAll, describe, expect, it } from 'vitest';
import { observeToolCalls } from './cardHost';
import { McpSession } from './mcpSession';
import { loadConfig } from './personas';
import type { WireEntry } from './wireLog';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const HUB = ENV.KINWISE_HUB_URL;

describe.skipIf(!HUB)('live hub (MCP client + AppBridge forwarding)', () => {
  // Hosted hubs need real persona tokens (KINWISE_ASHA_TOKEN / KINWISE_PRIYA_TOKEN); local dev hubs accept the defaults.
  const config = loadConfig({
    VITE_HUB_URL: HUB,
    VITE_ASHA_TOKEN: ENV.KINWISE_ASHA_TOKEN,
    VITE_PRIYA_TOKEN: ENV.KINWISE_PRIYA_TOKEN,
  });
  const wire: WireEntry[] = [];
  const asha = new McpSession(config.hubUrl, config.personas.asha, (e) => wire.push(e));
  const priya = new McpSession(config.hubUrl, config.personas.priya, () => undefined);

  afterAll(async () => {
    await asha.close();
    await priya.close();
  });

  it('negotiates protocol 2025-11-25 and logs the wire traffic', async () => {
    const client = await asha.connect();
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    await new Promise((r) => setTimeout(r, 50));
    const init = wire.find((e) => e.rpcMethods.includes('initialize') && !e.pending);
    expect(init?.status).toBe(200);
    expect(init?.serverTimingMs).toBeTypeOf('number');
    expect(JSON.stringify(init?.response)).toContain('2025-11-25');
    // The wire log must never show a full token: only a short prefix plus an ellipsis.
    expect(init?.requestHeaders?.authorization).toMatch(/^Bearer \S{1,5}…$/);
  });

  it('discovers tool UI metadata and reads the MCP Apps HTML', async () => {
    const tools = await asha.refreshTools();
    expect(tools.map((t) => t.name)).toContain('kinwise_check_call');
    expect(asha.uiUriForTool('kinwise_get_today')).toBe('ui://kinwise/today');
    const html = await asha.readUiHtml('ui://kinwise/pause');
    expect(html.toLowerCase()).toContain('<!doctype html>');
  });

  it('scopes tools by persona (caregiver cannot check calls)', async () => {
    const tools = await priya.refreshTools();
    expect(tools.map((t) => t.name)).toContain('kinwise_send_family_message');
    expect(tools.map((t) => t.name)).not.toContain('kinwise_check_call');
  });

  it('forwards a view tools/call through AppBridge → MCP client → hub and delivers the tool result', async () => {
    const observedCalls: string[] = [];
    // Exactly what the UI does: AppBridge gets our client wrapped by observeToolCalls.
    const client = observeToolCalls(await asha.getClient(), {
      onCall: (name) => observedCalls.push(`call ${name}`),
      onResult: (name, _a, r) => observedCalls.push(`result ${name} ${String(!!r.isError)}`),
    });
    const bridge = new AppBridge(client, { name: 'test-host', version: '0' }, { serverTools: {}, openLinks: {}, logging: {} }, {
      hostContext: { theme: 'dark', displayMode: 'inline', platform: 'web', locale: 'en-US' },
    });
    const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
    const initialized = new Promise<void>((resolve) => bridge.addEventListener('initialized', () => resolve()));
    await bridge.connect(hostSide);

    const app = new App({ name: 'kinwise-test-view', version: '0' }, {}, { autoResize: false });
    const gotResult = new Promise<unknown>((resolve) => {
      app.ontoolresult = (r) => resolve(r.structuredContent);
    });
    await app.connect(viewSide);
    await initialized;

    const direct = await asha.callTool('kinwise_get_today', {});
    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult(direct);
    expect(await gotResult).toMatchObject({ residentName: 'Asha' });

    const viaBridge = await app.callServerTool({ name: 'kinwise_get_today', arguments: {} });
    expect(viaBridge.isError).toBeFalsy();
    expect(viaBridge.structuredContent).toMatchObject({ residentName: 'Asha' });
    expect(observedCalls).toEqual(['call kinwise_get_today', 'result kinwise_get_today false']);

    await app.close();
    await bridge.close();
  });
});
