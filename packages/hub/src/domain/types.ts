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
  /** How the resident refers to this person, e.g. "Meera (daughter)". */
  relationship?: string;
  /** Where Kinwise reaches this caregiver. Only they set it, and only they and the notifiers read it. */
  contacts?: Contacts;
  contactsChangedAt?: string;
  /** Random key stamped on this caregiver's e-mails and in the filter of their subscription. A new address gets a new key, so an old subscription (even one confirmed late) never matches new notices. */
  emailKey?: string;
}

/** A caregiver's own channels. E-mail and SMS/WhatsApp numbers (E.164, "+919876543210") are personal data. */
export interface Contacts {
  email?: string;
  sms?: string;
  whatsapp?: string;
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
  /** Demo doorbell only: ring as a stranger even during an expected visit. Ignored for any other source. */
  unscheduled?: boolean;
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
  /** When her TV told the hub the Pause was on screen. Absent = sent, not confirmed shown. */
  shownAt?: string;
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
  | 'watch_on'
  | 'watch_declined'
  | 'visitor_expected'
  | 'visitor_unexpected'
  | 'pause_sent'
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

/** Something Alexa asked the living-room TV to read aloud (the TV plays it once, by id). */
export interface TvCue {
  id: string;
  topic: 'messages' | 'today';
  text: string;
  at: string;
}

/** The latest "Call Meera" request: which notice to confirm, and whether Meera has said she is calling. */
export interface CallRequest {
  id: string;
  requestedAt: string;
  /** Set when Kinwise sent the second message because nobody had confirmed. */
  resentAt?: string;
  ackedAt?: string;
}

/** What a caregiver was told (a signal, never content). Kept with the household so every server instance shows the same "phone". */
export interface StoredNotice {
  householdId: string;
  caregiverId: string;
  caregiverName: string;
  kind: 'pause' | 'call_request' | 'risk_high';
  title: string;
  body: string;
  at: string;
  callId?: string;
}

/**
 * A question put to the resident after a call or reminder matched scam warning signs: "turn on a six-hour
 * safety watch and send Meera a signal?". It holds only the kinds of sign, never her words, and nothing
 * is watched, stored as a signal or sent to the family until she answers "turn on".
 */
export interface WatchOffer {
  id: string;
  createdAt: string;
  expiresAt: string;
  /** The warning signs that prompted the question: kinds and times only, never the words. Not yet in `signals`. */
  signals: SignalRecord[];
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
  /** The open question, if any (spec §5.4). Cleared on any answer, on expiry and when screening is switched off. */
  watchOffer?: WatchOffer;
  /** After "Not now" Kinwise does not ask again until this time. */
  watchDeclinedUntil?: string;
  /** The last answer, so a repeated tap or a retried request does the same thing once. */
  lastWatchAnswer?: { offerId: string; choice: 'turn_on' | 'not_now'; at: string };
  visitorEvents: VisitorEvent[];
  alerts: Alert[];
  messages: FamilyMessage[];
  accessLog: AccessEntry[];
  timeline: TimelineEntry[];
  processedEventIds: string[];
  ignoredDoorEvents: number;
  tvCue?: TvCue;
  callRequest?: CallRequest;
  /** Newest first, at most CAPS.notices. */
  notices?: StoredNotice[];
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
  notices: 30,
} as const;
