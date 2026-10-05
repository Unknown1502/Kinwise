import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth/identity.js';
import { PermissionError } from '../src/auth/identity.js';
import type { VisitorEvent } from '../src/domain/types.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { KinwiseService, ValidationError } from '../src/services/kinwise.js';
import { OutboxNotifier } from '../src/services/notifier.js';
import { MemoryStore } from '../src/store/memory.js';

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };
const priya: Identity = { userId: 'priya', householdId: HH, role: 'caregiver', name: 'Priya', scopes: [] };
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };

// Thursday 2026-10-08 in New York (UTC-4).
const local = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00-04:00`);

function setup(start = local('10:00')) {
  const clock = { t: start, now() { return this.t; } };
  const store = new MemoryStore();
  const notifier = new OutboxNotifier(() => {});
  let n = 0;
  const service = new KinwiseService({ store, notifier, clock, ids: (p) => `${p}_${++n}` });
  return { clock, store, notifier, service };
}

const visitor = (id: string, hhmm: string, personPresent = true): VisitorEvent => ({
  eventId: id,
  deviceId: 'front-door',
  occurredAt: local(hhmm).toISOString(),
  source: 'demo',
  ringEventType: 'button_press',
  perception: { personPresent, peopleCount: personPresent ? 1 : 0, carrying: 'a small box', description: 'A person at the front door holding a small box' },
});

describe('KinwiseService — hero story', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
  });

  it('runs reminder → check → unexpected visitor → Pause → Call Priya', async () => {
    const { service, clock, notifier } = ctx;

    // 10:15 a seemingly innocent reminder
    clock.t = local('10:15');
    const r = await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    expect(r.level).toBe('elevated');
    expect(r.followUp).toMatch(/Is this call real/);
    expect(r.riskWindow.level).toBe('elevated');

    // 10:20 she asks Kinwise about the call
    clock.t = local('10:20');
    const v = await service.checkCall(asha, {
      description: 'A man from the FTC said my accounts are compromised and I should withdraw it as gold. Do not tell my family.',
    });
    expect(v.level).toBe('high');
    expect(v.signs.map((s) => s.key)).toEqual(['authority', 'urgency', 'secrecy', 'unusual_payment', 'courier_pickup']);
    expect(v.advice[0]).toMatch(/Don't hand anything/);
    expect(notifier.outbox.map((x) => x.kind)).toEqual(['risk_high']);

    // 14:41 an unexpected visitor
    clock.t = local('14:41');
    const ingest = await service.ingestVisitor(HH, visitor('evt-1', '14:41'));
    expect(ingest).toMatchObject({ duplicate: false, decision: 'pause' });

    const state = await service.tvState(tv);
    expect(state.activeAlert?.kind).toBe('pause');
    expect(state.activeAlert?.pauseMessage?.from).toBe('Priya');
    expect(state.activeAlert?.signs.length).toBe(5);
    expect(notifier.outbox[0]?.kind).toBe('pause');

    // She presses "Call Priya" on the remote
    const res = await service.respondToAlert(tv, ingest.alertId!, 'call_family');
    expect(res.message).toBe('Calling Priya now.');
    expect(notifier.outbox[0]).toMatchObject({ kind: 'call_request', caregiverName: 'Priya' });
    expect((await service.tvState(tv)).activeAlert).toBeUndefined();

    // Priya's timeline shows signals, never content
    const tl = await service.getTimeline(priya);
    const text = tl.entries.map((e) => e.text).join('\n');
    expect(tl.summary).toMatchObject({ pausesShown: 1, unexpectedVisitors: 1, flaggedCalls: 1 });
    expect(text).not.toMatch(/FTC|gold|accounts are compromised/i);
    expect(text).toMatch(/chose "Call Priya"/);
  });

  it('never stores the words of a checked call (privacy rule 3)', async () => {
    await ctx.service.checkCall(asha, { description: 'Officer Miller from the IRS says there is a warrant, pay in gift cards' });
    const raw = JSON.stringify(await ctx.store.load(HH));
    expect(raw).not.toMatch(/Miller|warrant|gift cards/i);
  });

  it('is idempotent on visitor event ids', async () => {
    await ctx.service.ingestVisitor(HH, visitor('dup', '13:00'));
    const again = await ctx.service.ingestVisitor(HH, visitor('dup', '13:00'));
    expect(again).toEqual({ duplicate: true, decision: 'ignored' });
  });

  it('greets an expected visitor without alarm even during a high window', async () => {
    const { service, clock } = ctx;
    await service.checkCall(asha, { description: 'courier will pick up the gold today' });
    clock.t = local('10:20');
    const res = await service.ingestVisitor(HH, visitor('luis', '10:20'));
    expect(res.decision).toBe('expected');
    expect((await service.tvState(tv)).activeAlert).toMatchObject({ kind: 'expected', visitLabel: 'Luis (gardener)' });
  });

  it('shows a gentle card for an unexpected visitor with no risk', async () => {
    ctx.clock.t = local('13:00');
    expect((await ctx.service.ingestVisitor(HH, visitor('e', '13:00'))).decision).toBe('gentle');
  });

  it('stores nothing during a privacy hour, only a counter', async () => {
    await ctx.service.setPrivacyHour(asha, 60);
    const res = await ctx.service.ingestVisitor(HH, visitor('p', '10:05'));
    expect(res.decision).toBe('ignored');
    const s = await ctx.store.load(HH);
    expect(s?.visitorEvents).toHaveLength(0);
    expect(s?.ignoredDoorEvents).toBe(1);
  });

  it('expires an unanswered Pause after 30 minutes', async () => {
    const { service, clock } = ctx;
    await service.checkCall(asha, { description: 'courier will pick up the gold today' });
    clock.t = local('13:00');
    await service.ingestVisitor(HH, visitor('x', '13:00'));
    clock.t = local('13:31');
    expect((await service.tvState(tv)).activeAlert).toBeUndefined();
  });

  it('keeps reminders private from the caregiver and logs every caregiver read', async () => {
    await ctx.service.addReminder(asha, { text: 'Call the pharmacy', at: local('15:00').toISOString() });
    const today = await ctx.service.getToday(priya);
    expect(today.reminders).toBeUndefined();
    await ctx.service.getTimeline(priya);
    const state = await ctx.service.tvState(tv);
    expect(state.accessLog.map((a) => a.action)).toEqual(["viewed the day's timeline", "viewed today's overview"]);
  });

  it('respects the resident choosing not to share the timeline', async () => {
    await ctx.service.updateConsent(asha, { shareTimelineWithCaregiver: false });
    await expect(ctx.service.getTimeline(priya)).rejects.toBeInstanceOf(PermissionError);
  });

  it('requires resident approval for caregiver-proposed visits', async () => {
    const { service, clock } = ctx;
    const p = await service.addExpectedVisit(priya, {
      label: 'Nurse Joy',
      recurrence: { kind: 'once', date: '2026-10-08', start: '15:00', end: '16:00' },
    });
    expect(p.needsApproval).toBe(true);
    clock.t = local('15:10');
    expect((await service.ingestVisitor(HH, visitor('n1', '15:10'))).decision).toBe('gentle');
    expect((await service.tvState(tv)).pendingProposals).toHaveLength(1);
    await service.decideProposal(tv, p.visit.id, 'approve');
    expect((await service.ingestVisitor(HH, visitor('n2', '15:12'))).decision).toBe('expected');
  });

  it('enforces roles', async () => {
    await expect(ctx.service.checkCall(priya, { description: 'x' })).rejects.toBeInstanceOf(PermissionError);
    await expect(ctx.service.sendFamilyMessage(asha, 'hi')).rejects.toBeInstanceOf(PermissionError);
    await expect(ctx.service.setPrivacyHour(priya, 30)).rejects.toBeInstanceOf(PermissionError);
    await expect(ctx.service.updateConsent(priya, { doorAwareness: false })).rejects.toBeInstanceOf(PermissionError);
  });

  it('validates input', async () => {
    await expect(ctx.service.addReminder(asha, { text: ' ', at: local('11:00').toISOString() })).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.service.addReminder(asha, { text: 'x', at: 'tomorrow' })).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.service.setPrivacyHour(asha, -1)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ctx.service.addExpectedVisit(asha, { label: 'x', recurrence: { kind: 'weekly', weekday: 1, start: '11:00', end: '10:00' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('delivers family messages to the TV', async () => {
    await ctx.service.sendFamilyMessage(priya, 'Dinner on Sunday? ❤️');
    const s = await ctx.service.tvState(tv);
    expect(s.today.messages[0]).toMatchObject({ from: 'Priya', text: 'Dinner on Sunday? ❤️', unread: true });
    await ctx.service.markMessageRead(tv, s.today.messages[0]!.id);
    expect((await ctx.service.tvState(tv)).today.messages[0]?.unread).toBe(false);
  });

  it('explains the last alert in one sentence', async () => {
    const { service, clock } = ctx;
    await service.checkCall(asha, { description: 'the bank fraud department says a courier will collect the gold' });
    clock.t = local('12:00');
    const { alertId } = await service.ingestVisitor(HH, visitor('q', '12:00'));
    await service.respondToAlert(asha, alertId!, 'known_person');
    const ex = await service.explainLastAlert(priya);
    expect(ex.summary).toMatch(/^At 12:00 PM: A visitor nobody expected/);
    expect(ex.summary).toMatch(/chose "I know this person"/);
  });
});
