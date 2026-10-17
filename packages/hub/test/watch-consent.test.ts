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

    const on = await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    expect(on.watch.state).toBe('on');
    expect(on.riskWindow.level).toBe('high');
    const again = await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
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

  it('S2.4: after "Not now" exactly three content-free facts remain, and the family cannot see the decline', async () => {
    const { service, store } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, watch.offer!.id, 'not_now');
    const s = (await store.load(HH))!;

    // what is kept: a timeline line, the no-ask-until time, and the last answer's id and choice
    expect(s.timeline.filter((e) => e.kind === 'watch_declined').map((e) => e.text)).toEqual(['Asha chose not to turn on a safety watch.']);
    expect(s.watchDeclinedUntil).toBeDefined();
    expect(s.lastWatchAnswer).toMatchObject({ offerId: watch.offer!.id, choice: 'not_now' });
    // what is not: any sign, category or word from the call
    expect(s.signals).toEqual([]);
    expect(s.watchOffer).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/authority|urgency|secrecy|unusual_payment|courier_pickup|remote_access|FTC|gold/i);
    // she can read it; Meera cannot
    expect((await service.getTimeline(asha)).entries.map((e) => e.kind)).toContain('watch_declined');
    expect((await service.getTimeline(priya)).entries.map((e) => e.kind)).not.toContain('watch_declined');
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
    expect(r.privacy!.join(' ')).toMatch(/not now.*keeps only a note, visible to you alone/i);
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
    await expect(service.respondToWatch(tv, 'offer_nope', 'turn_on')).rejects.toBeInstanceOf(ValidationError);
    await expect(service.respondToWatch(asha, watch.offer!.id, 'maybe' as never)).rejects.toBeInstanceOf(ValidationError);

    clock.t = local('11:00'); // the offer lasts 30 minutes
    await expect(service.respondToWatch(tv, watch.offer!.id, 'turn_on')).rejects.toBeInstanceOf(ValidationError);
    expect((await store.load(HH))!.riskWindow).toBeUndefined();
    expect((await service.getToday(asha)).safety.level).toBe('none');
  });

  it('S5.1: a reminder that matches the signs also only offers', async () => {
    const { service, notifier } = ctx;
    const r = await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    expect(r.watch.state).toBe('offered');
    expect(r.riskWindow.level).toBe('none');
    expect(notifier.outbox).toEqual([]);
    const on = await service.respondToWatch(tv, r.watch.offer!.id, 'turn_on');
    expect(on.riskWindow.level).toBe('elevated');
  });

  it('S5.2: a second check while an offer is open updates that offer, not a second one', async () => {
    const { service, clock } = ctx;
    const a = await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    clock.t = local('10:25');
    const b = await service.checkCall(asha, { description: CALL });
    expect(b.watch.offer!.id).toBe(a.watch.offer!.id);
    const on = await service.respondToWatch(tv, b.watch.offer!.id, 'turn_on');
    expect(on.riskWindow.level).toBe('high');
  });

  it('S5.3: while an authorised watch is on, a new warning extends it without another question', async () => {
    const { service, clock } = ctx;
    const a = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(tv, a.watch.offer!.id, 'turn_on');
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
    const on = await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    expect(on.riskWindow.level).toBe('high');
    expect(notifier.outbox).toEqual([]);
  });

  it('S6.3: turning screening off withdraws a pending offer and its signs', async () => {
    const { service, store } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.updateConsent(asha, { scamScreening: false });
    expect((await store.load(HH))!.watchOffer).toBeUndefined();
    await expect(service.respondToWatch(tv, watch.offer!.id, 'turn_on')).rejects.toBeInstanceOf(ValidationError);
  });

  it('S7.1: ending the watch stops the Pause for later visitors and tells nobody', async () => {
    const { service, clock, notifier } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    notifier.outbox.length = 0;

    await service.closeRiskWindow(tv, 'Resident ended the safety watch');
    clock.t = local('14:41');
    expect(await service.ingestVisitor(HH, visitor('v2', '14:41'))).toMatchObject({ decision: 'gentle' });
    expect(notifier.outbox).toEqual([]);
  });

  it('S8.1: the choice is logged as a fact, never with what she said', async () => {
    const { service, store } = ctx;
    const a = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(tv, a.watch.offer!.id, 'turn_on');
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
    expect((checked.content as Array<{ text: string }>)[0]!.text).toMatch(/safety watch.*send Meera a short message right away.*press Turn on on your TV.*I won't do it unless you choose it there/s);
    const offer = (checked.structuredContent as { watch: { state: string; offer: { id: string } } }).watch;
    expect(offer.state).toBe('offered');

    const meera = await connect('dev-priya');
    const refused = await meera.callTool({ name: 'kinwise_set_safety_watch', arguments: { choice: 'turn_on' } }).catch((e) => ({ isError: true, e }));
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect((await service.getToday(asha)).safety.level).toBe('none');

    const answered = await alexa.callTool({ name: 'kinwise_set_safety_watch', arguments: { choice: 'turn_on' } }); // a voice cannot be verified as hers
    expect(answered.isError).toBeFalsy();
    expect((answered.structuredContent as { riskWindow: { level: string }; needsTv?: boolean }).needsTv).toBe(true);
    expect((answered.structuredContent as { riskWindow: { level: string } }).riskWindow.level).toBe('none');
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

// ─── findings from the independent audit aud_0Y5lTT4wcH, 2026-10-17 ───

describe('audit follow-ups: retries, legacy state, expiry, revocation', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
  });

  it('A1: a retried answer WITHOUT an offer id does the same thing once, and does not error', async () => {
    const { service, notifier } = ctx;
    await service.checkCall(asha, { description: CALL });
    const first = await service.respondToWatch(tv, undefined, 'turn_on');
    const again = await service.respondToWatch(tv, undefined, 'turn_on');
    expect(first.watch.state).toBe('on');
    expect(again.watch.state).toBe('on');
    expect(again.message).toMatch(/already on/i);
    expect(notifier.outbox.map((n) => n.kind)).toEqual(['risk_high']);

    const other = setup();
    await other.service.createHousehold(demoHousehold(other.clock.now()));
    await other.service.checkCall(asha, { description: CALL });
    await other.service.respondToWatch(asha, undefined, 'not_now');
    expect((await other.service.respondToWatch(asha, undefined, 'not_now')).watch.state).toBe('declined');
  });

  it('A2: a replayed "turn on" never claims the watch is on once it has ended', async () => {
    const { service } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    await service.closeRiskWindow(asha, 'Resident ended the safety watch');
    const again = await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    expect(again.watch.state).not.toBe('on');
    expect(again.message).not.toMatch(/already on/i);
    expect(again.message).toMatch(/ended/i);
  });

  it('A3: a different answer to an answered question is still refused (turn_on after not_now)', async () => {
    const { service } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, watch.offer!.id, 'not_now');
    await expect(service.respondToWatch(tv, watch.offer!.id, 'turn_on')).rejects.toBeInstanceOf(ValidationError);
    await expect(service.respondToWatch(tv, undefined, 'turn_on')).rejects.toBeInstanceOf(ValidationError);
  });

  it('B1: an offer nobody answered is deleted from state once it has run out, not just hidden', async () => {
    const { service, clock, store } = ctx;
    await service.checkCall(asha, { description: CALL });
    expect((await store.load(HH))!.watchOffer).toBeDefined();
    clock.t = local('11:00'); // 40 minutes later: the question ran out
    await service.addReminder(asha, { text: 'Call the pharmacy', at: local('15:00').toISOString() }); // any later write
    const s = (await store.load(HH))!;
    expect(s.watchOffer).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/courier_pickup|unusual_payment|secrecy/);
  });

  it('B2: an offer holds at most ten signs', async () => {
    const { service, store } = ctx;
    for (let i = 0; i < 14; i++) await service.checkCall(asha, { description: CALL });
    expect((await store.load(HH))!.watchOffer!.signals.length).toBeLessThanOrEqual(10);
  });

  it('C1: a watch that an older version opened by itself is not honoured: no Pause, no extension, no family signal', async () => {
    const { service, clock, store, notifier } = ctx;
    const s = (await store.load(HH))!;
    s.riskWindow = { id: 'win_legacy', openedAt: local('10:00').toISOString(), expiresAt: local('16:00').toISOString(), level: 'high', categories: ['authority', 'urgency', 'courier_pickup'] };
    await store.save(s, s.version);

    expect((await service.tvState(tv)).today.safety.level).toBe('none');
    expect((await service.tvState(tv)).watch.state).not.toBe('on');
    clock.t = local('14:41');
    expect(await service.ingestVisitor(HH, visitor('legacy', '14:41'))).toMatchObject({ decision: 'gentle' });
    const v = await service.checkCall(asha, { description: CALL });
    expect(v.watch.state).toBe('offered'); // it must ask now
    expect(notifier.outbox).toEqual([]);
  });

  it('C2: old timeline lines that said "Pause was shown" at send time are not counted as confirmed on the TV', async () => {
    const { service, store } = ctx;
    const s = (await store.load(HH))!;
    s.timeline.unshift({ at: local('09:00').toISOString(), kind: 'pause_shown', text: "The Pause was shown on Asha's TV." });
    await store.save(s, s.version);
    const t = await service.getTimeline(asha, '2026-10-08');
    expect(t.summary).toMatchObject({ pausesShown: 0, pausesSent: 1 });
  });

  it('D1: switching scam screening off ends a running watch and sends nothing', async () => {
    const { service, notifier } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    notifier.outbox.length = 0;
    await service.updateConsent(asha, { scamScreening: false });
    expect((await service.tvState(tv)).today.safety.level).toBe('none');
    expect((await service.tvState(tv)).watch.state).not.toBe('on');
    expect(notifier.outbox).toEqual([]);
  });

  it('E1: a single weak sign (one category) neither stores anything nor starts a question', async () => {
    const { service, store } = ctx;
    const v = await service.checkCall(asha, { description: 'My account was hacked last year' });
    expect(v.level).toBe('none');
    expect(v.watch.state).toBe('none');
    expect((await store.load(HH))!.watchOffer).toBeUndefined();
  });

  it('F1: Alexa always says the question aloud when one is open, even for a reminder', async () => {
    const { connect } = await bootForTexts();
    const alexa = await connect('dev-asha');
    const r = await alexa.callTool({ name: 'kinwise_add_reminder', arguments: { text: 'Courier from the bank picking up a package', at: '2026-10-07T14:00:00-04:00' } });
    expect((r.content as Array<{ text: string }>)[0]!.text).toMatch(/safety watch.*press Turn on on your TV.*I won't do it unless you choose it there/s);
  });

  it('G1: nothing about a decline reaches the family through any family-facing view', async () => {
    const { service } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, watch.offer!.id, 'not_now');
    const family = JSON.stringify([await service.getToday(priya), await service.explainLastAlert(priya), await service.getTimeline(priya)]);
    expect(family).not.toMatch(/declin|chose not|not now/i);
  });

  it('H1: the words she hears after "Not now" match what Kinwise does (it will not ask for an hour)', async () => {
    const { service } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    const r = await service.respondToWatch(asha, watch.offer!.id, 'not_now');
    expect(r.message).toMatch(/won't ask again for an hour/i);
  });
});

