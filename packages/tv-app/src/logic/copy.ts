import type {AlertView, TvStateView} from '../types';

/** Calm, plain-language strings derived from hub state. Pure, so they are unit-testable. */

export type StatusTone = 'ok' | 'caution' | 'privacy' | 'muted';

export interface StatusPill {
  tone: StatusTone;
  text: string;
}

/** The one-line status used in VoiceView announcements. Privacy time wins, then the safety watch. */
export function statusPill(state: Pick<TvStateView, 'today' | 'consent'>): StatusPill {
  const {today, consent} = state;
  if (today.privacyHourUntilLabel) {
    return {tone: 'privacy', text: `Privacy time until ${today.privacyHourUntilLabel}`};
  }
  if (today.safety && today.safety.level !== 'none') {
    return {
      tone: 'caution',
      text: today.safety.untilLabel ? `Watching the door until ${today.safety.untilLabel}` : 'Watching the door more closely',
    };
  }
  if (!consent.doorAwareness) return {tone: 'muted', text: 'Kinwise is on · door alerts off'};
  return {tone: 'ok', text: 'Kinwise is on'};
}

/** "No visit is expected right now. Earlier today, Kinwise noticed 3 courier-scam warning signs." */
export function pauseLine(alert: Pick<AlertView, 'signs' | 'riskLevel'>): string {
  const n = alert.signs.length;
  const lead = 'No visit is expected right now.';
  if (n === 0) return `${lead} Earlier today, Kinwise noticed signs of a possible scam.`;
  const kind = alert.riskLevel === 'elevated' ? 'possible scam warning' : 'courier-scam warning';
  return `${lead} Earlier today, Kinwise noticed ${n} ${kind} ${n === 1 ? 'sign' : 'signs'}.`;
}

export const PAUSE_TITLE = 'Pause before you open the door';

/** What VoiceView reads when the Pause appears. */
export function pauseAnnouncement(alert: AlertView): string {
  const parts = [PAUSE_TITLE + '.', pauseLine(alert)];
  if (alert.pauseMessage?.text) parts.push(`A message from ${alert.pauseMessage.from}: ${alert.pauseMessage.text}`);
  parts.push(`Call ${alert.caregiverName} is selected. You can also choose I know this person, or Dismiss.`);
  return parts.join(' ');
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
