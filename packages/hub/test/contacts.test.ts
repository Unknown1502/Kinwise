import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth/identity.js';
import { PermissionError } from '../src/auth/identity.js';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { KinwiseService, ValidationError, type ContactSync } from '../src/services/kinwise.js';
import { MultiNotifier, OutboxNotifier, SmsNotifier, SnsContactSync, WhatsAppNotifier, type CaregiverNotice } from '../src/services/notifier.js';
import { MemoryStore } from '../src/store/memory.js';

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };
const meera: Identity = { userId: 'priya', householdId: HH, role: 'caregiver', name: 'Meera', scopes: [] };
const ravi: Identity = { userId: 'ravi', householdId: HH, role: 'caregiver', name: 'Ravi', scopes: [] };
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };

const notice = (over: Partial<CaregiverNotice> = {}): CaregiverNotice => ({
  householdId: HH,
  caregiverId: 'priya',
  caregiverName: 'Meera',
  kind: 'call_request',
  title: 'Asha wants to talk to you now',
  body: 'Asha chose "Call Meera" on the TV during a Kinwise Pause. Please call now.',
  at: '2026-10-14T10:00:00.000Z',
  callId: 'call_1',
  ...over,
});

class FakeSync implements ContactSync {
  readonly calls: Array<{ memberId: string; oldEmail?: string; newEmail?: string }> = [];
  fail = false;
  async syncEmail(_householdId: string, memberId: string, oldEmail: string | undefined, newEmail: string | undefined) {
    if (this.fail) throw new Error('sns down');
    this.calls.push({ memberId, oldEmail, newEmail });
  }
}

function setup() {
  const clock = { t: new Date('2026-10-14T10:00:00Z'), now() { return this.t; } };
  const sync = new FakeSync();
  const service = new KinwiseService({ store: new MemoryStore(), notifier: new OutboxNotifier(() => {}), clock, contactSync: sync });
  return { clock, sync, service };
}

async function withSecondCaregiver(ctx: ReturnType<typeof setup>) {
  const state = demoHousehold(ctx.clock.now());
  state.household.members.push({ id: 'ravi', name: 'Ravi', role: 'caregiver', relationship: 'son' });
  await ctx.service.createHousehold(state);
}

describe('each caregiver keeps their own contacts', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await withSecondCaregiver(ctx);
  });

  it('stores them per caregiver, and one caregiver cannot read or change the other\'s', async () => {
    await ctx.service.setContacts(meera, { email: 'meera@example.com', sms: '+919876543210' });
    await ctx.service.setContacts(ravi, { email: 'ravi@example.com' });
    expect(await ctx.service.getContacts(meera)).toMatchObject({ email: 'meera@example.com', sms: '+919876543210' });
    expect(await ctx.service.getContacts(ravi)).toEqual({ email: 'ravi@example.com' });
    expect((await ctx.service.contactsFor(HH, 'priya'))?.sms).toBe('+919876543210');
    expect((await ctx.service.contactsFor(HH, 'ravi'))?.sms).toBeUndefined();
  });

  it('is for the caregiver only; the resident and the TV can neither read nor set them, and the TV state never carries them', async () => {
    await ctx.service.setContacts(meera, { email: 'meera@example.com', sms: '+919876543210' });
    for (const who of [asha, tv]) {
      await expect(ctx.service.setContacts(who, { email: 'x@example.com' })).rejects.toBeInstanceOf(PermissionError);
      await expect(ctx.service.getContacts(who)).rejects.toBeInstanceOf(PermissionError);
    }
    const shown = JSON.stringify(await ctx.service.tvState(tv));
    expect(shown).not.toContain('meera@example.com');
    expect(shown).not.toContain('919876543210');
  });

  it('checks what it is given', async () => {
    for (const bad of [{ email: 'not-an-email' }, { email: 'a@b' }, { email: 'x'.repeat(200) + '@example.com' }, { sms: '9876543210' }, { sms: '+0123456' }, { sms: '+1' }, { whatsapp: 'whatsapp:+919876543210' }, { sms: '+91 98765 43210' }]) {
      await expect(ctx.service.setContacts(meera, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await ctx.service.getContacts(meera)).toEqual({});
  });

  it('can clear a contact, and changes at most once a minute', async () => {
    await ctx.service.setContacts(meera, { sms: '+919876543210' });
    await expect(ctx.service.setContacts(meera, { sms: null })).rejects.toThrow(/wait a minute/i);
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 61_000);
    await ctx.service.setContacts(meera, { sms: null });
    expect(await ctx.service.getContacts(meera)).toEqual({});
  });

  it('subscribes a new e-mail to that caregiver\'s own notices, and swaps the old one out', async () => {
    const first = await ctx.service.setContacts(meera, { email: 'a@example.com' });
    expect(first.email).toBe('confirmation_sent');
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 61_000);
    await ctx.service.setContacts(meera, { email: 'b@example.com' });
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 61_000);
    await ctx.service.setContacts(meera, { sms: '+919876543210' }); // not an e-mail change: no sync
    expect(ctx.sync.calls).toEqual([
      { memberId: 'priya', oldEmail: undefined, newEmail: 'a@example.com' },
      { memberId: 'priya', oldEmail: 'a@example.com', newEmail: 'b@example.com' },
    ]);
  });

  it('says so when the e-mail could not be set up, and still keeps the other contacts', async () => {
    ctx.sync.fail = true;
    const orig = console.error;
    console.error = () => {};
    const out = await ctx.service.setContacts(meera, { email: 'a@example.com', sms: '+919876543210' });
    console.error = orig;
    expect(out.email).toBe('failed');
    expect((await ctx.service.getContacts(meera)).sms).toBe('+919876543210');
    expect((await ctx.service.getContacts(meera)).email).toBeUndefined(); // not kept: nothing is subscribed to it
  });
});