// ─── findings from the second independent audit aud_6tkf0asOM7, 2026-10-17 ───

describe('audit round 2: retention, durable cleanup, honest words', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
  });

  it('R1: a pending offer lives at most 30 minutes from when it was created, however many signs join it', async () => {
    const { service, clock, store } = ctx;
    const first = await service.checkCall(asha, { description: CALL }); // 10:20
    const created = first.watch.offer!.expiresAt;
    clock.t = local('10:45');
    const joined = await service.checkCall(asha, { description: CALL });
    expect(joined.watch.offer!.id).toBe(first.watch.offer!.id);
    expect(joined.watch.offer!.expiresAt).toBe(created); // the deadline did not move

    clock.t = local('10:55'); // 35 minutes after the first sign: the old offer has run out
    const next = await service.checkCall(asha, { description: CALL });
    expect(next.watch.offer!.id).not.toBe(first.watch.offer!.id);
    const o = (await store.load(HH))!.watchOffer!;
    expect(o.signals.map((x) => x.at)).toEqual([local('10:55').toISOString()]); // none of the 10:20 or 10:45 labels survive
  });

  it('R2: an offer holds at most ten category LABELS, not ten records', async () => {
    const { service, store } = ctx;
    for (let i = 0; i < 6; i++) await service.checkCall(asha, { description: CALL }); // five categories each
    const labels = (await store.load(HH))!.watchOffer!.signals.flatMap((x) => x.categories);
    expect(labels.length).toBeLessThanOrEqual(10);
    expect(labels.length).toBeGreaterThan(0);
  });

  it('R3: cleanup is durable on a plain read: an expired offer, a legacy window and an old "shown" line are gone from the stored document', async () => {
    const { service, clock, store } = ctx;
    await service.checkCall(asha, { description: CALL });
    const s = (await store.load(HH))!;
    s.riskWindow = { id: 'win_legacy', openedAt: local('10:00').toISOString(), expiresAt: local('16:00').toISOString(), level: 'high', categories: ['authority', 'urgency'] };
    s.timeline.unshift({ at: local('09:00').toISOString(), kind: 'pause_shown', text: "The Pause was shown on Asha's TV." });
    await store.save(s, s.version);

    clock.t = local('11:00'); // the offer has run out; nobody writes anything
    await service.tvState(tv); // a read-only poll, like the TV does every two seconds
    const raw = (await store.load(HH))!;
    expect(raw.watchOffer).toBeUndefined();
    expect(raw.riskWindow?.closedAt).toBeDefined();
    expect(raw.timeline.some((e) => e.kind === 'pause_shown')).toBe(false);
    const v = raw.version;
    await service.tvState(tv);
    expect((await store.load(HH))!.version).toBe(v); // and polling does not keep writing
  });

  it('R4: "review privacy" works whenever she asks, even with no question open, and changes nothing', async () => {
    const { service, store } = ctx;
    const before = (await store.load(HH))!.version;
    const r = await service.respondToWatch(asha, undefined, 'review_privacy');
    expect(r.privacy!.join(' ')).toMatch(/never your words/i);
    expect(r.watch.state).toBe('none');
    expect((await store.load(HH))!.version).toBe(before);
  });

  it('R5: closing a legacy watch, or turning screening off, also deletes the signs it was built from', async () => {
    const { service, store } = ctx;
    const s = (await store.load(HH))!;
    s.signals = [{ at: local('10:00').toISOString(), source: 'check', categories: ['authority', 'urgency', 'courier_pickup'], level: 'high' }];
    s.riskWindow = { id: 'win_legacy', openedAt: local('10:00').toISOString(), expiresAt: local('16:00').toISOString(), level: 'high', categories: ['authority'] };
    await store.save(s, s.version);
    await service.tvState(tv);
    expect((await store.load(HH))!.signals).toEqual([]);

    const a = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(tv, a.watch.offer!.id, 'turn_on');
    expect((await store.load(HH))!.signals.length).toBeGreaterThan(0);
    await service.updateConsent(asha, { scamScreening: false });
    expect((await store.load(HH))!.signals).toEqual([]);
  });

  it('R6: a household from before this change is migrated once: stored signs from the automatic era are dropped', async () => {
    const { service, store } = ctx;
    const s = (await store.load(HH))!;
    delete (s as { consentModel?: number }).consentModel;
    s.signals = [{ at: local('10:00').toISOString(), source: 'reminder', categories: ['courier_pickup', 'authority'], level: 'elevated' }];
    await store.save(s, s.version);
    await service.getToday(asha);
    const raw = (await store.load(HH))!;
    expect(raw.signals).toEqual([]);
    expect(raw.consentModel).toBe(2);
  });

  it('R7: if the offered signs can no longer open a watch, "turn on" says so and records nothing', async () => {
    const { service, store, notifier } = ctx;
    const a = await service.checkCall(asha, { description: CALL });
    const s = (await store.load(HH))!;
    s.watchOffer!.signals = s.watchOffer!.signals.map((x) => ({ ...x, at: new Date(local('10:20').getTime() - 3 * 86_400_000).toISOString() })); // far outside the 24 h window
    await store.save(s, s.version);
    const r = await service.respondToWatch(tv, a.watch.offer!.id, 'turn_on');
    expect(r.message).toMatch(/could not start/i);
    const raw = (await store.load(HH))!;
    expect(raw.signals).toEqual([]);
    expect(raw.timeline.some((e) => e.kind === 'watch_on' || e.kind === 'call_checked')).toBe(false);
    expect(notifier.outbox).toEqual([]);
  });

  it('R8: a spoken "turn it on" after the TV already turned it on says it is on, and points to Settings, not just "the TV"', async () => {
    const { service } = ctx;
    const { watch } = await service.checkCall(asha, { description: CALL });
    const voice = await service.respondToWatch(asha, watch.offer!.id, 'turn_on');
    expect(voice.message).toMatch(/Settings/i);
    await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    const again = await service.respondToWatch(asha, undefined, 'turn_on');
    expect(again.message).toMatch(/already on/i);
    expect(again.needsTv).toBeUndefined();
  });

  it('R9: with door awareness off nothing is offered (a watch that cannot see the door would only mislead)', async () => {
    const { service, store } = ctx;
    await service.updateConsent(asha, { doorAwareness: false });
    const v = await service.checkCall(asha, { description: CALL });
    expect(v.watch.state).toBe('none');
    expect((await store.load(HH))!.watchOffer).toBeUndefined();
  });

  it('R10: closing a legacy watch leaves a resident-visible line', async () => {
    const { service, store } = ctx;
    const s = (await store.load(HH))!;
    s.riskWindow = { id: 'win_legacy', openedAt: local('10:00').toISOString(), expiresAt: local('16:00').toISOString(), level: 'high', categories: ['authority'] };
    await store.save(s, s.version);
    await service.tvState(tv);
    const t = await service.getTimeline(asha, '2026-10-08');
    expect(t.entries.map((e) => e.text).join(' ')).toMatch(/started before Kinwise asked first/i);
  });

  it('R11: what she is told when she agrees matches what happens: at high level Meera is messaged NOW, at elevated level only if it gets serious', async () => {
    const high = ctx;
    const q = await high.service.checkCall(asha, { description: CALL });
    expect(q.watch.offer).toMatchObject({ notifies: 'Meera', tellsNow: true });
    const on = await high.service.respondToWatch(tv, q.watch.offer!.id, 'turn_on');
    expect(on.message).toMatch(/I've told Meera/);

    const low = setup();
    await low.service.createHousehold(demoHousehold(low.clock.now()));
    const r = await low.service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    expect(r.watch.offer).toMatchObject({ notifies: 'Meera', tellsNow: false });
    const on2 = await low.service.respondToWatch(tv, r.watch.offer!.id, 'turn_on');
    expect(on2.message).toMatch(/if it looks serious/);
    expect(low.notifier.outbox).toEqual([]);
  });

  it('R12: the words about "shown" claim only what the TV app reports', async () => {
    const { service, clock, store } = ctx;
    const a = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(tv, a.watch.offer!.id, 'turn_on');
    clock.t = local('14:41');
    const alertId = (await service.ingestVisitor(HH, visitor('r12', '14:41'))).alertId!;
    await service.markAlertShown(tv, alertId);
    const raw = (await store.load(HH))!;
    expect(raw.timeline.find((e) => e.kind === 'pause_shown')!.text).toMatch(/TV app reported/);
    expect((await service.explainLastAlert(priya)).summary).toMatch(/TV app reported that the Pause was on screen/);
  });

  it('R13: the "what the privacy review says" claims are all true (end the watch on the TV; privacy time only quiets the Pause; backups)', async () => {
    const { service } = ctx;
    const r = await service.respondToWatch(asha, undefined, 'review_privacy');
    const text = r.privacy!.join(' ');
    expect(text).toMatch(/end the watch on your TV/i);
    expect(text).not.toMatch(/by asking me/i);
    expect(text).toMatch(/privacy time/i);
    expect(text).toMatch(/backups?/i);
  });
});

