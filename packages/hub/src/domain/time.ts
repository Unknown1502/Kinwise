/** Time-zone helpers built on Intl only (no dependencies, works on Lambda). */

export interface ZonedParts {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** 0 = Sunday … 6 = Saturday, in the local zone. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ''),
    minutes: hour * 60 + Number(parts.minute),
  };
}

/** "14:05" → 845. Throws on malformed input so bad data fails loudly at the boundary. */
export function parseHHMM(value: string): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 845 → "2:05 PM" (voice- and TV-friendly). */
export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatClock(instant: Date, timeZone: string): string {
  return formatMinutes(zonedParts(instant, timeZone).minutes);
}

export function addMinutes(iso: string | Date, minutes: number): string {
  const base = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  return new Date(base + minutes * 60_000).toISOString();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
