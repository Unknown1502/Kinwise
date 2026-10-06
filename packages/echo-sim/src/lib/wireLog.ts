/**
 * "Under the hood" wire logging for the simulator's own MCP client.
 *
 * `createLoggingFetch` wraps the fetch passed to StreamableHTTPClientTransport so
 * every JSON-RPC exchange with the hub (initialize, tools/list, resources/read,
 * tools/call — including calls a card makes through the AppBridge) is recorded
 * with method, request JSON, HTTP status, the hub's `server-timing` header and
 * the response (JSON or SSE `data:` events). The parsing helpers are pure and
 * unit-tested.
 */
import type { PersonaId } from './personas';
import { maskToken } from './personas';

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface WireEntry {
  id: number;
  persona: PersonaId;
  kind: 'http' | 'bridge';
  /** epoch ms */
  at: number;
  /** HTTP method for kind=http (POST/GET/DELETE); direction label for bridge events. */
  verb: string;
  /** JSON-RPC methods in the message (a batch can carry several). */
  rpcMethods: string[];
  rpcIds: Array<string | number>;
  /** Short detail: tool name, resource uri, requested protocol version… */
  detail?: string;
  request?: unknown;
  requestHeaders?: Record<string, string>;
  status?: number;
  contentType?: string;
  /** Hub-measured duration from the `server-timing` header (ms). */
  serverTimingMs?: number;
  /** Round trip measured in the browser (ms). */
  clientMs?: number;
  response?: unknown;
  note?: string;
  error?: string;
  pending: boolean;
}

/** Parse a Server-Sent Events body into the JSON payloads of its `data:` lines. */
export function parseSseData(text: string): unknown[] {
  const out: unknown[] = [];
  const events = text.replace(/\r\n?/g, '\n').split(/\n\n+/);
  for (const event of events) {
    const data: string[] = [];
    for (const line of event.split('\n')) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    const payload = data.join('\n').trim();
    if (!payload) continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      out.push(payload);
    }
  }
  return out;
}

/** Read `dur` from a Server-Timing header, preferring the hub's `mcp` metric. */
export function parseServerTiming(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const metrics = header.split(',').map((m) => m.trim());
  const pick = metrics.find((m) => /^mcp\b/i.test(m)) ?? metrics.find((m) => /dur=/.test(m));
  const m = pick ? /dur=([\d.]+)/.exec(pick) : null;
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

interface RpcSummary {
  methods: string[];
  ids: Array<string | number>;
  detail?: string;
}

/** Summarise a JSON-RPC message or batch: methods, ids and a short detail. */
export function describeRpc(body: unknown): RpcSummary {
  const msgs = Array.isArray(body) ? body : body === undefined ? [] : [body];
  const methods: string[] = [];
  const ids: Array<string | number> = [];
  const details: string[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as { method?: unknown; id?: unknown; params?: Record<string, unknown> };
    if (typeof msg.method === 'string') methods.push(msg.method);
    if (typeof msg.id === 'string' || typeof msg.id === 'number') ids.push(msg.id);
    const p = msg.params;
    if (p && typeof p === 'object') {
      if (msg.method === 'tools/call' && typeof p.name === 'string') details.push(p.name);
      else if (msg.method === 'resources/read' && typeof p.uri === 'string') details.push(p.uri);
      else if (msg.method === 'initialize' && typeof p.protocolVersion === 'string') details.push(`requests ${p.protocolVersion}`);
    }
  }
  return { methods, ids, detail: details.length ? details.join(', ') : undefined };
}

/** Parse a response body according to its content type. */
export function parseResponseBody(contentType: string | null | undefined, text: string): unknown {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/event-stream')) {
    const events = parseSseData(text);
    return events.length === 1 ? events[0] : events;
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  }
}