describe('audit round 2: the TV credential', () => {
  it('R14: the TV token cannot call MCP tools (it only works on the /tv routes)', async () => {
    const fixed = new Date('2026-10-07T10:00:00-04:00');
    const { app } = await bootstrap(loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv), { clock: { now: () => fixed } });
    const transport = new StreamableHTTPClientTransport(new URL('http://kinwise.test/mcp'), {
      fetch: async (url, init) => app.fetch(new Request(url, init)),
      requestInit: { headers: { authorization: 'Bearer dev-tv' } },
    });
    const client = new Client({ name: 'kinwise-test', version: '1.0.0' });
    const outcome = await client
      .connect(transport)
      .then(() => client.callTool({ name: 'kinwise_set_safety_watch', arguments: { choice: 'not_now' } }))
      .then((r) => ({ ok: !(r as { isError?: boolean }).isError }))
      .catch(() => ({ ok: false }));
    expect(outcome.ok).toBe(false);
  });
});

async function bootForTexts() {
  const fixed = new Date('2026-10-07T10:00:00-04:00');
  const { app } = await bootstrap(loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv), { clock: { now: () => fixed } });
  const connect = async (token: string) => {
    const transport = new StreamableHTTPClientTransport(new URL('http://kinwise.test/mcp'), {
      fetch: async (url, init) => app.fetch(new Request(url, init)),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'kinwise-test', version: '1.0.0' });
    await client.connect(transport);
    return client;
  };
  return { connect };
}