describe('notices reach each caregiver on their own channels', () => {
  const twilio = { accountSid: 'AC' + 'a1'.repeat(16), authToken: 'tok', from: 'whatsapp:+14155238886', to: 'whatsapp:+910000000000' };

  it('SMS goes to the number of the caregiver the notice is for, with the confirm link, and says no when they have none', async () => {
    const ctx = setup();
    await withSecondCaregiver(ctx);
    await ctx.service.setContacts(meera, { sms: '+919876543210' });
    const sent: Array<Record<string, any>> = [];
    const client = { send: async (cmd: { input: Record<string, any> }) => void sent.push(cmd.input) } as any;
    const sms = new SmsNotifier({ lookup: (h, c) => ctx.service.contactsFor(h, c), ackUrl: (n) => `https://hub.example/ack/${n.callId}`, client });
    expect(await sms.notify(notice())).toBe(true);
    expect(sent[0]).toMatchObject({ PhoneNumber: '+919876543210' });
    expect(sent[0]!.Message).toContain('Asha wants to talk to you now');
    expect(sent[0]!.Message).toContain('https://hub.example/ack/call_1');
    expect(sent[0]!.MessageAttributes['AWS.SNS.SMS.SMSType'].StringValue).toBe('Transactional');
    expect(await sms.notify(notice({ caregiverId: 'ravi', caregiverName: 'Ravi' }))).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('an SMS carries only the signal, and an SMS service that refuses is a failure, not a crash', async () => {
    const orig = console.error;
    console.error = () => {};
    const client = { send: async () => { throw new Error('Phone number is opted out'); } } as any;
    const sms = new SmsNotifier({ lookup: async () => ({ sms: '+919876543210' }), ackUrl: () => undefined, client });
    expect(await sms.notify(notice({ kind: 'pause', callId: undefined }))).toBe(false);
    console.error = orig;
  });

  it('WhatsApp uses the caregiver\'s own number, and the shared one only when they have none', async () => {
    const calls: URLSearchParams[] = [];
    const fetch = (async (_u: string, init: { body: string }) => {
      calls.push(new URLSearchParams(init.body));
      return new Response('{}', { status: 201 });
    }) as unknown as typeof globalThis.fetch;
    const wa = new WhatsAppNotifier({ ...twilio, ackUrl: () => undefined, fetch, lookup: async (_h, c) => (c === 'priya' ? { whatsapp: '+919876543210' } : undefined) });
    await wa.notify(notice());
    await wa.notify(notice({ caregiverId: 'ravi' }));
    expect(calls.map((c) => c.get('To'))).toEqual(['whatsapp:+919876543210', 'whatsapp:+910000000000']);
  });

  it('with two caregivers, one Call Meera reaches both on their own channels, and either one confirming is enough', async () => {
    const ctx = setup();
    await withSecondCaregiver(ctx);
    await ctx.service.setContacts(meera, { sms: '+919876543210' });
    await ctx.service.setContacts(ravi, { sms: '+919811122233' });
    const texts: Array<{ to: string }> = [];
    const client = { send: async (cmd: { input: Record<string, any> }) => void texts.push({ to: cmd.input.PhoneNumber }) } as any;
    // The service under test needs a notifier that knows its own lookup: build a second service over the same store.
    const store = (ctx.service as any).store as MemoryStore;
    const sms = new SmsNotifier({ lookup: (h, c) => svc.contactsFor(h, c), ackUrl: () => undefined, client });
    const svc: KinwiseService = new KinwiseService({ store, notifier: new MultiNotifier([sms]), clock: ctx.clock });
    const { alertId } = await svc.ingestVisitor(HH, {
      eventId: 'e1', deviceId: 'd', occurredAt: ctx.clock.now().toISOString(), source: 'demo', unscheduled: true, ringEventType: 'button_press',
      perception: { personPresent: true, peopleCount: 1, description: 'a person' },
    } as any);
    const res = await svc.respondToAlert(tv, alertId!, 'call_family');
    expect(res.delivered).toBe(true);
    expect(texts.map((t) => t.to).sort()).toEqual(['+919811122233', '+919876543210']);
    const callId = (await svc.recentNotices(HH)).find((n) => n.callId)!.callId!;
    await svc.acknowledgeCall(ravi, callId);
    expect((await svc.tvState(tv)).call?.status).toBe('confirmed');
    expect((await svc.tvState(tv)).today.messages.find((m) => m.text.includes('calling you now'))?.from).toBe('Meera'); // the primary caregiver's name, as before
  });

  it('SMS as the only real channel and nobody with a number is "not delivered", so the TV says so', async () => {
    const ctx = setup();
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
    const store = (ctx.service as any).store as MemoryStore;
    const client = { send: async () => {} } as any;
    const svc: KinwiseService = new KinwiseService({
      store,
      notifier: new MultiNotifier([new OutboxNotifier(() => {}), new SmsNotifier({ lookup: (h, c) => svc.contactsFor(h, c), ackUrl: () => undefined, client })]),
      clock: ctx.clock,
    });
    const { alertId } = await svc.ingestVisitor(HH, {
      eventId: 'e2', deviceId: 'd', occurredAt: ctx.clock.now().toISOString(), source: 'demo', unscheduled: true, ringEventType: 'button_press',
      perception: { personPresent: true, peopleCount: 1, description: 'a person' },
    } as any);
    expect((await svc.respondToAlert(tv, alertId!, 'call_family')).delivered).toBe(false);
  });
});

describe('SnsContactSync: e-mail routed by a filter policy', () => {
  it('subscribes with a policy on the caregiver id, after removing the old confirmed subscription', async () => {
    const sent: Array<{ name: string; input: Record<string, any> }> = [];
    const client = {
      send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        if (cmd.constructor.name === 'ListSubscriptionsByTopicCommand') {
          return {
            Subscriptions: [
              { Protocol: 'email', Endpoint: 'old@example.com', SubscriptionArn: 'arn:aws:sns:us-east-1:1:t:abc' },
              { Protocol: 'email', Endpoint: 'old@example.com', SubscriptionArn: 'PendingConfirmation' },
              { Protocol: 'email', Endpoint: 'other@example.com', SubscriptionArn: 'arn:aws:sns:us-east-1:1:t:def' },
            ],
          };
        }
        return {};
      },
    } as any;
    await new SnsContactSync('arn:aws:sns:us-east-1:1:t', client).syncEmail(HH, 'priya', 'old@example.com', 'new@example.com');
    expect(sent.filter((s) => s.name === 'UnsubscribeCommand').map((s) => s.input.SubscriptionArn)).toEqual(['arn:aws:sns:us-east-1:1:t:abc']);
    const sub = sent.find((s) => s.name === 'SubscribeCommand')!.input;
    expect(sub).toMatchObject({ Protocol: 'email', Endpoint: 'new@example.com', TopicArn: 'arn:aws:sns:us-east-1:1:t' });
    expect(JSON.parse(sub.Attributes.FilterPolicy)).toEqual({ caregiverId: ['priya'] });
  });

  it('only removes when there is nothing new, and only subscribes when there is nothing old', async () => {
    const sent: string[] = [];
    const client = { send: async (cmd: { constructor: { name: string } }) => { sent.push(cmd.constructor.name); return { Subscriptions: [] }; } } as any;
    const sync = new SnsContactSync('arn:aws:sns:us-east-1:1:t', client);
    await sync.syncEmail(HH, 'priya', undefined, 'new@example.com');
    expect(sent).toEqual(['SubscribeCommand']);
    sent.length = 0;
    await sync.syncEmail(HH, 'priya', 'old@example.com', undefined);
    expect(sent).toEqual(['ListSubscriptionsByTopicCommand']);
  });
});

describe('over HTTP', () => {
  async function app() {
    const config = loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv);
    const { app: hono } = await bootstrap(config);
    return (path: string, init: RequestInit = {}, token?: string) =>
      hono.fetch(new Request(`https://hub.example${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }));
  }

  it('lets the caregiver read and set her own contacts, and nobody else', async () => {
    const call = await app();
    expect((await call('/caregiver/contacts')).status).toBe(401);
    expect((await call('/caregiver/contacts', {}, 'dev-asha')).status).toBe(403);
    expect((await call('/caregiver/contacts', { method: 'PUT', body: JSON.stringify({ sms: '+919876543210' }) }, 'dev-tv')).status).toBe(403);
    const put = await call('/caregiver/contacts', { method: 'PUT', body: JSON.stringify({ sms: '+919876543210' }) }, 'dev-priya');
    expect(put.status).toBe(200);
    expect(await (await call('/caregiver/contacts', {}, 'dev-priya')).json()).toMatchObject({ contacts: { sms: '+919876543210' } });
    expect((await call('/caregiver/contacts', { method: 'PUT', body: JSON.stringify({ sms: 'nope' }) }, 'dev-priya')).status).toBe(400);
    expect((await call('/caregiver/contacts', { method: 'PUT', body: 'not json' }, 'dev-priya')).status).toBe(400);
  });
});
