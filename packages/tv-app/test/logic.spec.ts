/* Pure-logic specs (jest on the Vega build machine, vitest in packages/tv-preview). */
import {currentClockLabel, formatClockMinutes, msUntilNextMinute, parseClockLabel} from '../src/logic/clock';
import {pauseAnnouncement, pauseLine, statusPill} from '../src/logic/copy';
import {consentItems} from '../src/logic/consentCopy';
import {homeState, pauseAlert, SIGNS} from './fixtures';

describe('statusPill', () => {
  it('says Kinwise is on by default', () => {
    expect(statusPill(homeState())).toEqual({tone: 'ok', text: 'Kinwise is on'});
  });

  it('shows the safety watch in amber', () => {
    const s = homeState();
    const state = {...s, today: {...s.today, safety: {level: 'high' as const, untilLabel: '8:18 PM', signs: SIGNS}}};
    expect(statusPill(state)).toEqual({tone: 'caution', text: 'Watching the door until 8:18 PM'});
  });

  it('copes with a safety watch without an end label', () => {
    const s = homeState();
    const state = {...s, today: {...s.today, safety: {level: 'elevated' as const, signs: []}}};
    expect(statusPill(state).text).toBe('Watching the door more closely');
  });

  it('privacy time wins over everything', () => {
    const s = homeState();
    const state = {
      ...s,
      today: {...s.today, privacyHourUntilLabel: '3:19 PM', safety: {level: 'high' as const, untilLabel: '8:18 PM', signs: SIGNS}},
    };
    expect(statusPill(state)).toEqual({tone: 'privacy', text: 'Privacy time until 3:19 PM'});
  });

  it('notes when door awareness is off', () => {
    const s = homeState();
    expect(statusPill({...s, consent: {...s.consent, doorAwareness: false}})).toEqual({
      tone: 'muted',
      text: 'Kinwise is on · door alerts off',
    });
  });
});

describe('pause copy', () => {
  it('matches the spec sentence for a high-risk pause', () => {
    expect(pauseLine(pauseAlert())).toBe(
      'No visit is expected right now. Earlier today, Kinwise noticed 3 courier-scam warning signs.',
    );
  });

  it('uses the singular for one sign', () => {
    expect(pauseLine(pauseAlert({signs: [SIGNS[0]!]}))).toBe(
      'No visit is expected right now. Earlier today, Kinwise noticed 1 courier-scam warning sign.',
    );
  });

  it('is softer for an elevated pause', () => {
    expect(pauseLine(pauseAlert({riskLevel: 'elevated', signs: SIGNS.slice(0, 2)}))).toBe(
      'No visit is expected right now. Earlier today, Kinwise noticed 2 possible scam warning signs.',
    );
  });

  it('announces title, reason, the family message and the default button', () => {
    const text = pauseAnnouncement(pauseAlert());
    expect(text).toContain('Pause before you open the door.');
    expect(text).toContain('3 courier-scam warning signs');
    expect(text).toContain('A message from Priya: Mom, it');
    expect(text).toContain('Call Priya is selected.');
  });
});

describe('consent copy', () => {
  it('names the caregiver and keeps each explanation to one short line', () => {
    const items = consentItems('Priya');
    expect(items.map((i) => i.key)).toEqual(['scamScreening', 'doorAwareness', 'caregiverAlerts', 'shareTimelineWithCaregiver']);
    expect(items[2]!.title).toContain('Priya');
    for (const item of items) expect(item.explanation.length).toBeLessThanOrEqual(95);
  });
});

describe('clock', () => {
  it('parses and formats the hub clock labels', () => {
    expect(parseClockLabel('2:05 PM')).toBe(845);
    expect(parseClockLabel('12:00 AM')).toBe(0);
    expect(parseClockLabel('12:30 PM')).toBe(750);
    expect(parseClockLabel('not a time')).toBeUndefined();
    expect(parseClockLabel('13:00 PM')).toBeUndefined();
    expect(formatClockMinutes(845)).toBe('2:05 PM');
    expect(formatClockMinutes(0)).toBe('12:00 AM');
    expect(formatClockMinutes(1440 + 61)).toBe('1:01 AM');
  });

  it('ticks forward locally from the last hub label', () => {
    // serverTime is 11.527 s into the minute.
    const base = {label: '2:19 PM', serverTime: '2026-10-05T18:19:11.527Z', receivedAt: 1_000_000};
    expect(currentClockLabel(base, 1_000_000)).toBe('2:19 PM');
    expect(currentClockLabel(base, 1_000_000 + 48_000)).toBe('2:19 PM');
    expect(currentClockLabel(base, 1_000_000 + 48_500)).toBe('2:20 PM');
    expect(currentClockLabel(base, 1_000_000 + 48_500 + 60 * 60_000)).toBe('3:20 PM');
    expect(msUntilNextMinute(base, 1_000_000)).toBe(48_473);
  });

  it('rolls over midnight', () => {
    const base = {label: '11:59 PM', serverTime: '2026-10-05T03:59:00.000Z', receivedAt: 0};
    expect(currentClockLabel(base, 60_000)).toBe('12:00 AM');
  });

  it('leaves unknown labels alone', () => {
    expect(currentClockLabel({label: 'noon', serverTime: 'x', receivedAt: 0}, 5 * 60_000)).toBe('noon');
  });
});
