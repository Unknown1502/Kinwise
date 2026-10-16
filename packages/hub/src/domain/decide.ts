import { isWindowActive } from './risk.js';
import { matchExpectedVisit } from './visits.js';
import type { Consent, ExpectedVisit, RiskWindow, SignalCategory, VisitorEvent } from './types.js';

export type DoorDecision =
  | { kind: 'ignored'; reason: 'privacy_hour' | 'door_awareness_off' | 'stale_event' }
  | { kind: 'activity' }
  | { kind: 'expected'; visit: ExpectedVisit }
  | {
      kind: 'pause';
      level: 'elevated' | 'high';
      categories: SignalCategory[];
      notifyCaregiver: boolean;
    }
  | { kind: 'gentle' };

export interface DoorContext {
  consent: Consent;
  privacyHourUntil?: string;
  riskWindow?: RiskWindow;
  expectedVisits: readonly ExpectedVisit[];
  timezone: string;
}

/** A visitor event older than this is about someone who has already gone; a Pause now would be a false alarm. */
export const EVENT_MAX_AGE_MS = 5 * 60_000;
/** A little clock difference between Ring and the hub is normal; an event from further ahead than this is not trusted. */
export const EVENT_MAX_FUTURE_MS = 2 * 60_000;

export function isPrivacyHour(privacyHourUntil: string | undefined, now: Date): boolean {
  return !!privacyHourUntil && Date.parse(privacyHourUntil) > now.getTime();
}

/**
 * Spec §5.6. Appearance is deliberately not an input: only presence, time,
 * expected visits and the risk window decide what happens.
 */
export function decideOnVisitor(ctx: DoorContext, event: VisitorEvent, now: Date): DoorDecision {
  if (isPrivacyHour(ctx.privacyHourUntil, now)) return { kind: 'ignored', reason: 'privacy_hour' };
  if (!ctx.consent.doorAwareness) return { kind: 'ignored', reason: 'door_awareness_off' };
  // A webhook retried later, or a backlog after an outage, describes a visitor who has gone: do not alarm for it.
  const age = now.getTime() - Date.parse(event.occurredAt);
  if (age > EVENT_MAX_AGE_MS || age < -EVENT_MAX_FUTURE_MS) return { kind: 'ignored', reason: 'stale_event' };
  if (!event.perception.personPresent) return { kind: 'activity' };

  const visit = matchExpectedVisit(ctx.expectedVisits, new Date(event.occurredAt), ctx.timezone);
  if (visit) return { kind: 'expected', visit };

  if (isWindowActive(ctx.riskWindow, now)) {
    const high = ctx.riskWindow.level === 'high';
    return {
      kind: 'pause',
      level: ctx.riskWindow.level,
      categories: ctx.riskWindow.categories,
      notifyCaregiver: high && ctx.consent.caregiverAlerts,
    };
  }
  return { kind: 'gentle' };
}
