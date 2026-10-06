/**
 * The hub sends the household's local time as a label ("2:05 PM", in the household time zone).
 * Between polls (or while offline) the TV advances that label locally, minute by minute, using
 * only elapsed time. That avoids depending on the TV's own clock or on Intl time-zone data.
 */

const CLOCK_RE = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i;

/** "2:05 PM" → 845 (minutes since local midnight), or undefined if it isn't a clock label. */
export function parseClockLabel(label: string): number | undefined {
  const m = CLOCK_RE.exec(label.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 1 || h > 12 || min > 59) return undefined;
  const pm = m[3]!.toUpperCase() === 'PM';
  return ((h % 12) + (pm ? 12 : 0)) * 60 + min;
}

/** 845 → "2:05 PM" (same format as the hub's formatMinutes). */
export function formatClockMinutes(minutes: number): string {
  const total = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export interface ClockBase {
  /** Household-local label from the hub, e.g. today.timeLabel. */
  label: string;
  /** state.serverTime (ISO) — used only for the seconds within the current minute. */
  serverTime: string;
  /** Local Date.now() when that state arrived. */
  receivedAt: number;
}

function msIntoMinute(serverTime: string): number {
  const t = Date.parse(serverTime);
  if (Number.isNaN(t)) return 0;
  return ((t % 60000) + 60000) % 60000;
}

/** The household-local clock label `now` (local ms), advanced from the hub's last label. */
export function currentClockLabel(base: ClockBase, now: number): string {
  const start = parseClockLabel(base.label);
  if (start === undefined) return base.label;
  const elapsed = Math.max(0, now - base.receivedAt);
  const minutes = Math.floor((msIntoMinute(base.serverTime) + elapsed) / 60000);
  return formatClockMinutes(start + minutes);
}

/** Milliseconds until the household clock rolls over to the next minute. */
export function msUntilNextMinute(base: ClockBase, now: number): number {
  const elapsed = Math.max(0, now - base.receivedAt);
  const into = (msIntoMinute(base.serverTime) + elapsed) % 60000;
  return 60000 - into;
}
