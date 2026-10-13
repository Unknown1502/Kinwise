import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth/identity.js';
import { PermissionError } from '../src/auth/identity.js';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { KinwiseService, NotFoundError, ValidationError } from '../src/services/kinwise.js';
import { MultiNotifier, OutboxNotifier, type Notifier } from '../src/services/notifier.js';
import { MemoryStore } from '../src/store/memory.js';
import type { VisitorEvent } from '../src/domain/types.js';

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };
const meera: Identity = { userId: 'priya', householdId: HH, role: 'caregiver', name: 'Meera', scopes: [] };
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };
const local = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00-04:00`);

const stranger = (): VisitorEvent => ({
  eventId: 'evt-1',
  deviceId: 'front-door',
  occurredAt: local('14:41').toISOString(),
  source: 'demo',
  ringEventType: 'button_press',
  perception: { personPresent: true, peopleCount: 1, description: 'A person at the front door holding a small box' },
});

/** A phone-push channel we can switch off, next to the simulated phone. */
function setup(realChannel: 'works' | 'fails') {
  const clock = { t: local('14:41'), now() { return this.t; } };
  const outbox = new OutboxNotifier(() => {});
  const real: Notifier = { notify: async () => realChannel === 'works' };
  const silence = console.error;
  console.error = () => {};
  let n = 0;
  const service = new KinwiseService({
    store: new MemoryStore(),
    notifier: new MultiNotifier([outbox, real]),
    clock,
    ids: (p) => `${p}_${++n}`,
  });
  return { clock, outbox, service, restore: () => (console.error = silence) };
}

async function pressCall(ctx: ReturnType<typeof setup>) {
  await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
  const { alertId } = await ctx.service.ingestVisitor(HH, stranger());
  return ctx.service.respondToAlert(tv, alertId!, 'call_family');
}

describe('Call Meera: did anyone get told?', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => ctx?.restore());

  it('says delivered when a real channel got the notice, and the notice names the call to confirm', async () => {
    ctx = setup('works');
    const res = await pressCall(ctx);
    expect(res.delivered).toBe(true);
    expect(res.message).toBe('Calling Meera now.');
    expect(ctx.outbox.outbox[0]).toMatchObject({ kind: 'call_request', callId: expect.stringMatching(/^call_/) });
  });

  it('says NOT delivered when the real channel failed, so the TV can tell Asha to call herself', async () => {
    ctx = setup('fails');
    const res = await pressCall(ctx);
    expect(res.delivered).toBe(false);
    expect(res.message).toMatch(/couldn't reach Meera/i);
  });

  it('does not claim a call for the other answers', async () => {
    ctx = setup('works');
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
    const { alertId } = await ctx.service.ingestVisitor(HH, stranger());
    const res = await ctx.service.respondToAlert(tv, alertId!, 'dismiss');
    expect(res.delivered).toBeUndefined();
  });
});

describe('Meera confirms she is calling', () => {
  let ctx: ReturnType<typeof setup>;
  let callId: string;
  beforeEach(async () => {
    ctx?.restore();
    ctx = setup('works');
    await pressCall(ctx);
    callId = ctx.outbox.outbox[0]!.callId!;
  });

  it('puts "I got it, I\'m calling you now" on Asha\'s TV as a note from Meera, once', async () => {
    await ctx.service.acknowledgeCall(meera, callId);
    await ctx.service.acknowledgeCall(meera, callId); // pressing the button twice
    const notes = (await ctx.service.tvState(tv)).today.messages.filter((m) => m.from === 'Meera');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toMatch(/I got your request.*calling you now/i);
  });

  it('works from a signed link (no login) and says the same thing', async () => {
    await ctx.service.acknowledgeCallByLink(HH, callId);
    expect((await ctx.service.tvState(tv)).today.messages[0]!.text).toMatch(/calling you now/i);
  });

  it('is only for the caregiver, only for the call that was made, and only for an hour', async () => {
    await expect(ctx.service.acknowledgeCall(asha, callId)).rejects.toBeInstanceOf(PermissionError);
    await expect(ctx.service.acknowledgeCall(meera, 'call_999')).rejects.toBeInstanceOf(NotFoundError);
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 61 * 60_000);
    await expect(ctx.service.acknowledgeCall(meera, callId)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('over HTTP: WhatsApp reaches the caregiver', () => {
  it('sends the call request to WhatsApp with a working confirm link, and a failure is told to the TV', async () => {
    for (const twilioStatus of [201, 400]) {
      const sent: Array<{ url: string; body: string }> = [];
      const config = loadConfig({
        AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '', PUBLIC_BASE_URL: 'https://hub.example',
        WHATSAPP_ACCOUNT_SID: 'AC' + 'a1'.repeat(16), WHATSAPP_AUTH_TOKEN: 'tok', WHATSAPP_FROM: 'whatsapp:+14155238886', WHATSAPP_TO: 'whatsapp:+919876543210',
      } as NodeJS.ProcessEnv);
      const restore = console.error;
      console.error = () => {};
      const { app } = await bootstrap(config, {
        fetch: (async (url: string, init: { body: string }) => {
          sent.push({ url, body: init.body });
          return new Response('{"code":63016}', { status: twilioStatus });
        }) as unknown as typeof globalThis.fetch,
      });
      const call = (path: string, init: RequestInit = {}, token?: string) =>
        app.fetch(new Request(`https://hub.example${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }));
      const ring = await (await call('/dev/visitor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
      const out = await (await call(`/tv/alerts/${ring.alertId}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'call_family' }) }, 'dev-tv')).json();
      console.error = restore;
      expect(out.delivered).toBe(twilioStatus === 201);
      const text = new URLSearchParams(sent.find((s) => s.url.includes('twilio'))!.body).get('Body')!;
      const link = /https:\/\/hub\.example\/ack\/\S+/.exec(text)![0];
      if (twilioStatus === 201) {
        expect((await call(new URL(link).pathname, { method: 'POST' })).status).toBe(200);
        expect((await (await call('/tv/state', {}, 'dev-tv')).json()).today.messages[0].from).toBe('Meera');
      }
    }
  });
});

describe('over HTTP: the push button and the confirm page', () => {
  const topic = 'kw-test-topic-0123456789';
  async function app(pushStatus = 200) {
    const pushes: Array<Record<string, any>> = [];
    const config = loadConfig({
      AUTH_MODE: 'dev',
      STORE: 'memory',
      CONCIERGE_URL: '',
      NTFY_TOPIC: topic,
      NTFY_SERVER: 'https://ntfy.example',
      PUBLIC_BASE_URL: 'https://hub.example',
    } as NodeJS.ProcessEnv);
    const boot = await bootstrap(config, {
      fetch: (async (_url: string, init: { body: string }) => {
        pushes.push(JSON.parse(init.body));
        return new Response('{}', { status: pushStatus });
      }) as unknown as typeof globalThis.fetch,
    });
    const call = (path: string, init: RequestInit = {}, token?: string) =>
      boot.app.fetch(new Request(`https://hub.example${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }));
    return { pushes, call };
  }

  async function pressCallOverHttp(h: Awaited<ReturnType<typeof app>>) {
    const ring = await (await h.call('/dev/visitor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const res = await h.call(`/tv/alerts/${ring.alertId}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'call_family' }) }, 'dev-tv');
    return res.json();
  }

  it('pushes to the phone with a working confirm button; pressing it tells the TV', async () => {
    const h = await app();
    const out = await pressCallOverHttp(h);
    expect(out.delivered).toBe(true);
    const push = h.pushes.find((p) => p.priority === 5)!;
    expect(push.topic).toBe(topic);
    const url = new URL(push.actions[0].url);
    expect(url.origin).toBe('https://hub.example');

    const page = await h.call(url.pathname); // opening the link shows a button, it does not confirm by itself
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(await page.text()).toContain('<form method="post"');
    expect((await (await h.call('/tv/state', {}, 'dev-tv')).json()).today.messages).toHaveLength(0);

    const done = await h.call(url.pathname, { method: 'POST' });
    expect(done.status).toBe(200);
    expect((await (await h.call('/tv/state', {}, 'dev-tv')).json()).today.messages[0].text).toMatch(/calling you now/i);
  });

  it('tells the TV it did not get through when the push service refuses', async () => {
    const restore = console.error;
    console.error = () => {};
    const h = await app(500);
    const out = await pressCallOverHttp(h);
    console.error = restore;
    expect(out.delivered).toBe(false);
  });

  it('refuses a bad or expired link, and a login that is not the caregiver', async () => {
    const h = await app();
    expect((await h.call('/ack/not-a-token')).status).toBe(403);
    expect((await h.call('/ack/not-a-token', { method: 'POST' })).status).toBe(403);
    expect((await h.call('/caregiver/calls/call_1/ack', { method: 'POST' })).status).toBe(401);
    expect((await h.call('/caregiver/calls/call_1/ack', { method: 'POST' }, 'dev-asha')).status).toBe(403);
  });

  it('lets Meera confirm from her own login (the simulator\'s phone panel)', async () => {
    const h = await app();
    await pressCallOverHttp(h);
    const notice = (await (await h.call('/dev/notices', {}, 'dev-priya')).json()).notices.find((n: any) => n.kind === 'call_request');
    const res = await h.call(`/caregiver/calls/${notice.callId}/ack`, { method: 'POST' }, 'dev-priya');
    expect(res.status).toBe(200);
    expect((await (await h.call('/tv/state', {}, 'dev-tv')).json()).today.messages[0].from).toBe('Meera');
  });
});
