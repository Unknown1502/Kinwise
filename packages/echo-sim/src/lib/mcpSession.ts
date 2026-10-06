/**
 * One real MCP client per persona, talking to the hub's MCP server
 * (protocol 2025-11-25, Streamable HTTP) with that persona's bearer token —
 * the same way an Alexa+ device would after account linking. It reads the
 * MCP Apps UI resources (ui://kinwise/*), and is the client every AppBridge
 * forwards card tool calls through.
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool } from '@modelcontextprotocol/client';
import { RESOURCE_MIME_TYPE, getToolUiResourceUri } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { Persona } from './personas';
import { START_HUB_HINT } from './concierge';
import { createLoggingFetch, type WireEntry } from './wireLog';

export const HOST_INFO = { name: 'Kinwise Echo Show Simulator', version: '0.1.0' } as const;

export type McpStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected'; protocolVersion?: string; serverName?: string; serverVersion?: string; toolCount?: number }
  | { state: 'error'; message: string };

/** Friendly description of an MCP client failure. */
export function describeMcpError(err: unknown, hubUrl: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) {
    return `Can't reach the hub at ${hubUrl}. ${START_HUB_HINT}`;
  }
  if (name === 'UnauthorizedError' || /\b401\b|unauthori[sz]ed|invalid_token/i.test(msg)) {
    return 'The hub rejected this device token (401). Check VITE_ASHA_TOKEN / VITE_PRIYA_TOKEN.';
  }
  if (/\b403\b|forbidden|origin not allowed|insufficient_scope/i.test(msg)) {
    return `The hub refused this request (403): ${msg}`;
  }
  return msg || 'The MCP request failed.';
}

export class McpSession {
  private client?: Client;
  private connecting?: Promise<Client>;
  private tools = new Map<string, Tool>();
  private htmlCache = new Map<string, Promise<string>>();
  private statusValue: McpStatus = { state: 'idle' };
  private listeners = new Set<() => void>();

  constructor(
    readonly hubUrl: string,
    readonly persona: Persona,
    private readonly onWire: (entry: WireEntry) => void,
  ) {}

  // ── status store (for useSyncExternalStore) ──
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getStatus = (): McpStatus => this.statusValue;
  private setStatus(s: McpStatus): void {
    this.statusValue = s;
    for (const l of this.listeners) l();
  }

  /** Connect (initialize handshake) once; concurrent callers share the attempt; a failure allows a retry. */
  connect(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.setStatus({ state: 'connecting' });
    const attempt = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(`${this.hubUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${this.persona.token}` } },
        fetch: createLoggingFetch({ persona: this.persona.id, onEntry: this.onWire }),
      });
      const client = new Client({ name: HOST_INFO.name, version: HOST_INFO.version });
      client.onerror = (err) => {
        if (err?.name !== 'AbortError') console.warn(`[mcp:${this.persona.id}]`, err);
      };
      try {
        await client.connect(transport);
      } catch (err) {
        await client.close().catch(() => undefined);
        throw err;
      }
      return client;
    })();
    this.connecting = attempt;
    attempt.then(
      async (client) => {
        this.client = client;
        this.connecting = undefined;
        const info = client.getServerVersion();
        this.setStatus({
          state: 'connected',
          protocolVersion: client.getNegotiatedProtocolVersion(),
          serverName: info?.title ?? info?.name,
          serverVersion: info?.version,
        });
        // Discover tools (and their MCP Apps UI metadata) in the background.
        await this.refreshTools().catch(() => undefined);
      },
      (err: unknown) => {
        this.connecting = undefined;
        this.setStatus({ state: 'error', message: describeMcpError(err, this.hubUrl) });
      },
    );
    return attempt;
  }

  async refreshTools(): Promise<Tool[]> {
    const client = await this.connect();
    const { tools } = await client.listTools();
    this.tools = new Map(tools.map((t) => [t.name, t]));
    if (this.statusValue.state === 'connected') this.setStatus({ ...this.statusValue, toolCount: tools.length });
    return tools;
  }

  listCachedTools(): Tool[] {
    return [...this.tools.values()];
  }

  /** The tool's MCP Apps UI resource from its `_meta.ui.resourceUri`, as a host discovers it. */
  uiUriForTool = (name: string): string | undefined => {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    try {
      return getToolUiResourceUri(tool);
    } catch {
      return undefined;
    }
  };

  /** resources/read the card's HTML (text/html;profile=mcp-app). Cached per session. */
  readUiHtml(uri: string): Promise<string> {
    const cached = this.htmlCache.get(uri);
    if (cached) return cached;
    const p = (async () => {
      const client = await this.connect();
      const res = await client.readResource({ uri });
      const content = res.contents[0];
      if (!content) throw new Error(`The server returned no content for ${uri}`);
      if (content.mimeType && content.mimeType !== RESOURCE_MIME_TYPE) {
        throw new Error(`Unsupported UI resource type ${content.mimeType} for ${uri}`);
      }
      if ('text' in content && typeof content.text === 'string') return content.text;
      if ('blob' in content && typeof content.blob === 'string') {
        const bytes = Uint8Array.from(atob(content.blob), (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      }
      throw new Error(`UI resource ${uri} has no HTML`);
    })();
    this.htmlCache.set(uri, p);
    p.catch(() => this.htmlCache.delete(uri)); // allow a retry after a failure
    return p;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.connect();
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  /** The connected client (for AppBridge forwarding). */
  async getClient(): Promise<Client> {
    return this.connect();
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    this.connecting = undefined;
    this.htmlCache.clear();
    this.setStatus({ state: 'idle' });
    await c?.close().catch(() => undefined);
  }
}
