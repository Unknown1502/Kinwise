import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth/identity.js';
import { PermissionError } from '../src/auth/identity.js';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { signBody } from '../src/http/hmac.js';
import { ackKey, signAck } from '../src/services/ackLink.js';
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

describe('Nobody answered: re-send, then say so', () => {
  const MIN = 60_000;
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx?.restore();
    ctx = setup('works');
    await pressCall(ctx);
  });
  const requests = () => ctx.outbox.outbox.filter((n) => n.kind === 'call_request');
  const at = (minutes: number) => (ctx.clock.t = new Date(local('14:41').getTime() + minutes * MIN));

  it('says "asked" for the first two minutes and sends nothing more', async () => {
    at(1);
    expect((await ctx.service.tvState(tv)).call).toMatchObject({ status: 'asked', caregiverName: 'Meera' });
    expect(requests()).toHaveLength(1);
  });

  it('re-sends once after two minutes, even when the TV polls many times at once', async () => {
    at(2.5);
    const polls = await Promise.all([ctx.service.tvState(tv), ctx.service.tvState(tv), ctx.service.tvState(tv)]);
    await ctx.service.tvState(tv);
    expect(requests()).toHaveLength(2);
    expect(requests()[0]).toMatchObject({ title: expect.stringMatching(/still waiting/i), callId: requests()[1]!.callId });
    expect(polls.every((p) => p.call?.status === 'waiting')).toBe(true);
  });

  it('says "unanswered" after five minutes, with no third message', async () => {
    at(2.5);
    await ctx.service.tvState(tv);
    at(5.5);
    expect((await ctx.service.tvState(tv)).call?.status).toBe('unanswered');
    expect(requests()).toHaveLength(2);
  });

  it('stops asking once Meera confirms, and the call fades from the TV after an hour', async () => {
    const callId = requests()[0]!.callId!;
    at(1);
    await ctx.service.acknowledgeCall(meera, callId);
    at(10);
    const st = await ctx.service.tvState(tv);
    expect(st.call?.status).toBe('confirmed');
    expect(requests()).toHaveLength(1);
    at(61);
    expect((await ctx.service.tvState(tv)).call).toBeUndefined();
  });

  it('never re-sends a request that is already over an hour old', async () => {
    at(90);
    expect((await ctx.service.tvState(tv)).call).toBeUndefined();
    expect(requests()).toHaveLength(1);
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

describe('the confirm link under attack', () => {
  const secret = 'dev-ingest-secret'; // dev mode's ingest secret: what the app signs with
  async function app() {
    const config = loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv);
    const { app: hono } = await bootstrap(config);
    const call = (path: string, init: RequestInit = {}, token?: string) =>
      hono.fetch(new Request(`https://hub.example${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }));
    const press = async () => {
      const ring = await (await call('/dev/visitor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
      await call(`/tv/alerts/${ring.alertId}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'call_family' }) }, 'dev-tv');
      const notices = (await (await call('/dev/notices')).json()).notices as Array<{ callId?: string }>;
      return notices.find((n) => n.callId)!.callId!;
    };
    const notesFromMeera = async () => (await (await call('/tv/state', {}, 'dev-tv')).json()).today.messages.filter((m: any) => m.from === 'Meera').length;
    return { call, press, notesFromMeera };
  }
  const link = (householdId: string, callId: string, nowMs = Date.now()) => signAck(ackKey(secret), { householdId, callId }, nowMs);

  it('a valid link for another household cannot confirm this household call', async () => {
    const h = await app();
    const callId = await h.press();
    const res = await h.call(`/ack/${link('hh-someone-else', callId)}`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await h.notesFromMeera()).toBe(0);
  });

  it('a link for an earlier call stops working once a newer call is made', async () => {
    const h = await app();
    const first = await h.press();
    const second = await h.press();
    expect(second).not.toBe(first);
    expect((await h.call(`/ack/${link(DEMO_HOUSEHOLD_ID, first)}`, { method: 'POST' })).status).toBe(404);
    expect(await h.notesFromMeera()).toBe(0);
    expect((await h.call(`/ack/${link(DEMO_HOUSEHOLD_ID, second)}`, { method: 'POST' })).status).toBe(200);
    expect(await h.notesFromMeera()).toBe(1);
  });

  it('a link that is expired by one second, or enormous, or full of markup, is refused cleanly (403, never 500)', async () => {
    const h = await app();
    const callId = await h.press();
    expect((await h.call(`/ack/${link(DEMO_HOUSEHOLD_ID, callId, Date.now() - 3601_000)}`, { method: 'POST' })).status).toBe(403);
    for (const junk of ['x'.repeat(5000), '<script>alert(1)</script>', '%00%ff', '....']) {
      for (const method of ['GET', 'POST']) {
        const res = await h.call(`/ack/${encodeURIComponent(junk)}`, { method });
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain('<script>alert');
      }
    }
    expect(await h.notesFromMeera()).toBe(0);
  });

  it('a link cannot be used to confirm by asking with the wrong HTTP method or by crawling', async () => {
    const h = await app();
    const callId = await h.press();
    const url = `/ack/${link(DEMO_HOUSEHOLD_ID, callId)}`;
    for (const method of ['GET', 'HEAD']) await h.call(url, { method });
    expect(await h.notesFromMeera()).toBe(0);
    expect((await h.call(url, { method: 'PUT' })).status).toBe(404);
    expect((await h.call(url, { method: 'DELETE' })).status).toBe(404);
    expect(await h.notesFromMeera()).toBe(0);
  });

  it('a speech link or a forged payload is not accepted as a confirm link', async () => {
    const h = await app();
    const callId = await h.press();
    const forged = Buffer.from(JSON.stringify({ h: DEMO_HOUSEHOLD_ID, k: callId, e: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    expect((await h.call(`/ack/${forged}.${'a'.repeat(32)}`, { method: 'POST' })).status).toBe(403);
    expect(await h.notesFromMeera()).toBe(0);
  });
});

describe('the demo doorbell is always a stranger', () => {
  const tuesdayAideWindow = () => new Date('2026-10-13T14:30:00-04:00'); // the seeded aide is expected Tuesday 2-3 PM New York
  const event = (over: Record<string, unknown> = {}): VisitorEvent =>
    ({
      eventId: `e-${Math.random()}`,
      deviceId: 'd',
      occurredAt: tuesdayAideWindow().toISOString(),
      source: 'demo',
      ringEventType: 'button_press',
      perception: { personPresent: true, peopleCount: 1, description: 'a person' },
      ...over,
    }) as VisitorEvent;
  const make = async () => {
    const clock = { now: () => tuesdayAideWindow() };
    const service = new KinwiseService({ store: new MemoryStore(), notifier: new OutboxNotifier(() => {}), clock });
    await service.createHousehold(demoHousehold(clock.now()));
    return service;
  };

  it('during an expected visit a normal event is a greeting, a demo "stranger" event is not', async () => {
    const service = await make();
    expect((await service.ingestVisitor(HH, event())).decision).toBe('expected');
    expect((await service.ingestVisitor(HH, event({ unscheduled: true }))).decision).not.toBe('expected');
  });

  it('only a demo event can ignore the schedule: a Ring event that claims it is still matched to the visit', async () => {
    const service = await make();
    expect((await service.ingestVisitor(HH, event({ source: 'ring-webhook', unscheduled: true }))).decision).toBe('expected');
  });

  it('the signed Ring route strips the flag, and the dev doorbell sets it', async () => {
    const config = loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv);
    const { app, service } = await bootstrap(config, { clock: { now: () => tuesdayAideWindow() } });
    const res = await app.fetch(new Request('https://hub.example/dev/visitor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect((await res.json()).decision).not.toBe('expected');
    const raw = JSON.stringify({ householdId: HH, ...event({ source: 'demo', unscheduled: true, eventId: 'signed-1' }) });
    const signed = await app.fetch(new Request('https://hub.example/events/visitor', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kinwise-signature': signBody('dev-ingest-secret', raw) }, body: raw }));
    expect((await signed.json()).decision).toBe('expected');
    void service;
  });
});

describe('what the caregiver was told is kept with the household, not in one server memory', () => {
  it('lists notices newest first from stored state, so any server instance shows the same phone', async () => {
    const ctx = setup('works');
    await pressCall(ctx);
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 2.5 * 60_000);
    await ctx.service.tvState(tv); // the second message
    const notices = await ctx.service.recentNotices(HH);
    expect(notices.map((n) => n.kind)).toEqual(['call_request', 'call_request']);
    expect(notices[0]!.title).toMatch(/still waiting/i);
    expect(notices[0]!.callId).toBe(notices[1]!.callId);
    ctx.restore();
  });

  it('keeps only the latest thirty, and nothing but signals', async () => {
    const ctx = setup('works');
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
    for (let i = 0; i < 40; i++) {
      ctx.clock.t = new Date(ctx.clock.t.getTime() + 31 * 60_000);
      await ctx.service.ingestVisitor(HH, { ...stranger(), eventId: `e${i}` });
    }
    const notices = await ctx.service.recentNotices(HH);
    expect(notices.length).toBeLessThanOrEqual(30);
    for (const n of notices) expect(Object.keys(n).sort()).toEqual(['at', 'body', 'callId', 'caregiverId', 'caregiverName', 'householdId', 'kind', 'title'].filter((k) => k in n).sort());
    ctx.restore();
  });
});
