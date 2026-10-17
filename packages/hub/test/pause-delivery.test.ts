import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth/identity.js';
import { PermissionError } from '../src/auth/identity.js';
import type { VisitorEvent } from '../src/domain/types.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { KinwiseService, NotFoundError } from '../src/services/kinwise.js';
import { OutboxNotifier } from '../src/services/notifier.js';
import { MemoryStore } from '../src/store/memory.js';

// covers: R1, R2, R3 (see .aqg/code-construction/watch-consent.md)

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };
const priya: Identity = { userId: 'priya', householdId: HH, role: 'caregiver', name: 'Meera', scopes: [] };
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };
const local = (hhmm: string, sec = 0) => new Date(`2026-10-08T${hhmm}:${String(sec).padStart(2, '0')}-04:00`);
const CALL = 'A man from the FTC said my accounts are compromised and I should withdraw it as gold. Do not tell my family.';

const visitor = (id: string, hhmm: string): VisitorEvent => ({
  eventId: id,
  deviceId: 'front-door',
  occurredAt: local(hhmm).toISOString(),
  source: 'demo',
  ringEventType: 'button_press',
  perception: { personPresent: true, peopleCount: 1, description: 'A person at the front door' },
});

describe('a Pause that was sent is not a Pause that was shown', () => {
  let clock: { t: Date; now(): Date };
  let service: KinwiseService;
  let notifier: OutboxNotifier;
  let alertId: string;

  beforeEach(async () => {
    clock = { t: local('10:20'), now() { return this.t; } };
    notifier = new OutboxNotifier(() => {});
    service = new KinwiseService({ store: new MemoryStore(), notifier, clock });
    await service.createHousehold(demoHousehold(clock.now()));
    const v = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, v.watch.offer!.id, 'turn_on');
    notifier.outbox.length = 0;
    clock.t = local('14:41');
    alertId = (await service.ingestVisitor(HH, visitor('v1', '14:41'))).alertId!;
  });

  it('S1.1: the decision is recorded as "sent", and the family is not told that she saw it', async () => {
    const t = await service.getTimeline(asha, '2026-10-08');
    expect(t.entries.map((e) => e.kind)).toContain('pause_sent');
    expect(t.entries.map((e) => e.kind)).not.toContain('pause_shown');
    expect(t.summary).toMatchObject({ pausesSent: 1, pausesShown: 0 });

    const body = notifier.outbox[0]!.body;
    expect(body).not.toMatch(/sees your message/i);
    expect(body).toMatch(/can(no|')t tell whether/i);
  });

  it('S2.1: only the TV confirming it appeared makes it "shown", once', async () => {
    expect((await service.tvState(tv)).activeAlert?.delivery).toBe('sent');
    await service.markAlertShown(tv, alertId);
    await service.markAlertShown(tv, alertId); // a repeat poll changes nothing
    expect((await service.tvState(tv)).activeAlert?.delivery).toBe('shown');
    const t = await service.getTimeline(asha, '2026-10-08');
    expect(t.entries.filter((e) => e.kind === 'pause_shown')).toHaveLength(1);
    expect(t.summary).toMatchObject({ pausesSent: 1, pausesShown: 1 });
  });

  it('S3.1: with no confirmation after a minute it says so, to the family as well', async () => {
    clock.t = local('14:41', 59);
    expect((await service.tvState(tv)).activeAlert?.delivery).toBe('sent');
    clock.t = local('14:42', 5);
    expect((await service.tvState(tv)).activeAlert?.delivery).toBe('not_confirmed');
    const ex = await service.explainLastAlert(priya);
    expect(ex.summary).toMatch(/has not confirmed that the Pause appeared/i);
    expect(ex.summary).not.toMatch(/still showing on the TV/i);
  });

  it('S3.2: once the TV confirms, the family is told it appeared', async () => {
    await service.markAlertShown(tv, alertId);
    expect((await service.explainLastAlert(priya)).summary).toMatch(/appeared on the TV/i);
  });

  it('S4.1: only her TV or she can confirm; an unknown alert is refused', async () => {
    await expect(service.markAlertShown(priya, alertId)).rejects.toBeInstanceOf(PermissionError);
    await expect(service.markAlertShown(tv, 'alert_nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
