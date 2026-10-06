/**
 * Wire types for the Kinwise hub's Fire TV API (GET /tv/state and friends).
 * Mirrors packages/hub/src/services/kinwise.ts (TvStateView) and
 * packages/hub/src/services/views.ts (TodayView, AlertView, SafetyView, SignView).
 * Keep these in sync by hand: the TV app is built standalone on the Vega build machine.
 */

export type SignalCategory =
  | 'authority'
  | 'urgency'
  | 'secrecy'
  | 'unusual_payment'
  | 'courier_pickup'
  | 'remote_access';

export type RiskLevel = 'none' | 'elevated' | 'high';
export type AlertKind = 'pause' | 'gentle' | 'expected';
export type AlertStatus = 'active' | 'resolved' | 'expired';
export type AlertAction = 'call_family' | 'known_person' | 'dismiss';
export type ProposalDecision = 'approve' | 'decline';

export interface SignView {
  key: SignalCategory;
  label: string;
  explanation: string;
}

export interface SafetyView {
  level: RiskLevel;
  untilLabel?: string;
  signs: SignView[];
}

export interface PauseMessage {
  from: string;
  text: string;
  videoUrl?: string;
}

export interface AlertView {
  id: string;
  kind: AlertKind;
  status: AlertStatus;
  createdAt: string;
  createdLabel: string;
  description: string;
  visitLabel?: string;
  riskLevel?: 'elevated' | 'high';
  signs: SignView[];
  caregiverName: string;
  pauseMessage?: PauseMessage;
  resolution?: AlertAction;
  resolvedLabel?: string;
}

export interface TodayView {
  householdName: string;
  residentName: string;
  caregiverName: string;
  date: string;
  dateLabel: string;
  timeLabel: string;
  reminders?: Array<{id: string; text: string; timeLabel: string; flagged: boolean}>;
  visits: Array<{id: string; label: string; timeLabel: string}>;
  messages: Array<{id: string; from: string; text: string; timeLabel: string; unread: boolean}>;
  safety: SafetyView;
  activeAlert?: AlertView;
  privacyHourUntilLabel?: string;
}

export interface Consent {
  scamScreening: boolean;
  doorAwareness: boolean;
  caregiverAlerts: boolean;
  shareTimelineWithCaregiver: boolean;
  onboardedAt?: string;
}

export type ConsentKey = 'scamScreening' | 'doorAwareness' | 'caregiverAlerts' | 'shareTimelineWithCaregiver';

export type ConsentPatch = Partial<Record<ConsentKey, boolean>> & {onboarded?: boolean};

export interface PendingProposal {
  id: string;
  label: string;
  when: string;
  proposedBy: string;
}

export interface AccessLogEntry {
  timeLabel: string;
  actor: string;
  action: string;
}

export interface TvStateView {
  household: {id: string; name: string; timezone: string};
  resident: {id: string; name: string};
  caregiver: {name: string; relationship?: string};
  today: TodayView;
  activeAlert?: AlertView;
  pendingProposals: PendingProposal[];
  consent: Consent;
  privacyHourUntil?: string;
  accessLog: AccessLogEntry[];
  serverTime: string;
}

export interface RespondResult {
  alert: AlertView;
  message: string;
}

export interface PrivacyHourResult {
  until?: string;
  untilLabel?: string;
}
