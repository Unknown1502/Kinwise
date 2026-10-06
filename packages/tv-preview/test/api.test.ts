import {afterEach, describe, expect, it, vi} from 'vitest';
import {HubClient, HubError, resolveMediaUrl} from '../../tv-app/src/api';
import {homeState} from '../../tv-app/test/fixtures';

type Call = {url: string; init: RequestInit};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  return new HubClient({baseUrl: 'http://hub.test:8787/', token: 'dev-tv', fetchImpl, timeoutMs});
}

function recorder(response: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({url, init: init ?? {}});
    return response();
  });
  return {calls, fetchImpl};
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HubClient', () => {
  it('GETs /tv/state with the bearer device token', async () => {
    const state = homeState();
    const {calls, fetchImpl} = recorder(() => jsonResponse(state));
    await expect(client(fetchImpl).getState()).resolves.toEqual(state);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://hub.test:8787/tv/state');
    expect(calls[0]!.init.method).toBe('GET');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer dev-tv');
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['respondToAlert', (c: HubClient) => c.respondToAlert('alert 1', 'call_family'), '/tv/alerts/alert%201/respond', {action: 'call_family'}],
    ['decideProposal', (c: HubClient) => c.decideProposal('visit_9', 'approve'), '/tv/proposals/visit_9', {decision: 'approve'}],
    ['updateConsent', (c: HubClient) => c.updateConsent({doorAwareness: false, onboarded: true}), '/tv/consent', {doorAwareness: false, onboarded: true}],
    ['setPrivacyHour', (c: HubClient) => c.setPrivacyHour(60), '/tv/privacy-hour', {minutes: 60}],
    ['markMessageRead', (c: HubClient) => c.markMessageRead('msg_1'), '/tv/messages/msg_1/read', {}],
    ['closeSafety', (c: HubClient) => c.closeSafety(), '/tv/safety/close', {}],
  ] as const)('%s POSTs JSON to the right route', async (_name, call, path, body) => {
    const {calls, fetchImpl} = recorder(() => jsonResponse({ok: true}));
    await call(client(fetchImpl));
    expect(calls[0]!.url).toBe(`http://hub.test:8787${path}`);
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBe('Bearer dev-tv');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(body);
  });

  it('turns hub errors into HubError with status and code', async () => {
    const {fetchImpl} = recorder(() => jsonResponse({error: 'invalid_token', error_description: 'Unknown or expired token'}, 401));
    const err = await client(fetchImpl).getState().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err).toMatchObject({status: 401, code: 'invalid_token', message: 'Unknown or expired token'});
    expect((err as HubError).transient).toBe(false);
  });

  it('handles non-JSON error bodies', async () => {
    const {fetchImpl} = recorder(() => new Response('<html>bad gateway</html>', {status: 502}));
    const err = (await client(fetchImpl).getState().catch((e: unknown) => e)) as HubError;
    expect(err).toMatchObject({status: 502, code: 'http_error'});
    expect(err.transient).toBe(true);
  });

  it('reports network failures as transient', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await client(fetchImpl).getState().catch((e: unknown) => e)) as HubError;
    expect(err).toMatchObject({status: 0, code: 'network'});
    expect(err.transient).toBe(true);
  });

  it('aborts after 8 s by default', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = client(fetchImpl).getState().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(7999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = (await pending) as HubError;
    expect(signal?.aborted).toBe(true);
    expect(err).toMatchObject({status: 0, code: 'timeout'});
  });

  it('honours a custom timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = client(fetchImpl, 500).getState().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({code: 'timeout'});
  });

  it('resolves hub-relative media URLs', () => {
    const c = client(vi.fn());
    expect(c.mediaUrl('/media/priya-pause.mp4')).toBe('http://hub.test:8787/media/priya-pause.mp4');
    expect(c.mediaUrl('https://cdn.example/v.mp4')).toBe('https://cdn.example/v.mp4');
    expect(c.mediaUrl(undefined)).toBeUndefined();
    expect(resolveMediaUrl('http://h:1', 'media/a.mp4')).toBe('http://h:1/media/a.mp4');
  });
});
