import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import type { Identity } from '../src/auth/identity.js';
import { PermissionError } from '../src/auth/identity.js';
import type { VisitorEvent } from '../src/domain/types.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { KinwiseService, ValidationError } from '../src/services/kinwise.js';
import { OutboxNotifier } from '../src/services/notifier.js';
import { MemoryStore } from '../src/store/memory.js';

// covers: R1, R2, R3, R4, R5 (see .aqg/code-construction/watch-consent.md)

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };
const priya: Identity = { userId: 'priya', householdId: HH, role: 'caregiver', name: 'Meera', scopes: [] };
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };
const service_: Identity = { userId: 'svc', householdId: HH, role: 'service', name: 'Alexa', scopes: [] };

// Thursday 2026-10-08 in New York (UTC-4).
const local = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00-04:00`);
const CALL = 'A man from the FTC said my accounts are compromised and I should withdraw it as gold. Do not tell my family.';

function setup() {
  const clock = { t: local('10:20'), now() { return this.t; } };
  const store = new MemoryStore();
  const notifier = new OutboxNotifier(() => {});
  const service = new KinwiseService({ store, notifier, clock });
  return { clock, store, notifier, service };
}

const visitor = (id: string, hhmm: string): VisitorEvent => ({
  eventId: id,
  deviceId: 'front-door',
  occurredAt: local(hhmm).toISOString(),
  source: 'demo',
  ringEventType: 'button_press',
  perception: { personPresent: true, peopleCount: 1, carrying: 'a small box', description: 'A person at the front door holding a small box' },
});

describe('the safety watch is the resident’s choice', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
  });

  it('S1.1: a flagged call only offers a watch; nothing is turned on or sent', async () => {
    const { service, store, notifier } = ctx;
    const v = await service.checkCall(asha, { description: CALL });

    expect(v.level).toBe('high'); // she still gets the advice at once
    expect(v.advice.length).toBeGreaterThan(0);
    expect(v.watch.state).toBe('offered');
    expect(v.watch.offer).toMatchObject({ hours: 6, notifies: 'Meera' });
    expect(v.riskWindow.level).toBe('none');
    expect(notifier.outbox).toEqual([]);
    expect((await store.load(HH))!.signals).toEqual([]);
  });

  it('S1.2: "Turn on" opens the six-hour watch and tells Meera once, even if pressed twice', async () => {
    const { service, notifier } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });

    const on = await service.respondToWatch(asha, watch.offer!.id, 'turn_on');
    expect(on.watch.state).toBe('on');
    expect(on.riskWindow.level).toBe('high');
    const again = await service.respondToWatch(asha, watch.offer!.id, 'turn_on');
    expect(again.watch.state).toBe('on');
    expect(notifier.outbox.map((n) => n.kind)).toEqual(['risk_high']);
  });

  it('S1.3: the TV can answer the same offer', async () => {
    const { service } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    expect((await service.tvState(tv)).watch).toMatchObject({ state: 'offered', offer: { id: watch.offer!.id } });
    await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    const after = await service.tvState(tv);
    expect(after.watch.state).toBe('on');
    expect(after.today.safety.level).toBe('high');
  });

  it('S2.1: "Not now" keeps the watch off, forgets the signs, and the next visitor is only a gentle note', async () => {
    const { service, clock, store, notifier } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    const no = await service.respondToWatch(asha, watch.offer!.id, 'not_now');

    expect(no.watch.state).toBe('declined');
    expect(no.riskWindow.level).toBe('none');
    const s = (await store.load(HH))!;
    expect(s.signals).toEqual([]);
    expect(s.watchOffer).toBeUndefined();
    expect(notifier.outbox).toEqual([]);

    clock.t = local('14:41');
    expect(await service.ingestVisitor(HH, visitor('v1', '14:41'))).toMatchObject({ decision: 'gentle' });
    expect(notifier.outbox).toEqual([]);
  });

  it('S2.2: after "Not now" she is not asked again straight away, but still gets the advice', async () => {
    const { service, clock } = ctx;
    const first = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, first.watch.offer!.id, 'not_now');

    clock.t = local('10:40');
    const second = await service.checkCall(asha, { description: CALL });
    expect(second.level).toBe('high');
    expect(second.watch.state).toBe('declined');
    expect(second.watch.offer).toBeUndefined();

    clock.t = local('11:30'); // an hour later she may be asked again
    const third = await service.checkCall(asha, { description: CALL });
    expect(third.watch.state).toBe('offered');
  });

  it('S2.3: "Not now" answered twice is harmless', async () => {
    const { service } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, watch.offer!.id, 'not_now');
    const again = await service.respondToWatch(asha, watch.offer!.id, 'not_now');
    expect(again.watch.state).toBe('declined');
  });

  it('S3.1: "Review privacy" explains the choice and changes nothing', async () => {
    const { service, store, notifier } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    const r = await service.respondToWatch(asha, watch.offer!.id, 'review_privacy');

    expect(r.watch.state).toBe('offered');
    expect(r.privacy!.join(' ')).toMatch(/never your words/i);
    expect(r.privacy!.join(' ')).toMatch(/Meera/);
    expect(r.riskWindow.level).toBe('none');
    expect(notifier.outbox).toEqual([]);
    expect((await store.load(HH))!.watchOffer?.id).toBe(watch.offer!.id);
  });

  it('S4.1: only the resident can answer; a caregiver or Alexa-as-service cannot start the watch for her', async () => {
    const { service, store } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await expect(service.respondToWatch(priya, watch.offer!.id, 'turn_on')).rejects.toBeInstanceOf(PermissionError);
    await expect(service.respondToWatch(service_, watch.offer!.id, 'turn_on')).rejects.toBeInstanceOf(PermissionError);
    expect((await store.load(HH))!.riskWindow).toBeUndefined();
  });

  it('S4.2: an unknown, wrong or expired offer is refused and opens nothing', async () => {
    const { service, clock, store } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await expect(service.respondToWatch(asha, 'offer_nope', 'turn_on')).rejects.toBeInstanceOf(ValidationError);
    await expect(service.respondToWatch(asha, watch.offer!.id, 'maybe' as never)).rejects.toBeInstanceOf(ValidationError);

    clock.t = local('11:00'); // the offer lasts 30 minutes
    await expect(service.respondToWatch(asha, watch.offer!.id, 'turn_on')).rejects.toBeInstanceOf(ValidationError);
    expect((await store.load(HH))!.riskWindow).toBeUndefined();
    expect((await service.getToday(asha)).safety.level).toBe('none');
  });

  it('S5.1: a reminder that matches the signs also only offers', async () => {
    const { service, notifier } = ctx;
    const r = await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    expect(r.watch.state).toBe('offered');
    expect(r.riskWindow.level).toBe('none');
    expect(notifier.outbox).toEqual([]);
    const on = await service.respondToWatch(asha, r.watch.offer!.id, 'turn_on');
    expect(on.riskWindow.level).toBe('elevated');
  });

  it('S5.2: a second check while an offer is open updates that offer, not a second one', async () => {
    const { service, clock } = ctx;
    const a = await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    clock.t = local('10:25');
    const b = await service.checkCall(asha, { description: CALL });
    expect(b.watch.offer!.id).toBe(a.watch.offer!.id);
    const on = await service.respondToWatch(asha, b.watch.offer!.id, 'turn_on');
    expect(on.riskWindow.level).toBe('high');
  });

  it('S5.3: while an authorised watch is on, a new warning extends it without another question', async () => {
    const { service, clock } = ctx;
    const a = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, a.watch.offer!.id, 'turn_on');
    clock.t = local('11:00');
    const b = await service.checkCall(asha, { description: CALL });
    expect(b.watch.state).toBe('on');
    expect(b.watch.offer).toBeUndefined();
  });

  it('S6.1: with scam screening off nothing is offered, kept or sent', async () => {
    const { service, store, notifier } = ctx;
    await service.updateConsent(asha, { scamScreening: false });
    const v = await service.checkCall(asha, { description: CALL });
    expect(v.watch.state).toBe('none');
    expect(v.watch.offer).toBeUndefined();
    expect((await store.load(HH))!.signals).toEqual([]);
    expect(notifier.outbox).toEqual([]);
  });

  it('S6.2: "Turn on" with family alerts off watches the door but sends nothing, and says so', async () => {
    const { service, notifier } = ctx;
    await service.updateConsent(asha, { caregiverAlerts: false });
    const { watch } = await service.checkCall(asha, { description: CALL });
    expect(watch.offer!.notifies).toBeUndefined();
    const on = await service.respondToWatch(asha, watch.offer!.id, 'turn_on');
    expect(on.riskWindow.level).toBe('high');
    expect(notifier.outbox).toEqual([]);
  });

  it('S6.3: turning screening off withdraws a pending offer and its signs', async () => {
    const { service, store } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.updateConsent(asha, { scamScreening: false });
    expect((await store.load(HH))!.watchOffer).toBeUndefined();
    await expect(service.respondToWatch(asha, watch.offer!.id, 'turn_on')).rejects.toBeInstanceOf(ValidationError);
  });

  it('S7.1: ending the watch stops the Pause for later visitors and tells nobody', async () => {
    const { service, clock, notifier } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, watch.offer!.id, 'turn_on');
    notifier.outbox.length = 0;

    await service.closeRiskWindow(tv, 'Resident ended the safety watch');
    clock.t = local('14:41');
    expect(await service.ingestVisitor(HH, visitor('v2', '14:41'))).toMatchObject({ decision: 'gentle' });
    expect(notifier.outbox).toEqual([]);
  });

  it('S8.1: the choice is logged as a fact, never with what she said', async () => {
    const { service, store } = ctx;
    const a = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, a.watch.offer!.id, 'turn_on');
    const s = (await store.load(HH))!;
    const text = JSON.stringify([s.timeline, s.accessLog, s.watchOffer ?? null, s.signals]);
    expect(text).toMatch(/turned on|safety watch/i);
    expect(text).not.toMatch(/FTC|gold|do not tell/i);
  });

  it('S8.2: the caregiver sees the watch only through the timeline she is allowed, never the offer', async () => {
    const { service } = ctx;
    await service.checkCall(asha, { description: CALL });
    const t = await service.getTimeline(priya);
    expect(JSON.stringify(t)).not.toMatch(/offer/i);
  });
});

describe('the safety-watch answer through the real MCP server and the TV route', () => {
  async function boot() {
    const fixed = new Date('2026-10-07T10:00:00-04:00');
    const { app, service } = await bootstrap(loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv), {
      clock: { now: () => fixed },
    });
    const connect = async (token: string) => {
      const transport = new StreamableHTTPClientTransport(new URL('http://kinwise.test/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: 'kinwise-test', version: '1.0.0' });
      await client.connect(transport);
      return client;
    };
    const tvPost = (path: string, body: unknown) =>
      app.fetch(new Request(`http://kinwise.test/tv${path}`, { method: 'POST', headers: { authorization: 'Bearer dev-tv', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { app, service, connect, tvPost };
  }

  it('S9.1: Alexa asks, Asha answers by voice; a caregiver cannot answer for her', async () => {
    const { connect, service } = await boot();
    const alexa = await connect('dev-asha');
    const checked = await alexa.callTool({ name: 'kinwise_check_call', arguments: { description: CALL } });
    expect((checked.content as Array<{ text: string }>)[0]!.text).toMatch(/safety watch.*tell Meera if it looks serious.*I won't do it unless you say so/s);
    const offer = (checked.structuredContent as { watch: { state: string; offer: { id: string } } }).watch;
    expect(offer.state).toBe('offered');

    const meera = await connect('dev-priya');
    const refused = await meera.callTool({ name: 'kinwise_set_safety_watch', arguments: { choice: 'turn_on' } }).catch((e) => ({ isError: true, e }));
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect((await service.getToday(asha)).safety.level).toBe('none');

    const answered = await alexa.callTool({ name: 'kinwise_set_safety_watch', arguments: { choice: 'turn_on' } }); // no id: the one open question
    expect(answered.isError).toBeFalsy();
    expect((answered.structuredContent as { riskWindow: { level: string } }).riskWindow.level).toBe('high');
  });

  it('S9.2: the TV route answers the same question and the TV state matches the server', async () => {
    const { connect, tvPost, service } = await boot();
    await (await connect('dev-asha')).callTool({ name: 'kinwise_check_call', arguments: { description: CALL } });
    expect((await tvPost('/watch', { choice: 'not_now' })).status).toBe(200);
    expect((await service.tvState(tv)).watch.state).toBe('declined');
    expect((await tvPost('/watch', { choice: 'bogus' })).status).toBe(400);
    expect((await tvPost('/watch', {})).status).toBe(400);
  });
});
