import { describe, expect, it } from 'vitest';
import { askConcierge, confirmCall, loadContacts, saveContacts, describeDecision, fetchNotices, parseNotices, resetDemo, ringDoorbell } from './hubApi';

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
          { caregiverName: 'Meera', kind: 'pause', title: 'Pause shown', body: 'Unexpected visitor', at: '2026-10-05T14:41:00Z' },
          { title: 5 },
          null,
        ],
      }),
    ).toEqual([{ caregiverName: 'Meera', kind: 'pause', title: 'Pause shown', body: 'Unexpected visitor', at: '2026-10-05T14:41:00Z' }]);
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

describe('dev routes on a hosted hub (they need a household token)', () => {
  const capture = () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      return new Response(JSON.stringify({ ok: true, notices: [], decision: 'pause' }), { status: 200 });
    };
    return { seen, fetchImpl };
  };

  it('sends the bearer token on notices, reset and the doorbell', async () => {
    const { seen, fetchImpl } = capture();
    await fetchNotices('http://hub', fetchImpl, 'tok-priya');
    await resetDemo('http://hub', fetchImpl, 'tok-asha');
    await ringDoorbell('http://hub', { personPresent: true }, fetchImpl, 'tok-asha');
    expect(seen).toEqual([
      { url: 'http://hub/dev/notices', auth: 'Bearer tok-priya' },
      { url: 'http://hub/dev/reset', auth: 'Bearer tok-asha' },
      { url: 'http://hub/dev/visitor', auth: 'Bearer tok-asha' },
    ]);
  });

  it('still works without a token (a local dev hub needs none)', async () => {
    const { seen, fetchImpl } = capture();
    await fetchNotices('http://hub', fetchImpl);
    expect(seen[0]!.auth).toBeUndefined();
  });
});

describe('doorbell', () => {
  it('parses the decision', async () => {
    const out = await ringDoorbell('http://hub', { personPresent: true }, json(200, { duplicate: false, decision: 'pause', alertId: 'a1' }));
    expect(out).toEqual({ ok: true, data: { duplicate: false, decision: 'pause', alertId: 'a1' } });
    if (out.ok) expect(describeDecision(out.data)).toMatch(/Pause/);
  });
});

describe('confirmCall (Meera confirms she is calling)', () => {
  it('posts to the caregiver route with her login', async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const out = await confirmCall('http://hub', 'call 1', async (url, init) => {
      seen.push([String(url), init]);
      return new Response('{}', { status: 200 });
    }, 'tok');
    expect(out.ok).toBe(true);
    expect(seen[0]![0]).toBe('http://hub/caregiver/calls/call%201/ack');
    expect(seen[0]![1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer tok' } });
  });

  it('says why when it did not work', async () => {
    expect(await confirmCall('http://hub', 'c', async () => new Response('{}', { status: 404 }))).toMatchObject({ ok: false, message: expect.stringMatching(/no longer/) });
    expect(await confirmCall('http://hub', 'c', async () => { throw new Error('x'); })).toMatchObject({ ok: false });
  });
});

describe('contacts (Meera sets where Kinwise reaches her)', () => {
  it('loads and saves with her login, and passes the hub own reason on', async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push([String(url), init]);
      return new Response(JSON.stringify(init?.method === 'PUT' ? { contacts: { sms: '+919876543210' }, email: 'unchanged' } : { contacts: { sms: '+919876543210' } }), { status: 200 });
    };
    expect(await loadContacts('http://hub', fetchImpl, 'tok')).toEqual({ ok: true, data: { sms: '+919876543210' } });
    expect(await saveContacts('http://hub', { sms: '+919876543210' }, fetchImpl, 'tok')).toMatchObject({ ok: true, data: { email: 'unchanged' } });
    expect(seen[1]![1]).toMatchObject({ method: 'PUT', body: '{"sms":"+919876543210"}', headers: { authorization: 'Bearer tok' } });
    const wait = async () => new Response(JSON.stringify({ error: 'invalid_request', error_description: 'Please wait a minute before changing contacts again' }), { status: 400 });
    expect(await saveContacts('http://hub', { sms: '' }, wait, 'tok')).toEqual({ ok: false, message: 'Please wait a minute before changing contacts again' });
  });
});
