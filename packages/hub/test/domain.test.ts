import { describe, expect, it } from 'vitest';
import { decideOnVisitor, type DoorContext } from '../src/domain/decide.js';
import { accumulate, closeRiskWindow, isWindowActive, updateRiskWindow } from '../src/domain/risk.js';
import { formatMinutes, parseHHMM, zonedParts } from '../src/domain/time.js';
import type { Consent, ExpectedVisit, RiskWindow, SignalRecord, VisitorEvent } from '../src/domain/types.js';
import { describeRecurrence, matchExpectedVisit, validateRecurrence, visitsForDay } from '../src/domain/visits.js';

const TZ = 'America/New_York';
// Thursday 2026-10-08, New York is UTC-4 (EDT).
const at = (localHHMM: string, date = '2026-10-08') => new Date(`${date}T${localHHMM}:00-04:00`);

const visit = (over: Partial<ExpectedVisit> = {}): ExpectedVisit => ({
  id: 'v1',
  label: 'Luis (gardener)',
  recurrence: { kind: 'weekly', weekday: 4, start: '10:00', end: '11:00' },
  status: 'active',
  createdBy: 'asha',
  createdAt: '2026-10-01T00:00:00Z',
  ...over,
});

describe('time', () => {
  it('computes local parts across the UTC date boundary', () => {
    // 01:30 UTC Friday is still Thursday 21:30 in New York.
    const p = zonedParts(new Date('2026-10-09T01:30:00Z'), TZ);
    expect(p).toEqual({ date: '2026-10-08', weekday: 4, minutes: 21 * 60 + 30 });
  });
  it('handles a different zone', () => {
    expect(zonedParts(new Date('2026-10-08T14:15:00Z'), 'Asia/Kolkata')).toEqual({
      date: '2026-10-08',
      weekday: 4,
      minutes: 19 * 60 + 45,
    });
  });
  it('parses and formats clock times', () => {
    expect(parseHHMM('09:05')).toBe(545);
    expect(() => parseHHMM('25:00')).toThrow();
    expect(formatMinutes(0)).toBe('12:00 AM');
    expect(formatMinutes(14 * 60 + 41)).toBe('2:41 PM');
  });
});

describe('expected visits', () => {
  it('matches inside the window including 30 min grace', () => {
    expect(matchExpectedVisit([visit()], at('09:30'), TZ)?.id).toBe('v1');
    expect(matchExpectedVisit([visit()], at('11:30'), TZ)?.id).toBe('v1');
  });
  it('does not match outside the grace window or on another weekday', () => {
    expect(matchExpectedVisit([visit()], at('09:29'), TZ)).toBeUndefined();
    expect(matchExpectedVisit([visit()], at('11:31'), TZ)).toBeUndefined();
    expect(matchExpectedVisit([visit()], at('10:15', '2026-10-07'), TZ)).toBeUndefined();
  });
  it('ignores proposed (unapproved) visits — consent rule', () => {
    expect(matchExpectedVisit([visit({ status: 'proposed' })], at('10:15'), TZ)).toBeUndefined();
  });
  it('supports one-off visits', () => {
    const once = visit({ id: 'v2', recurrence: { kind: 'once', date: '2026-10-08', start: '14:00', end: '15:00' } });
    expect(matchExpectedVisit([once], at('14:20'), TZ)?.id).toBe('v2');
    expect(matchExpectedVisit([once], at('14:20', '2026-10-15'), TZ)).toBeUndefined();
  });
  it('lists today’s visits sorted by start', () => {
    const late = visit({ id: 'late', recurrence: { kind: 'weekly', weekday: 4, start: '15:00', end: '16:00' } });
    expect(visitsForDay([late, visit()], at('08:00'), TZ).map((v) => v.id)).toEqual(['v1', 'late']);
  });
  it('describes recurrences for voice and TV', () => {
    expect(describeRecurrence(visit().recurrence)).toBe('Thursdays 10:00 AM–11:00 AM');
    expect(describeRecurrence({ kind: 'once', date: '2026-10-21', start: '14:00', end: '15:00' })).toBe(
      'Oct 21 2:00 PM–3:00 PM',
    );
  });
  it('validates recurrences', () => {
    expect(() => validateRecurrence({ kind: 'weekly', weekday: 7, start: '10:00', end: '11:00' })).toThrow();
    expect(() => validateRecurrence({ kind: 'weekly', weekday: 1, start: '11:00', end: '10:00' })).toThrow();
    expect(() => validateRecurrence({ kind: 'once', date: '10/21', start: '10:00', end: '11:00' })).toThrow();
  });
});

