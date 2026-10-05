/**
 * Kinwise domain model. One HouseholdState document holds everything the rules
 * engine needs; arrays are capped so a household stays well under DynamoDB's
 * 400 KB item limit.
 */

export type Role = 'resident' | 'caregiver';

export type SignalCategory =
  | 'authority'
  | 'urgency'
  | 'secrecy'
  | 'unusual_payment'
  | 'courier_pickup'
  | 'remote_access';

export type RiskLevel = 'none' | 'elevated' | 'high';

export interface Member {
  id: string;
  name: string;
  role: Role;
  /** How the resident refers to this person, e.g. "Priya (daughter)". */
  relationship?: string;
}

export interface PauseMessage {
  from: string;
  text: string;
  /** Optional short video recorded by the caregiver; captions always come from `text`. */
  videoUrl?: string;
}

export interface Household {
  id: string;
  name: string;
  /** IANA time zone used for expected visits and "today". */
  timezone: string;
  members: Member[];
  pauseMessage: PauseMessage;
}

export interface Consent {
  /** Screen what the resident tells Kinwise (reminders, checks) for scam warning signs. */
  scamScreening: boolean;
  /** React to Ring doorbell activity. */
  doorAwareness: boolean;
  /** Send the caregiver an alert when a Pause is shown. */
  caregiverAlerts: boolean;
  /** Let the caregiver see the day timeline (signals only). */
  shareTimelineWithCaregiver: boolean;
  /** Set when the resident finished onboarding on her TV. */
  onboardedAt?: string;
}

export type Recurrence =
  | { kind: 'weekly'; weekday: number; start: string; end: string }
  | { kind: 'once'; date: string; start: string; end: string };

export interface ExpectedVisit {
  id: string;
  label: string;
  recurrence: Recurrence;
  /** Caregiver-proposed visits stay `proposed` until the resident approves them. */
  status: 'active' | 'proposed';
  createdBy: string;
  createdAt: string;
}

export interface ScreeningResult {
  level: RiskLevel;
  categories: SignalCategory[];
}

export interface Reminder {
  id: string;
  text: string;
  /** ISO instant the reminder is for. */
  at: string;
  createdBy: string;
  createdAt: string;
  screening: ScreeningResult;
}

/** Privacy rule 3: signals keep category labels only, never the words that produced them. */
export interface SignalRecord {
  at: string;
  source: 'reminder' | 'check';
  categories: SignalCategory[];
  level: RiskLevel;
}

export interface RiskWindow {
  id: string;
  openedAt: string;
  expiresAt: string;
  level: Exclude<RiskLevel, 'none'>;
  categories: SignalCategory[];
  closedAt?: string;
  closedReason?: string;
}

export interface Perception {
  personPresent: boolean;
  peopleCount: number;
  /** Neutral description of carried objects, e.g. "a small box". Never identity or appearance. */
  carrying?: string;
  /** Neutral one-line description for the TV card. */
  description: string;
}

export interface VisitorEvent {
  eventId: string;
  deviceId: string;
  occurredAt: string;
  source: 'ring-playground' | 'ring-webhook' | 'ring-poll' | 'demo';
  ringEventType: string;
  perception: Perception;
}

export type AlertKind = 'pause' | 'gentle' | 'expected';
export type AlertAction = 'call_family' | 'known_person' | 'dismiss';

export interface Alert {
  id: string;
  kind: AlertKind;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'resolved' | 'expired';
  visitorEventId: string;
  description: string;
  riskLevel?: Exclude<RiskLevel, 'none'>;
  categories?: SignalCategory[];
  visitLabel?: string;
  resolution?: AlertAction;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface FamilyMessage {
  id: string;
  from: string;
  text: string;
  at: string;
  readAt?: string;
}

export interface AccessEntry {
  at: string;
  actor: string;
  action: string;
}

export type TimelineKind =
  | 'reminder_flagged'
  | 'call_checked'
  | 'window_opened'
  | 'window_closed'
  | 'visitor_expected'
  | 'visitor_unexpected'
  | 'pause_shown'
  | 'alert_resolved'
  | 'privacy_hour'
  | 'consent_changed'
  | 'visit_proposed'
  | 'visit_approved'
  | 'visit_declined'
  | 'message_sent';

export interface TimelineEntry {
  at: string;
  kind: TimelineKind;
  text: string;
}

export interface HouseholdState {
  version: number;
  household: Household;
  consent: Consent;
  privacyHourUntil?: string;
  reminders: Reminder[];
  expectedVisits: ExpectedVisit[];
  signals: SignalRecord[];
  riskWindow?: RiskWindow;
  visitorEvents: VisitorEvent[];
  alerts: Alert[];
  messages: FamilyMessage[];
  accessLog: AccessEntry[];
  timeline: TimelineEntry[];
  processedEventIds: string[];
  ignoredDoorEvents: number;
}

export const CAPS = {
  reminders: 100,
  signals: 200,
  visitorEvents: 100,
  alerts: 100,
  messages: 50,
  accessLog: 200,
  timeline: 300,
  processedEventIds: 500,
} as const;
