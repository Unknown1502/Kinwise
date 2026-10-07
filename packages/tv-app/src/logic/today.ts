import type {TodayView, TvStateView} from '../types';
import {parseClockLabel} from './clock';

/**
 * The home screen's reading of the day, as pure functions: the "day clock" line, one agenda of
 * visits and reminders in time order, and how long privacy time has left.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** "2:19 PM" → "afternoon". Morning until noon, afternoon until 5 PM, evening until 9 PM. */
export function dayPart(clockLabel: string): DayPart | undefined {
  const minutes = parseClockLabel(clockLabel);
  if (minutes === undefined) return undefined;
  const hour = Math.floor(minutes / 60);
  if (hour < 5 || hour >= 21) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** ("Monday, October 5", "2:19 PM") → "Monday afternoon": the orientation line of a day clock. */
export function dayLine(dateLabel: string, clockLabel: string): string {
  const weekday = dateLabel.split(',')[0]!.trim();
  const part = dayPart(clockLabel);
  return part ? `${weekday} ${part}` : weekday;
}

/** "Monday, October 5" → "October 5". */
export function dateOnly(dateLabel: string): string {
  const i = dateLabel.indexOf(',');
  return i === -1 ? dateLabel : dateLabel.slice(i + 1).trim();
}

const TIME_RE = /(\d{1,2}:\d{2}\s*[AP]M)/gi;

/** "2:00 PM–3:00 PM" → "2:00–3:00 PM"; a range that crosses noon keeps both suffixes. */
export function compactTime(label: string): string {
  const m = /^(\d{1,2}:\d{2})\s*([AP]M)\s*[–-]\s*(\d{1,2}:\d{2})\s*([AP]M)$/i.exec(label.trim());
  if (!m || m[2]!.toUpperCase() !== m[4]!.toUpperCase()) return label;
  return `${m[1]}–${m[3]} ${m[4]!.toUpperCase()}`;
}

export type AgendaWhen = 'past' | 'now' | 'later';

export interface AgendaItem {
  id: string;
  kind: 'visit' | 'reminder';
  time: string;
  title: string;
  /** A reminder Kinwise screened and found scam signs in. */
  flagged: boolean;
  when: AgendaWhen;
}

function whenOf(label: string, now: number | undefined): {start?: number; when: AgendaWhen} {
  const times = (label.match(TIME_RE) ?? []).map((t) => parseClockLabel(t)!);
  const start = times[0];
  if (start === undefined || now === undefined) return {start, when: 'later'};
  const end = times[1] ?? start;
  if (now > end) return {start, when: 'past'};
  if (now >= start && times[1] !== undefined) return {start, when: 'now'};
  return {start, when: 'later'};
}

/** Visits and reminders as one list in time order. Items without a clock time go last. */
export function agenda(today: Pick<TodayView, 'visits' | 'reminders'>, clockLabel: string): AgendaItem[] {
  const now = parseClockLabel(clockLabel);
  const rows = [
    ...today.visits.map((v) => ({...whenOf(v.timeLabel, now), id: v.id, kind: 'visit' as const, time: compactTime(v.timeLabel), title: v.label, flagged: false})),
    ...(today.reminders ?? []).map((r) => ({
      ...whenOf(r.timeLabel, now),
      id: r.id,
      kind: 'reminder' as const,
      time: r.timeLabel,
      title: r.text,
      flagged: r.flagged,
    })),
  ];
  return rows
    .map((row, index) => ({row, index}))
    .sort((a, b) => (a.row.start ?? Infinity) - (b.row.start ?? Infinity) || a.index - b.index)
    .map(({row: {start: _start, ...item}}) => item);
}

/** Whole minutes from the household's "now" until `untilIso`, measured on the hub's clock, not the TV's. */
export function minutesLeft(untilIso: string | undefined, serverTime: string, receivedAt: number, now: number): number | undefined {
  const until = Date.parse(untilIso ?? '');
  const server = Date.parse(serverTime);
  if (Number.isNaN(until) || Number.isNaN(server)) return undefined;
  const elapsed = Math.max(0, now - receivedAt);
  return Math.max(0, Math.ceil((until - server - elapsed) / 60_000));
}

/** 58 → "58 minutes", 60 → "1 hour", 75 → "1 hour 15 minutes". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? '' : `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const mins = m === 0 && h > 0 ? '' : `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  return [hours, mins].filter(Boolean).join(' ');
}

export type NoteTone = 'ok' | 'caution' | 'privacy' | 'muted';

export interface StatusNote {
  tone: NoteTone;
  title: string;
  detail: string;
}

/** The status in the corner of the home screen, as a title and one line of detail. */
export function statusNote(state: Pick<TvStateView, 'today' | 'consent'>, privacyMinutesLeft?: number): StatusNote {
  const {today, consent} = state;
  if (today.privacyHourUntilLabel) {
    const until = today.privacyHourUntilLabel;
    return {
      tone: 'privacy',
      title: 'Privacy time',
      detail:
        privacyMinutesLeft !== undefined && privacyMinutesLeft > 0
          ? `${durationLabel(privacyMinutesLeft)} left, until ${until}`
          : `Until ${until}`,
    };
  }
  if (today.safety && today.safety.level !== 'none') {
    return {
      tone: 'caution',
      title: 'Watching the door closely',
      detail: today.safety.untilLabel ? `Until ${today.safety.untilLabel}, after today's warning signs` : "After today's warning signs",
    };
  }
  if (!consent.doorAwareness) return {tone: 'muted', title: 'Kinwise is on', detail: 'Door alerts are off'};
  return {tone: 'ok', title: 'Kinwise is on', detail: 'Looking out for unexpected visitors'};
}
