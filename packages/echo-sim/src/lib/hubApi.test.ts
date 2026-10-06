import { describe, expect, it } from 'vitest';
import { askConcierge, describeDecision, fetchNotices, parseNotices, ringDoorbell } from './hubApi';

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('askConcierge', () => {
  it('posts text + sessionId with the bearer token and validates the reply', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const out = await askConcierge('http://hub', 'dev-asha', 'hello', 's1', {
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify({ reply: 'Hi Asha', toolCalls: [], sessionId: 's1', model: 'offline-router', latencyMs: 5 }));
      },
    });
    expect(seen?.url).toBe('http://hub/sim/ask');
    expect((seen?.init?.headers as Record<string, string>).authorization).toBe('Bearer dev-asha');
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ text: 'hello', sessionId: 's1' });
    expect(out).toMatchObject({ ok: true, response: { reply: 'Hi Asha', model: 'offline-router' } });
  });

  it('classifies a missing concierge', async () => {
    const out = await askConcierge('http://hub', 't', 'x', 's', { fetchImpl: json(503, { error: 'concierge_not_configured' }) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.kind).toBe('concierge_not_configured');
  });

  it('reports an unreachable hub', async () => {
    const out = await askConcierge('http://hub', 't', 'x', 's', {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.kind).toBe('hub_unreachable');
  });

  it('reports a malformed reply', async () => {
    const out = await askConcierge('http://hub', 't', 'x', 's', { fetchImpl: json(200, { nope: true }) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.kind).toBe('bad_response');
  });
});

describe('notices', () => {
  it('keeps well-formed notices only', () => {
    expect(
      parseNotices({
        notices: [
          { caregiverName: 'Priya', kind: 'pause', title: 'Pause shown', body: 'Unexpected visitor', at: '2026-10-05T14:41:00Z' },
          { title: 5 },
          null,
        ],
      }),
    ).toEqual([{ caregiverName: 'Priya', kind: 'pause', title: 'Pause shown', body: 'Unexpected visitor', at: '2026-10-05T14:41:00Z' }]);
    expect(parseNotices({})).toEqual([]);
  });

  it('hides the phone when the dev route is absent and flags an offline hub', async () => {
    expect(await fetchNotices('http://hub', json(404, { error: 'not_found' }))).toEqual({ status: 'unavailable' });
    expect(
      await fetchNotices('http://hub', async () => {
        throw new TypeError('x');
      }),
    ).toEqual({ status: 'offline' });
    expect(await fetchNotices('http://hub', json(200, { notices: [] }))).toEqual({ status: 'ok', notices: [] });
  });
});

describe('doorbell', () => {
  it('parses the decision', async () => {
    const out = await ringDoorbell('http://hub', { personPresent: true }, json(200, { duplicate: false, decision: 'pause', alertId: 'a1' }));
    expect(out).toEqual({ ok: true, data: { duplicate: false, decision: 'pause', alertId: 'a1' } });
    if (out.ok) expect(describeDecision(out.data)).toMatch(/Pause/);
  });
});
