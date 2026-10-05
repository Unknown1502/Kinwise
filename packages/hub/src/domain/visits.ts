import { WEEKDAY_NAMES, formatMinutes, parseHHMM, zonedParts, type ZonedParts } from './time.js';
import type { ExpectedVisit, Recurrence } from './types.js';

export const VISIT_GRACE_MINUTES = 30;

export function occursOn(recurrence: Recurrence, day: Pick<ZonedParts, 'date' | 'weekday'>): boolean {
  return recurrence.kind === 'weekly' ? recurrence.weekday === day.weekday : recurrence.date === day.date;
}

/** Spec §5.5: an active visit matches when the local time is within [start − 30 min, end + 30 min]. */
export function matchExpectedVisit(
  visits: readonly ExpectedVisit[],
  instant: Date,
  timeZone: string,
  graceMinutes = VISIT_GRACE_MINUTES,
): ExpectedVisit | undefined {
  const local = zonedParts(instant, timeZone);
  return visits
    .filter((v) => v.status === 'active' && occursOn(v.recurrence, local))
    .find((v) => {
      const start = parseHHMM(v.recurrence.start) - graceMinutes;
      const end = parseHHMM(v.recurrence.end) + graceMinutes;
      return local.minutes >= start && local.minutes <= end;
    });
}

/** Active visits happening on the local day of `instant`, sorted by start time. */
export function visitsForDay(visits: readonly ExpectedVisit[], instant: Date, timeZone: string): ExpectedVisit[] {
  const local = zonedParts(instant, timeZone);
  return visits
    .filter((v) => v.status === 'active' && occursOn(v.recurrence, local))
    .sort((a, b) => parseHHMM(a.recurrence.start) - parseHHMM(b.recurrence.start));
}

/** "Thursdays 10:00 AM–11:00 AM" or "Oct 21 2:00 PM–3:00 PM". */
export function describeRecurrence(r: Recurrence): string {
  const span = `${formatMinutes(parseHHMM(r.start))}–${formatMinutes(parseHHMM(r.end))}`;
  if (r.kind === 'weekly') return `${WEEKDAY_NAMES[r.weekday]}s ${span}`;
  const [y, m, d] = r.date.split('-').map(Number);
  const label = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${label} ${span}`;
}

export function validateRecurrence(r: Recurrence): void {
  const start = parseHHMM(r.start);
  const end = parseHHMM(r.end);
  if (end <= start) throw new Error('A visit must end after it starts');
  if (r.kind === 'weekly' && (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6)) {
    throw new Error('weekday must be 0 (Sunday) to 6 (Saturday)');
  }
  if (r.kind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error('date must be YYYY-MM-DD');
}
