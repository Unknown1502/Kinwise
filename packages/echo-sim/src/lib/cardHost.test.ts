import type { Client } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { CARD_SANDBOX, inlineHeight, isSafeExternalUrl, observeToolCalls, toCallToolResult } from './cardHost';

describe('card sandbox policy', () => {
  it('never grants same-origin to card HTML', () => {
    expect(CARD_SANDBOX).toBe('allow-scripts allow-forms');
    expect(CARD_SANDBOX).not.toContain('allow-same-origin');
  });

  it('only opens http(s) links', () => {
    expect(isSafeExternalUrl('https://www.ftc.gov/scams')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,hi')).toBe(false);
    expect(isSafeExternalUrl('nope')).toBe(false);
  });
});

describe('inlineHeight', () => {
  it('follows the view up to the cap, then the frame scrolls', () => {
    expect(inlineHeight(312.2, 520)).toBe(313);
    expect(inlineHeight(1400, 520)).toBe(520);
    expect(inlineHeight(0, 520)).toBe(180);
    expect(inlineHeight(Number.NaN, 520)).toBe(180);
  });
});

describe('toCallToolResult', () => {
  it('adds the required content array', () => {
    expect(toCallToolResult({ structuredContent: { a: 1 } })).toEqual({ structuredContent: { a: 1 }, content: [] });
  });
});

describe('observeToolCalls', () => {
  it('reports tools/call through the proxy and passes everything else through', async () => {
    const seen: string[] = [];
    const fake = {
      marker: 42,
      calls: 0,
      getServerCapabilities() {
        return { tools: {}, self: this.marker };
      },
      async request(req: { method: string }) {
        this.calls += 1;
        return req.method === 'tools/call' ? { content: [{ type: 'text', text: 'Okay.' }], isError: false } : { tools: [] };
      },
    };
    const proxied = observeToolCalls(fake as unknown as Client, {
      onCall: (name, args) => seen.push(`call ${name} ${JSON.stringify(args)}`),
      onResult: (name, _args, result) => seen.push(`result ${name} ${String(result.isError)}`),
    });
    expect((proxied as unknown as typeof fake).getServerCapabilities()).toEqual({ tools: {}, self: 42 });
    await (proxied as unknown as typeof fake).request({ method: 'tools/list' });
    const r = await (proxied as unknown as { request: (q: unknown, o?: unknown) => Promise<unknown> }).request(
      { method: 'tools/call', params: { name: 'kinwise_respond_to_alert', arguments: { action: 'call_family' } } },
      { signal: undefined },
    );
    await Promise.resolve();
    expect(r).toMatchObject({ isError: false });
    expect(fake.calls).toBe(2);
    expect(seen).toEqual(['call kinwise_respond_to_alert {"action":"call_family"}', 'result kinwise_respond_to_alert false']);
  });
});
