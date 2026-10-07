/* Home-screen day logic (jest on the Vega build machine, vitest in packages/tv-preview). */
import {agenda, compactTime, dateOnly, dayLine, dayPart, durationLabel, minutesLeft, statusNote} from '../src/logic/today';
import {homeState} from './fixtures';

describe('day clock', () => {
  it('names the part of the day', () => {
    expect(dayPart('9:05 AM')).toBe('morning');
    expect(dayPart('12:00 PM')).toBe('afternoon');
    expect(dayPart('5:00 PM')).toBe('evening');
    expect(dayPart('9:30 PM')).toBe('night');
    expect(dayPart('4:59 AM')).toBe('night');
    expect(dayPart('soon')).toBeUndefined();
  });

  it('reads like a day clock', () => {
    expect(dayLine('Monday, October 5', '2:19 PM')).toBe('Monday afternoon');
    expect(dayLine('Monday, October 5', 'soon')).toBe('Monday');
    expect(dateOnly('Monday, October 5')).toBe('October 5');
  });
});

describe('agenda', () => {
  it('merges visits and reminders in time order and marks what has passed', () => {
    const items = agenda(homeState().today, '2:19 PM');
    expect(items.map((i) => [i.title, i.time, i.when])).toEqual([
      ['Maria (home-health aide)', '2:00–3:00 PM', 'now'],
      ['Courier from the bank at 2 p.m.', '2:00 PM', 'past'],
      ['Call the pharmacy', '4:30 PM', 'later'],
    ]);
    expect(items[1]!.flagged).toBe(true);
  });

  it('puts items without a clock time last', () => {
    const today = {visits: [{id: 'v', label: 'Luis', timeLabel: 'every Thursday'}], reminders: [{id: 'r', text: 'Tea', timeLabel: '9:00 AM', flagged: false}]};
    expect(agenda(today, '8:00 AM').map((i) => i.title)).toEqual(['Tea', 'Luis']);
  });

  it('shortens a same-half-day range and leaves others alone', () => {
    expect(compactTime('2:00 PM–3:00 PM')).toBe('2:00–3:00 PM');
    expect(compactTime('11:00 AM–1:00 PM')).toBe('11:00 AM–1:00 PM');
    expect(compactTime('9:00 AM')).toBe('9:00 AM');
  });
});

describe('privacy time left', () => {
  const server = '2026-10-05T18:19:11.527Z';

  it('counts down on the hub clock, not the TV clock', () => {
    expect(minutesLeft('2026-10-05T19:19:11.527Z', server, 1_000, 1_000)).toBe(60);
    expect(minutesLeft('2026-10-05T19:19:11.527Z', server, 1_000, 1_000 + 90_000)).toBe(59);
    expect(minutesLeft('2026-10-05T18:00:00.000Z', server, 0, 0)).toBe(0);
    expect(minutesLeft(undefined, server, 0, 0)).toBeUndefined();
  });

  it('says durations the way people do', () => {
    expect(durationLabel(1)).toBe('1 minute');
    expect(durationLabel(58)).toBe('58 minutes');
    expect(durationLabel(60)).toBe('1 hour');
    expect(durationLabel(75)).toBe('1 hour 15 minutes');
    expect(durationLabel(120)).toBe('2 hours');
  });

  it('shows the time left in the status note', () => {
    const s = homeState();
    const state = {...s, today: {...s.today, privacyHourUntilLabel: '3:19 PM'}};
    expect(statusNote(state, 58)).toEqual({tone: 'privacy', title: 'Privacy time', detail: '58 minutes left, until 3:19 PM'});
    expect(statusNote(state, 0).detail).toBe('Until 3:19 PM');
    expect(statusNote(homeState())).toEqual({tone: 'ok', title: 'Kinwise is on', detail: 'Looking out for unexpected visitors'});
  });
});
