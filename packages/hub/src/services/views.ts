import { ruleFor } from '../domain/patterns.js';
import { isWindowActive } from '../domain/risk.js';
import { formatClock, zonedParts } from '../domain/time.js';
import type {
  Alert,
  HouseholdState,
  Member,
  RiskLevel,
  SignalCategory,
  TimelineEntry,
} from '../domain/types.js';
import { describeRecurrence, visitsForDay } from '../domain/visits.js';
import { isPrivacyHour } from '../domain/decide.js';

/** View models shared by MCP structuredContent, the TV API and MCP Apps cards. */

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

export interface AlertView {
  id: string;
  kind: Alert['kind'];
  status: Alert['status'];
  createdAt: string;
  createdLabel: string;
  description: string;
  visitLabel?: string;
  riskLevel?: 'elevated' | 'high';
  signs: SignView[];
  caregiverName: string;
  pauseMessage?: { from: string; text: string; videoUrl?: string };
  resolution?: Alert['resolution'];
  resolvedLabel?: string;
}

export interface TodayView {
  householdName: string;
  residentName: string;
  caregiverName: string;
  date: string;
  dateLabel: string;
  timeLabel: string;
  /** Present only for the resident (her reminders are hers, privacy rule 2). */
  reminders?: Array<{ id: string; text: string; timeLabel: string; flagged: boolean }>;
  visits: Array<{ id: string; label: string; timeLabel: string }>;
  messages: Array<{ id: string; from: string; text: string; timeLabel: string; unread: boolean }>;
  safety: SafetyView;
  activeAlert?: AlertView;
  privacyHourUntilLabel?: string;
}

export interface TimelineView {
  date: string;
  dateLabel: string;
  residentName: string;
  entries: Array<{ at: string; timeLabel: string; kind: TimelineEntry['kind']; text: string }>;
  summary: { pausesShown: number; unexpectedVisitors: number; expectedVisitors: number; flaggedCalls: number };
}

export function signsFor(categories: readonly SignalCategory[]): SignView[] {
  return categories.map((key) => {
    const r = ruleFor(key);
    return { key, label: r.label, explanation: r.explanation };
  });
}

export function resident(state: HouseholdState): Member {
  const m = state.household.members.find((x) => x.role === 'resident');
  if (!m) throw new Error(`Household ${state.household.id} has no resident`);
  return m;
}

export function caregivers(state: HouseholdState): Member[] {
  return state.household.members.filter((x) => x.role === 'caregiver');
}

export function primaryCaregiverName(state: HouseholdState): string {
  return caregivers(state)[0]?.name ?? 'your family';
}

export function dateLabel(instant: Date, timeZone: string): string {
  return instant.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone });
}

export function safetyView(state: HouseholdState, now: Date): SafetyView {
  const w = state.riskWindow;
  if (!isWindowActive(w, now)) return { level: 'none', signs: [] };
  return {
    level: w.level,
    untilLabel: formatClock(new Date(w.expiresAt), state.household.timezone),
    signs: signsFor(w.categories),
  };
}

export function alertView(state: HouseholdState, alert: Alert): AlertView {
  const tz = state.household.timezone;
  return {
    id: alert.id,
    kind: alert.kind,
    status: alert.status,
    createdAt: alert.createdAt,
    createdLabel: formatClock(new Date(alert.createdAt), tz),
    description: alert.description,
    visitLabel: alert.visitLabel,
    riskLevel: alert.riskLevel,
    signs: signsFor(alert.categories ?? []),
    caregiverName: primaryCaregiverName(state),
    pauseMessage: alert.kind === 'pause' ? state.household.pauseMessage : undefined,
    resolution: alert.resolution,
    resolvedLabel: alert.resolvedAt ? formatClock(new Date(alert.resolvedAt), tz) : undefined,
  };
}

const ALERT_PRIORITY: Record<Alert['kind'], number> = { pause: 0, gentle: 1, expected: 2 };

export function activeAlert(state: HouseholdState): Alert | undefined {
  return state.alerts
    .filter((a) => a.status === 'active')
    .sort((a, b) => ALERT_PRIORITY[a.kind] - ALERT_PRIORITY[b.kind] || Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export function todayView(state: HouseholdState, now: Date, includeReminders: boolean): TodayView {
  const tz = state.household.timezone;
  const local = zonedParts(now, tz);
  const alert = activeAlert(state);
  return {
    householdName: state.household.name,
    residentName: resident(state).name,
    caregiverName: primaryCaregiverName(state),
    date: local.date,
    dateLabel: dateLabel(now, tz),
    timeLabel: formatClock(now, tz),
    reminders: includeReminders
      ? state.reminders
          .filter((r) => zonedParts(new Date(r.at), tz).date === local.date)
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          .map((r) => ({
            id: r.id,
            text: r.text,
            timeLabel: formatClock(new Date(r.at), tz),
            flagged: r.screening.level !== 'none',
          }))
      : undefined,
    visits: visitsForDay(state.expectedVisits, now, tz).map((v) => ({
      id: v.id,
      label: v.label,
      timeLabel: describeRecurrence(v.recurrence).replace(/^\S+ /, ''),
    })),
    messages: state.messages.slice(0, 5).map((m) => ({
      id: m.id,
      from: m.from,
      text: m.text,
      timeLabel: formatClock(new Date(m.at), tz),
      unread: !m.readAt,
    })),
    safety: safetyView(state, now),
    activeAlert: alert ? alertView(state, alert) : undefined,
    privacyHourUntilLabel: isPrivacyHour(state.privacyHourUntil, now)
      ? formatClock(new Date(state.privacyHourUntil!), tz)
      : undefined,
  };
}

export function timelineView(state: HouseholdState, day: Date, residentName: string): TimelineView {
  const tz = state.household.timezone;
  const date = zonedParts(day, tz).date;
  // The timeline is stored newest-first; reverse before the (stable) sort so entries written in the
  // same instant keep the order they happened in (e.g. "unexpected visitor" before "Pause shown").
  const entries = state.timeline
    .slice()
    .reverse()
    .filter((e) => zonedParts(new Date(e.at), tz).date === date)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const count = (k: TimelineEntry['kind']) => entries.filter((e) => e.kind === k).length;
  return {
    date,
    dateLabel: dateLabel(day, tz),
    residentName,
    entries: entries.map((e) => ({ at: e.at, timeLabel: formatClock(new Date(e.at), tz), kind: e.kind, text: e.text })),
    summary: {
      pausesShown: count('pause_shown'),
      unexpectedVisitors: count('visitor_unexpected'),
      expectedVisitors: count('visitor_expected'),
      flaggedCalls: count('call_checked'),
    },
  };
}