/** The negotiated protocol version from an initialize response, if this is one. */
export function protocolVersionFrom(response: unknown): string | undefined {
  const msgs = Array.isArray(response) ? response : [response];
  for (const m of msgs) {
    const r = (m as { result?: { protocolVersion?: unknown } } | undefined)?.result;
    if (r && typeof r.protocolVersion === 'string') return r.protocolVersion;
  }
  return undefined;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = key === 'authorization' ? value.replace(/^(Bearer\s+)(.+)$/i, (_, p: string, t: string) => p + maskToken(t)) : value;
  });
  return out;
}

function bodyText(body: BodyInit | null | undefined): string | undefined {
  return typeof body === 'string' ? body : undefined;
}

let nextId = 1;
export function nextWireId(): number {
  return nextId++;
}

export interface LoggingFetchOptions {
  persona: PersonaId;
  /** Called once when the request starts (pending) and again when it completes. */
  onEntry: (entry: WireEntry) => void;
  baseFetch?: FetchLike;
  now?: () => number;
  clock?: () => number;
}

/** Wrap fetch so every MCP HTTP exchange is recorded for the "Under the hood" drawer. */
export function createLoggingFetch(opts: LoggingFetchOptions): FetchLike {
  const base: FetchLike = opts.baseFetch ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? (() => Date.now());
  const clock = opts.clock ?? (() => performance.now());

  return async (url, init) => {
    const verb = (init?.method ?? 'GET').toUpperCase();
    const raw = bodyText(init?.body);
    let request: unknown = raw;
    if (raw) {
      try {
        request = JSON.parse(raw);
      } catch {
        /* keep the raw text */
      }
    }
    const rpc = describeRpc(request);
    const entry: WireEntry = {
      id: nextWireId(),
      persona: opts.persona,
      kind: 'http',
      at: now(),
      verb,
      rpcMethods: rpc.methods,
      rpcIds: rpc.ids,
      detail: rpc.detail ?? (verb === 'GET' ? 'open SSE stream' : verb === 'DELETE' ? 'end session' : undefined),
      request,
      requestHeaders: headersToRecord(init?.headers),
      pending: true,
    };
    opts.onEntry({ ...entry });
    const started = clock();

    let res: Response;
    try {
      res = await base(url, init);
    } catch (err) {
      opts.onEntry({ ...entry, pending: false, clientMs: clock() - started, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    const head: WireEntry = {
      ...entry,
      status: res.status,
      contentType: res.headers.get('content-type') ?? undefined,
      serverTimingMs: parseServerTiming(res.headers.get('server-timing')),
    };

    const contentType = res.headers.get('content-type');
    const isStream = (contentType ?? '').includes('text/event-stream');
    if (verb === 'GET' || !res.body) {
      // Never tee a long-lived GET stream; just record the status.
      opts.onEntry({
        ...head,
        pending: false,
        clientMs: clock() - started,
        note: res.status === 202 ? '202 Accepted (no body)' : verb === 'GET' ? (res.ok ? 'stream opened' : 'no standalone stream (stateless server)') : undefined,
      });
      return res;
    }

    // Read a copy of the body in the background so the transport is never delayed.
    res
      .clone()
      .text()
      .then((text) => {
        opts.onEntry({
          ...head,
          pending: false,
          clientMs: clock() - started,
          response: parseResponseBody(contentType, text),
          note: isStream ? 'SSE response (data: events)' : undefined,
        });
      })
      .catch((err: unknown) => {
        opts.onEntry({ ...head, pending: false, clientMs: clock() - started, error: err instanceof Error ? err.message : String(err) });
      });
    return res;
  };
}

/** A tiny external store for wire entries (used with React's useSyncExternalStore). */
export class WireLogStore {
  private entries: WireEntry[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly max = 300) {}

  upsert = (entry: WireEntry): void => {
    const i = this.entries.findIndex((e) => e.id === entry.id);
    if (i >= 0) {
      const copy = this.entries.slice();
      copy[i] = entry;
      this.entries = copy;
    } else {
      this.entries = [entry, ...this.entries].slice(0, this.max);
    }
    this.emit();
  };

  clear = (): void => {
    this.entries = [];
    this.emit();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WireEntry[] => this.entries;

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
