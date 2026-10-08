import type {AlertView, TvStateView} from '../types';

/**
 * What the TV says aloud when the hub state changes, wherever the change came from: the remote,
 * Alexa, Priya's phone or the Ring doorbell. Pure, so it is unit-tested.
 *
 * On the very first state only an alert already on screen is announced; everything else is news
 * only when it changes while the TV is on.
 */
export function narration(prev: TvStateView | undefined, next: TvStateView): string[] {
  const lines: string[] = [];
  const alert = next.activeAlert;
  if (alert && alert.status === 'active' && alert.id !== prev?.activeAlert?.id) {
    lines.push(alertLine(alert, next.resident.name));
  }
  if (!prev) return lines;

  const known = new Set(prev.today.messages.map((m) => m.id));
  const fresh = next.today.messages.filter((m) => m.unread && !known.has(m.id)).slice(0, 2);
  for (const m of fresh.reverse()) lines.push(`New message from ${m.from}: ${m.text}`);

  const was = prev.today.privacyHourUntilLabel;
  const now = next.today.privacyHourUntilLabel;
  if (now && now !== was) lines.push(`Privacy time is on until ${now}. Kinwise won't notice the door until then.`);
  else if (!now && was) lines.push('Privacy time has ended. Kinwise is noticing the door again.');

  if (prev.today.safety.level === 'none' && next.today.safety.level !== 'none') {
    const until = next.today.safety.untilLabel;
    lines.push(`Kinwise is watching the door more closely${until ? ` until ${until}` : ''}, because of today's warning signs.`);
  }

  if (next.cue && next.cue.id !== prev.cue?.id) lines.push(next.cue.text);
  return lines;
}

export function alertLine(alert: AlertView, residentName: string): string {
  if (alert.kind === 'pause') {
    return `${residentName}, someone is at your door, and no visit is expected right now. Please pause before you open it. Press OK to call ${alert.caregiverName}.`;
  }
  if (alert.kind === 'gentle') return "Someone is at the door. They're not on today's list, and you don't have to answer.";
  return `${alert.visitLabel ?? 'Your visitor'} is at the door. They're on today's list.`;
}

export function callingLine(name: string): string {
  return `Calling ${name} now. You don't need to open the door.`;
}