describe('risk accumulation and window', () => {
  const sig = (iso: string, categories: SignalRecord['categories'], level: SignalRecord['level'] = 'none'): SignalRecord => ({
    at: iso,
    source: 'reminder',
    categories,
    level,
  });
  let n = 0;
  const id = () => `w${++n}`;

  it('unions single-category signals across sessions into a higher level', () => {
    const now = new Date('2026-10-08T18:00:00Z');
    const signals = [
      sig('2026-10-08T14:15:00Z', ['authority', 'courier_pickup'], 'elevated'),
      sig('2026-10-08T14:20:00Z', ['urgency']),
    ];
    expect(accumulate(signals, now)).toEqual({
      level: 'high',
      categories: ['authority', 'urgency', 'courier_pickup'],
    });
  });

  it('forgets signals older than 24 hours', () => {
    const now = new Date('2026-10-09T15:00:00Z');
    expect(accumulate([sig('2026-10-08T14:00:00Z', ['authority', 'urgency'], 'elevated')], now).level).toBe('none');
  });

  it('opens, upgrades and extends a window, never shortening it', () => {
    const t1 = new Date('2026-10-08T14:15:00Z');
    const s1 = [sig(t1.toISOString(), ['authority', 'courier_pickup'], 'elevated')];
    const opened = updateRiskWindow(undefined, s1, t1, id);
    expect(opened.change).toBe('opened');
    expect(opened.window?.level).toBe('elevated');
    expect(opened.window?.expiresAt).toBe('2026-10-08T20:15:00.000Z');

    const t2 = new Date('2026-10-08T14:20:00Z');
    const s2 = [...s1, sig(t2.toISOString(), ['urgency', 'secrecy', 'unusual_payment'], 'high')];
    const upgraded = updateRiskWindow(opened.window, s2, t2, id);
    expect(upgraded.change).toBe('upgraded');
    expect(upgraded.window?.id).toBe(opened.window?.id);
    expect(upgraded.window?.level).toBe('high');
    expect(upgraded.window?.expiresAt).toBe('2026-10-08T20:20:00.000Z');
  });

  it('does nothing for an everyday signal', () => {
    const t = new Date('2026-10-08T14:15:00Z');
    expect(updateRiskWindow(undefined, [sig(t.toISOString(), [])], t, id)).toEqual({ window: undefined, change: 'none' });
  });

  it('treats a closed or expired window as inactive', () => {
    const w: RiskWindow = {
      id: 'w',
      openedAt: '2026-10-08T14:00:00Z',
      expiresAt: '2026-10-08T20:00:00Z',
      level: 'high',
      categories: ['courier_pickup', 'unusual_payment'],
    };
    expect(isWindowActive(w, new Date('2026-10-08T19:59:00Z'))).toBe(true);
    expect(isWindowActive(w, new Date('2026-10-08T20:00:00Z'))).toBe(false);
    expect(isWindowActive(closeRiskWindow(w, new Date('2026-10-08T15:00:00Z'), 'resident'), new Date('2026-10-08T16:00:00Z'))).toBe(false);
  });
});

describe('door decision (spec §5.6)', () => {
  const consent: Consent = { scamScreening: true, doorAwareness: true, caregiverAlerts: true, shareTimelineWithCaregiver: true };
  const highWindow: RiskWindow = {
    id: 'w',
    openedAt: '2026-10-08T14:00:00Z',
    expiresAt: '2026-10-08T20:00:00Z',
    level: 'high',
    categories: ['authority', 'courier_pickup', 'unusual_payment'],
  };
  const event = (local: string, personPresent = true): VisitorEvent => ({
    eventId: 'e1',
    deviceId: 'd1',
    occurredAt: at(local).toISOString(),
    source: 'demo',
    ringEventType: 'motion_detected',
    perception: { personPresent, peopleCount: personPresent ? 1 : 0, description: 'A person at the front door' },
  });
  const ctx = (over: Partial<DoorContext> = {}): DoorContext => ({
    consent,
    expectedVisits: [visit()],
    timezone: TZ,
    riskWindow: highWindow,
    ...over,
  });
  const now = at('14:41');

  it('ignores everything during a privacy hour', () => {
    expect(decideOnVisitor(ctx({ privacyHourUntil: '2026-10-08T19:00:00Z' }), event('14:41'), now)).toEqual({
      kind: 'ignored',
      reason: 'privacy_hour',
    });
  });
  it('ignores when door awareness is off', () => {
    expect(decideOnVisitor(ctx({ consent: { ...consent, doorAwareness: false } }), event('14:41'), now).kind).toBe('ignored');
  });
  it('records activity only when no person is present', () => {
    expect(decideOnVisitor(ctx(), event('14:41', false), now)).toEqual({ kind: 'activity' });
  });
  it('treats an expected visitor calmly even inside a high window', () => {
    const d = decideOnVisitor(ctx(), event('10:15'), at('10:15'));
    expect(d.kind).toBe('expected');
  });
  it('shows the Pause and alerts family for an unexpected visitor in a high window', () => {
    expect(decideOnVisitor(ctx(), event('14:41'), now)).toEqual({
      kind: 'pause',
      level: 'high',
      categories: highWindow.categories,
      notifyCaregiver: true,
    });
  });
  it('respects caregiverAlerts consent', () => {
    const d = decideOnVisitor(ctx({ consent: { ...consent, caregiverAlerts: false } }), event('14:41'), now);
    expect(d).toMatchObject({ kind: 'pause', notifyCaregiver: false });
  });
  it('shows a softer Pause without caregiver alert in an elevated window', () => {
    const d = decideOnVisitor(ctx({ riskWindow: { ...highWindow, level: 'elevated' } }), event('14:41'), now);
    expect(d).toMatchObject({ kind: 'pause', level: 'elevated', notifyCaregiver: false });
  });
  it('shows a gentle card with no window', () => {
    expect(decideOnVisitor(ctx({ riskWindow: undefined }), event('14:41'), now)).toEqual({ kind: 'gentle' });
  });
});
