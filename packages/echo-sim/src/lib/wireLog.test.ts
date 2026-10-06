import { describe, expect, it } from 'vitest';
import {
  WireLogStore,
  createLoggingFetch,
  describeRpc,
  parseResponseBody,
  parseServerTiming,
  parseSseData,
  protocolVersionFrom,
  type WireEntry,
} from './wireLog';

describe('parseSseData', () => {
  it('extracts JSON from data: lines', () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect(parseSseData(body)).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }]);
  });

  it('handles several events, CRLF and no space after the colon', () => {
    const body = 'data:{"a":1}\r\n\r\nid: 7\r\ndata: {"b":2}\r\n\r\n';
    expect(parseSseData(body)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('joins multi-line data fields', () => {
    expect(parseSseData('data: {"a":\ndata: 1}\n\n')).toEqual([{ a: 1 }]);
  });

  it('ignores comments/empty events and keeps non-JSON data as text', () => {
    expect(parseSseData(': ping\n\ndata: hello\n\n\n')).toEqual(['hello']);
    expect(parseSseData('')).toEqual([]);
  });
});

describe('parseServerTiming', () => {
  it('reads the hub mcp metric', () => {
    expect(parseServerTiming('mcp;dur=12.5')).toBe(12.5);
    expect(parseServerTiming('cache;desc=hit, mcp;dur=3')).toBe(3);
  });
  it('falls back to the first dur and handles absence', () => {
    expect(parseServerTiming('db;dur=7')).toBe(7);
    expect(parseServerTiming(null)).toBeUndefined();
    expect(parseServerTiming('mcp')).toBeUndefined();
  });
});

describe('describeRpc', () => {
  it('summarises tools/call, resources/read and initialize', () => {
    expect(describeRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kinwise_get_today' } })).toEqual({
      methods: ['tools/call'],
      ids: [3],
      detail: 'kinwise_get_today',
    });
    expect(describeRpc({ id: 'a', method: 'resources/read', params: { uri: 'ui://kinwise/pause' } }).detail).toBe('ui://kinwise/pause');
    expect(describeRpc({ id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } }).detail).toBe('requests 2025-11-25');
  });
  it('handles batches and notifications', () => {
    const r = describeRpc([{ method: 'notifications/initialized' }, { id: 2, method: 'tools/list' }]);
    expect(r.methods).toEqual(['notifications/initialized', 'tools/list']);
    expect(r.ids).toEqual([2]);
  });
});

describe('parseResponseBody / protocolVersionFrom', () => {
  it('parses SSE and JSON bodies', () => {
    const sse = parseResponseBody('text/event-stream', 'data: {"id":1,"result":{"protocolVersion":"2025-11-25"}}\n\n');
    expect(protocolVersionFrom(sse)).toBe('2025-11-25');
    expect(parseResponseBody('application/json', '{"x":1}')).toEqual({ x: 1 });
    expect(parseResponseBody('application/json', '')).toBeUndefined();
    expect(parseResponseBody('text/plain', 'oops')).toBe('oops');
  });
});

describe('createLoggingFetch', () => {
  it('logs a pending entry, then the completed SSE exchange, without consuming the body', async () => {
    const entries: WireEntry[] = [];
    const sseBody = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n';
    const base = async () =>
      new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream', 'server-timing': 'mcp;dur=4.2' } });
    const f = createLoggingFetch({ persona: 'asha', onEntry: (e) => entries.push(e), baseFetch: base });
    const res = await f('http://hub/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer dev-asha', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    // The transport still gets the full body.
    expect(await res.text()).toBe(sseBody);
    await new Promise((r) => setTimeout(r, 0));
    expect(entries[0]).toMatchObject({ pending: true, verb: 'POST', rpcMethods: ['tools/list'] });
    const done = entries.at(-1)!;
    expect(done).toMatchObject({ pending: false, status: 200, serverTimingMs: 4.2, response: { id: 1, result: { tools: [] } } });
    expect(done.id).toBe(entries[0]!.id);
    expect(done.requestHeaders?.authorization).toBe('Bearer dev-a…');
  });

  it('records network errors and rethrows', async () => {
    const entries: WireEntry[] = [];
    const f = createLoggingFetch({
      persona: 'priya',
      onEntry: (e) => entries.push(e),
      baseFetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(f('http://hub/mcp', { method: 'POST', body: '{}' })).rejects.toThrow('Failed to fetch');
    expect(entries.at(-1)).toMatchObject({ pending: false, error: 'Failed to fetch', persona: 'priya' });
  });

  it('does not read GET streams', async () => {
    const entries: WireEntry[] = [];
    const f = createLoggingFetch({
      persona: 'asha',
      onEntry: (e) => entries.push(e),
      baseFetch: async () => new Response(null, { status: 405 }),
    });
    const res = await f('http://hub/mcp', { method: 'GET' });
    expect(res.status).toBe(405);
    expect(entries.at(-1)).toMatchObject({ verb: 'GET', status: 405, pending: false, note: 'no standalone stream (stateless server)' });
  });
});

describe('WireLogStore', () => {
  it('upserts by id, newest first, capped', () => {
    const store = new WireLogStore(2);
    let notified = 0;
    store.subscribe(() => notified++);
    const e = (id: number, pending = true) => ({ id, persona: 'asha', kind: 'http', at: id, verb: 'POST', rpcMethods: [], rpcIds: [], pending }) as WireEntry;
    store.upsert(e(1));
    store.upsert(e(2));
    store.upsert(e(1, false));
    expect(store.getSnapshot().map((x) => [x.id, x.pending])).toEqual([
      [2, true],
      [1, false],
    ]);
    store.upsert(e(3));
    expect(store.getSnapshot().map((x) => x.id)).toEqual([3, 2]);
    expect(notified).toBe(4);
  });
});
