import { randomUUID } from 'node:crypto';
import { decideOnVisitor, isPrivacyHour } from '../domain/decide.js';
import { closeRiskWindow, isWindowActive, updateRiskWindow } from '../domain/risk.js';
import { screen } from '../domain/screening.js';
import { addMinutes, formatClock } from '../domain/time.js';
import {
  CAPS,
  type AccessEntry,
  type Alert,
  type AlertAction,
  type Consent,
  type ExpectedVisit,
  type HouseholdState,
  type Recurrence,
  type RiskLevel,
  type SignalCategory,
  type TimelineEntry,
  type TvCue,
  type VisitorEvent,
} from '../domain/types.js';
import { describeRecurrence, validateRecurrence } from '../domain/visits.js';
import { actsAsResident, PermissionError, type Identity } from '../auth/identity.js';
import { ConflictError, type Store } from '../store/store.js';
import type { CaregiverNotice, Notifier } from './notifier.js';
import {
  activeAlert,
  alertView,
  caregivers,
  primaryCaregiverName,
  resident,
  safetyView,
  signsFor,
  spokenDay,
  spokenMessages,
  timelineView,
  todayView,
  type AlertView,
  type SafetyView,
  type SignView,
  type TimelineView,
  type TodayView,
} from './views.js';

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export type IdGen = (prefix: string) => string;
export const randomIds: IdGen = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const ALERT_MINUTES: Record<Alert['kind'], number> = { pause: 30, gentle: 30, expected: 3 };

const CONSENT_KEYS = ['scamScreening', 'doorAwareness', 'caregiverAlerts', 'shareTimelineWithCaregiver'] as const;

export interface ScreeningView {
  mode: 'reminder' | 'check';
  level: RiskLevel;
  signs: SignView[];
  advice: string[];
  followUp?: string;
  riskWindow: SafetyView;
  caregiverName: string;
  reminder?: { id: string; text: string; timeLabel: string };
}

export interface TvStateView {
  household: { id: string; name: string; timezone: string };
  resident: { id: string; name: string };
  caregiver: { name: string; relationship?: string };
  today: TodayView;
  activeAlert?: AlertView;
  pendingProposals: Array<{ id: string; label: string; when: string; proposedBy: string }>;
  consent: Consent;
  privacyHourUntil?: string;
  accessLog: Array<{ timeLabel: string; actor: string; action: string }>;
  /** What Alexa last asked the TV to read aloud, for two minutes. */
  cue?: { id: string; topic: TvCue['topic']; text: string };
  serverTime: string;
}

/** How long a "read it on the TV" request stays pending for a TV that is polling. */
export const TV_CUE_MS = 2 * 60_000;

export interface ExplainView {
  alert?: AlertView;
  riskWindow: SafetyView;
  summary: string;
}

export interface IngestResult {
  duplicate: boolean;
  decision: 'ignored' | 'activity' | 'expected' | 'pause' | 'gentle';
  alertId?: string;
}

interface Pending {
  notices: CaregiverNotice[];
}

export function adviceFor(level: RiskLevel, categories: readonly SignalCategory[], caregiverName: string): string[] {
  const advice =
    level === 'high'
      ? [
          "Don't hand anything to anyone who comes to the door.",
          `Hang up and call ${caregiverName}, or your bank using the number on the back of your card.`,
          "It's okay to say no. A real bank or agency will never be upset by that.",
        ]
      : level === 'elevated'
        ? ['Before you do anything, check with someone you trust.', `You can ask me to call ${caregiverName}.`]
        : [
            "I don't see common scam warning signs here.",
            "If anything feels off, it's always okay to hang up and call back on a number you trust.",
          ];
  if (categories.includes('remote_access')) advice.push("Don't install anything or read out any codes.");
  return advice;
}

export class KinwiseService {
  private readonly store: Store;
  private readonly notifier: Notifier;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(deps: { store: Store; notifier: Notifier; clock?: Clock; ids?: IdGen }) {
    this.store = deps.store;
    this.notifier = deps.notifier;
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? randomIds;
  }

  // ───────────────────────────── infrastructure ─────────────────────────────

  async createHousehold(state: HouseholdState): Promise<void> {
    await this.store.save({ ...state, version: 1 }, 0);
  }

  async exists(householdId: string): Promise<boolean> {
    return (await this.store.load(householdId)) !== undefined;
  }

  /** Side-effect-free lookup (no access logging) for infrastructure callers. */
  async timezoneOf(householdId: string): Promise<string> {
    const { state } = await this.read(householdId);
    return state.household.timezone;
  }

  private async read(householdId: string): Promise<{ state: HouseholdState; now: Date }> {
    const state = await this.store.load(householdId);
    if (!state) throw new NotFoundError(`Unknown household ${householdId}`);
    const now = this.clock.now();
    expireAlerts(state, now);
    return { state, now };
  }

  /** Load → mutate draft → cap → save with optimistic concurrency; notices are sent only after a successful save. */
  private async mutate<T>(householdId: string, fn: (s: HouseholdState, now: Date, p: Pending) => T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const { state, now } = await this.read(householdId);
      const expected = state.version;
      const pending: Pending = { notices: [] };
      const result = fn(state, now, pending);
      capArrays(state);
      state.version = expected + 1;
      try {
        await this.store.save(state, expected);
      } catch (err) {
        if (err instanceof ConflictError && attempt < 4) continue;
        throw err;
      }
      for (const n of pending.notices) await this.notifier.notify(n);
      return result;
    }
  }

  private requireResident(actor: Identity): void {
    if (!actsAsResident(actor)) throw new PermissionError('Only the resident can do this');
  }

  private requirePerson(actor: Identity): void {
    if (actor.role === 'service') throw new PermissionError('A person must make this request');
  }

  // ───────────────────────────── resident voice flows ─────────────────────────────

  /** Spec §5.2–5.4: save a reminder and screen it for scam warning signs. */
  async addReminder(actor: Identity, input: { text: string; at: string }): Promise<ScreeningView> {
    this.requireResident(actor);
    const text = input.text.trim();
    if (!text) throw new ValidationError('Reminder text is required');
    if (text.length > 500) throw new ValidationError('Reminder text is too long');
    if (Number.isNaN(Date.parse(input.at))) throw new ValidationError('Reminder time must be an ISO date-time');

    return this.mutate(actor.householdId, (s, now, pending) => {
      const tz = s.household.timezone;
      const screening = s.consent.scamScreening ? screen(text) : { level: 'none' as const, categories: [] };
      const reminder = {
        id: this.ids('rem'),
        text,
        at: new Date(input.at).toISOString(),
        createdBy: actor.userId,
        createdAt: now.toISOString(),
        screening,
      };
      s.reminders.unshift(reminder);

      if (screening.categories.length > 0) {
        s.signals.unshift({ at: now.toISOString(), source: 'reminder', categories: screening.categories, level: screening.level });
        this.applyWindow(s, now, pending);
      }
      if (screening.level !== 'none') {
        addTimeline(s, now, 'reminder_flagged', `A reminder matched scam warning signs (${labels(screening.categories)}).`);
      }

      const window = safetyView(s, now);
      const flagged = screening.level !== 'none' || (window.level !== 'none' && screening.categories.length > 0);
      return {
        mode: 'reminder' as const,
        level: maxLevelOf(screening.level, flagged ? window.level : 'none'),
        signs: signsFor(screening.categories),
        advice: flagged ? adviceFor(window.level, screening.categories, primaryCaregiverName(s)) : [],
        followUp: flagged
          ? 'Banks and agencies never send couriers to collect money or valuables. Did someone call you about your accounts? You can ask me, "Is this call real?"'
          : undefined,
        riskWindow: window,
        caregiverName: primaryCaregiverName(s),
        reminder: { id: reminder.id, text: reminder.text, timeLabel: formatClock(new Date(reminder.at), tz) },
      };
    });
  }

  /** "Is this call legit?" — privacy rule 3: the description itself is never stored. */
  async checkCall(actor: Identity, input: { description: string }): Promise<ScreeningView> {
    this.requireResident(actor);
    const description = input.description.trim();
    if (!description) throw new ValidationError('Tell me what the caller said');
    if (description.length > 2000) throw new ValidationError('Description is too long');

    return this.mutate(actor.householdId, (s, now, pending) => {
      const screening = screen(description);
      let level = screening.level;
      let categories = screening.categories;

      if (s.consent.scamScreening && screening.categories.length > 0) {
        s.signals.unshift({ at: now.toISOString(), source: 'check', categories: screening.categories, level: screening.level });
        this.applyWindow(s, now, pending);
        const window = s.riskWindow;
        if (isWindowActive(window, now)) {
          level = maxLevelOf(level, window.level);
          categories = window.categories;
        }
      }
      if (level !== 'none') {
        addTimeline(s, now, 'call_checked', `${resident(s).name} asked Kinwise to check a call: ${categories.length} warning signs.`);
      }
      return {
        mode: 'check' as const,
        level,
        signs: signsFor(categories),
        advice: adviceFor(level, categories, primaryCaregiverName(s)),
        riskWindow: safetyView(s, now),
        caregiverName: primaryCaregiverName(s),
      };
    });
  }

  /** Open / upgrade / extend the risk window from the stored signals; notify family when it becomes high. */
  private applyWindow(s: HouseholdState, now: Date, pending: Pending): void {
    const { window, change } = updateRiskWindow(s.riskWindow, s.signals, now, () => this.ids('win'));
    s.riskWindow = window;
    if (!window || change === 'none' || change === 'extended') return;
    const until = formatClock(new Date(window.expiresAt), s.household.timezone);
    addTimeline(
      s,
      now,
      'window_opened',
      `Kinwise is watching the door more closely until ${until} (${window.level === 'high' ? 'high' : 'elevated'} risk).`,
    );
    if (window.level === 'high' && s.consent.caregiverAlerts) {
      for (const c of caregivers(s)) {
        pending.notices.push({
          householdId: s.household.id,
          caregiverId: c.id,
          caregiverName: c.name,
          kind: 'risk_high',
          title: `${resident(s).name} may be talking to a scammer`,
          body: `Kinwise noticed courier-scam warning signs and is watching the door until ${until}. A quick call from you could help.`,
          at: now.toISOString(),
        });
      }
    }
  }

  async closeRiskWindow(actor: Identity, reason = 'Resident said everything is fine'): Promise<SafetyView> {
    this.requireResident(actor);
    return this.mutate(actor.householdId, (s, now) => {
      if (isWindowActive(s.riskWindow, now)) {
        s.riskWindow = closeRiskWindow(s.riskWindow, now, reason);
        addTimeline(s, now, 'window_closed', `${resident(s).name} closed the safety window.`);
      }
      return safetyView(s, now);
    });
  }

  // ───────────────────────────── today / visits / messages ─────────────────────────────

  async getToday(actor: Identity): Promise<TodayView> {
    this.requirePerson(actor);
    if (actor.role === 'caregiver') {
      return this.mutate(actor.householdId, (s, now) => {
        logAccess(s, now, actor, "viewed today's overview");
        return todayView(s, now, false);
      });
    }
    const { state, now } = await this.read(actor.householdId);
    return todayView(state, now, true);
  }

  async addExpectedVisit(
    actor: Identity,
    input: { label: string; recurrence: Recurrence },
  ): Promise<{ visit: ExpectedVisit; description: string; needsApproval: boolean }> {
    this.requirePerson(actor);
    const label = input.label.trim();
    if (!label) throw new ValidationError('Who is visiting?');
    try {
      validateRecurrence(input.recurrence);
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
    const proposed = actor.role === 'caregiver';
    return this.mutate(actor.householdId, (s, now) => {
      const visit: ExpectedVisit = {
        id: this.ids('visit'),
        label,
        recurrence: input.recurrence,
        status: proposed ? 'proposed' : 'active',
        createdBy: actor.userId,
        createdAt: now.toISOString(),
      };
      s.expectedVisits.push(visit);
      const description = describeRecurrence(visit.recurrence);
      if (proposed) {
        logAccess(s, now, actor, `proposed an expected visit (${label})`);
        addTimeline(s, now, 'visit_proposed', `${actor.name} proposed "${label}" (${description}). Waiting for ${resident(s).name}'s approval.`);
      }
      return { visit, description, needsApproval: proposed };
    });
  }

  async decideProposal(actor: Identity, visitId: string, decision: 'approve' | 'decline'): Promise<ExpectedVisit> {
    this.requireResident(actor);
    return this.mutate(actor.householdId, (s, now) => {
      const visit = s.expectedVisits.find((v) => v.id === visitId);
      if (!visit || visit.status !== 'proposed') throw new NotFoundError('No pending proposal with that id');
      if (decision === 'approve') {
        visit.status = 'active';
        addTimeline(s, now, 'visit_approved', `${resident(s).name} approved "${visit.label}".`);
      } else {
        s.expectedVisits = s.expectedVisits.filter((v) => v.id !== visitId);
        addTimeline(s, now, 'visit_declined', `${resident(s).name} declined "${visit.label}".`);
      }
      return visit;
    });
  }

  async sendFamilyMessage(actor: Identity, text: string): Promise<{ id: string; deliveredTo: string }> {
    if (actor.role !== 'caregiver') throw new PermissionError('Only family members can send messages');
    const body = text.trim();
    if (!body) throw new ValidationError('Message is empty');
    if (body.length > 280) throw new ValidationError('Keep messages under 280 characters so they are easy to read on TV');
    return this.mutate(actor.householdId, (s, now) => {
      const id = this.ids('msg');
      s.messages.unshift({ id, from: actor.name, text: body, at: now.toISOString() });
      logAccess(s, now, actor, 'sent a message to the TV');
      addTimeline(s, now, 'message_sent', `${actor.name} sent a message to the TV.`);
      return { id, deliveredTo: `${resident(s).name}'s TV` };
    });
  }

  /** Quietly clear an "expected visitor" toast once the TV has shown it (no timeline noise). */
  async acknowledgeAlert(actor: Identity, alertId: string): Promise<void> {
    this.requireResident(actor);
    await this.mutate(actor.householdId, (s, now) => {
      const alert = s.alerts.find((a) => a.id === alertId);
      if (!alert) throw new NotFoundError('No such alert');
      if (alert.kind !== 'expected') throw new ValidationError('Only expected-visitor notices can be acknowledged silently');
      if (alert.status === 'active') {
        alert.status = 'resolved';
        alert.resolution = 'dismiss';
        alert.resolvedAt = now.toISOString();
        alert.resolvedBy = actor.userId;
      }
    });
  }

  async markMessageRead(actor: Identity, messageId: string): Promise<void> {
    this.requireResident(actor);
    await this.mutate(actor.householdId, (s, now) => {
      const m = s.messages.find((x) => x.id === messageId);
      if (!m) throw new NotFoundError('No such message');
      m.readAt ??= now.toISOString();
    });
  }

  // ───────────────────────────── consent & privacy ─────────────────────────────

  async updateConsent(actor: Identity, patch: Partial<Omit<Consent, 'onboardedAt'>> & { onboarded?: boolean }): Promise<Consent> {
    this.requireResident(actor);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('Settings must be an object');
    const { onboarded, ...rest } = patch;
    const updates: Partial<Consent> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (!CONSENT_KEYS.includes(k as (typeof CONSENT_KEYS)[number])) throw new ValidationError(`Unknown setting "${k}"`);
      if (typeof v !== 'boolean') throw new ValidationError(`${k} must be true or false`);
      updates[k as (typeof CONSENT_KEYS)[number]] = v;
    }
    if (onboarded !== undefined && typeof onboarded !== 'boolean') throw new ValidationError('onboarded must be true or false');
    return this.mutate(actor.householdId, (s, now) => {
      s.consent = { ...s.consent, ...updates };
      if (onboarded) s.consent.onboardedAt ??= now.toISOString();
      addTimeline(s, now, 'consent_changed', `${resident(s).name} updated Kinwise settings.`);
      return s.consent;
    });
  }

  async setPrivacyHour(actor: Identity, minutes: number): Promise<{ until?: string; untilLabel?: string }> {
    this.requireResident(actor);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 12 * 60) {
      throw new ValidationError('Privacy time must be between 0 and 720 minutes');
    }
    return this.mutate(actor.householdId, (s, now) => {
      if (minutes === 0) {
        s.privacyHourUntil = undefined;
        addTimeline(s, now, 'privacy_hour', 'Privacy time ended.');
        return {};
      }
      s.privacyHourUntil = addMinutes(now, minutes);
      // Signals, not content: the caregiver only learns that privacy time started.
      addTimeline(s, now, 'privacy_hour', 'Privacy time started.');
      return { until: s.privacyHourUntil, untilLabel: formatClock(new Date(s.privacyHourUntil), s.household.timezone) };
    });
  }

  // ───────────────────────────── alerts ─────────────────────────────

  async respondToAlert(actor: Identity, alertId: string, action: AlertAction): Promise<{ alert: AlertView; message: string }> {
    this.requireResident(actor);
    return this.mutate(actor.householdId, (s, now, pending) => {
      const alert = s.alerts.find((a) => a.id === alertId);
      if (!alert) throw new NotFoundError('No such alert');
      if (alert.status !== 'active') throw new ValidationError('That alert is no longer active');
      alert.status = 'resolved';
      alert.resolution = action;
      alert.resolvedAt = now.toISOString();
      alert.resolvedBy = actor.userId;
      const residentName = resident(s).name;
      const caregiverName = primaryCaregiverName(s);
      let message: string;
      if (action === 'call_family') {
        message = `Calling ${caregiverName} now.`;
        addTimeline(s, now, 'alert_resolved', `${residentName} chose "Call ${caregiverName}".`);
        // The TV acts through its device identity; voice requests come from the resident on the Echo.
        const surface = actor.role === 'device' ? 'the TV' : 'the Echo Show';
        for (const c of caregivers(s)) {
          pending.notices.push({
            householdId: s.household.id,
            caregiverId: c.id,
            caregiverName: c.name,
            kind: 'call_request',
            title: `${residentName} wants to talk to you now`,
            body: `${residentName} chose "Call ${c.name}" on ${surface} during a Kinwise Pause. Please call now.`,
            at: now.toISOString(),
          });
        }
      } else if (action === 'known_person') {
        message = 'Okay. You can add them as an expected visitor so I remember next time.';
        addTimeline(s, now, 'alert_resolved', `${residentName} said they know the visitor.`);
      } else {
        message = 'Okay, I closed the alert.';
        addTimeline(s, now, 'alert_resolved', `${residentName} dismissed the alert.`);
      }
      return { alert: alertView(s, alert), message };
    });
  }

  async explainLastAlert(actor: Identity): Promise<ExplainView> {
    this.requirePerson(actor);
    const build = (s: HouseholdState, now: Date): ExplainView => {
      const last = s.alerts.find((a) => a.kind !== 'expected');
      const risk = safetyView(s, now);
      if (!last) return { riskWindow: risk, summary: 'There have been no alerts recently.' };
      const view = alertView(s, last);
      const why =
        last.kind === 'pause'
          ? `A visitor nobody expected arrived while Kinwise was watching for a possible scam (${view.signs.map((x) => x.label.toLowerCase()).join(', ')}).`
          : 'A visitor arrived who was not on the expected list. No scam warning signs were active.';
      const outcome = last.resolution
        ? ` ${resident(s).name} chose "${resolutionLabel(last.resolution, view.caregiverName)}" at ${view.resolvedLabel}.`
        : last.status === 'active'
          ? ' It is still showing on the TV.'
          : '';
      return { alert: view, riskWindow: risk, summary: `At ${view.createdLabel}: ${why}${outcome}` };
    };
    if (actor.role === 'caregiver') {
      return this.mutate(actor.householdId, (s, now) => {
        logAccess(s, now, actor, 'viewed the last alert');
        return build(s, now);
      });
    }
    const { state, now } = await this.read(actor.householdId);
    return build(state, now);
  }

  async getTimeline(actor: Identity, day?: string): Promise<TimelineView> {
    this.requirePerson(actor);
    const when = day ? new Date(`${day}T12:00:00Z`) : undefined;
    if (when && Number.isNaN(when.getTime())) throw new ValidationError('date must be YYYY-MM-DD');
    if (actor.role === 'caregiver') {
      return this.mutate(actor.householdId, (s, now) => {
        if (!s.consent.shareTimelineWithCaregiver) {
          throw new PermissionError(`${resident(s).name} has chosen not to share the day timeline.`);
        }
        logAccess(s, now, actor, "viewed the day's timeline");
        return timelineView(s, when ?? now, resident(s).name);
      });
    }
    const { state, now } = await this.read(actor.householdId);
    return timelineView(state, when ?? now, resident(state).name);
  }

  // ───────────────────────────── door events ─────────────────────────────

  /** Spec §5.6 + §6.3: idempotent on eventId. Frames never reach the hub — only neutral perception. */
  async ingestVisitor(householdId: string, event: VisitorEvent): Promise<IngestResult> {
    if (!event.eventId) throw new ValidationError('eventId is required');
    if (Number.isNaN(Date.parse(event.occurredAt))) throw new ValidationError('occurredAt must be an ISO date-time');
    return this.mutate(householdId, (s, now, pending): IngestResult => {
      if (s.processedEventIds.includes(event.eventId)) {
        return { duplicate: true, decision: 'ignored' };
      }
      s.processedEventIds.unshift(event.eventId);
      const decision = decideOnVisitor(
        {
          consent: s.consent,
          privacyHourUntil: s.privacyHourUntil,
          riskWindow: s.riskWindow,
          expectedVisits: s.expectedVisits,
          timezone: s.household.timezone,
        },
        event,
        now,
      );

      if (decision.kind === 'ignored') {
        s.ignoredDoorEvents += 1; // privacy hour / door awareness off: keep nothing but a counter
        return { duplicate: false, decision: 'ignored' };
      }
      s.visitorEvents.unshift({ ...event, perception: { ...event.perception } });
      if (decision.kind === 'activity') return { duplicate: false, decision: 'activity' };

      const residentName = resident(s).name;
      const base = {
        id: this.ids('alert'),
        createdAt: now.toISOString(),
        status: 'active' as const,
        visitorEventId: event.eventId,
        description: event.perception.description,
      };

      if (decision.kind === 'expected') {
        const alert: Alert = {
          ...base,
          kind: 'expected',
          expiresAt: addMinutes(now, ALERT_MINUTES.expected),
          visitLabel: decision.visit.label,
        };
        s.alerts.unshift(alert);
        addTimeline(s, now, 'visitor_expected', `Expected visitor: ${decision.visit.label}.`);
        return { duplicate: false, decision: 'expected', alertId: alert.id };
      }

      // A new door alert supersedes any older active door alert.
      for (const a of s.alerts) if (a.status === 'active') a.status = 'expired';

      if (decision.kind === 'gentle') {
        const alert: Alert = { ...base, kind: 'gentle', expiresAt: addMinutes(now, ALERT_MINUTES.gentle) };
        s.alerts.unshift(alert);
        addTimeline(s, now, 'visitor_unexpected', "A visitor who isn't on today's list came to the door.");
        return { duplicate: false, decision: 'gentle', alertId: alert.id };
      }

      const alert: Alert = {
        ...base,
        kind: 'pause',
        expiresAt: addMinutes(now, ALERT_MINUTES.pause),
        riskLevel: decision.level,
        categories: decision.categories,
      };
      s.alerts.unshift(alert);
      addTimeline(s, now, 'visitor_unexpected', 'An unexpected visitor came to the door.');
      addTimeline(s, now, 'pause_shown', `The Pause was shown on ${residentName}'s TV.`);
      if (decision.notifyCaregiver) {
        for (const c of caregivers(s)) {
          pending.notices.push({
            householdId: s.household.id,
            caregiverId: c.id,
            caregiverName: c.name,
            kind: 'pause',
            title: `Kinwise paused a visit at ${residentName}'s door`,
            body: `An unexpected visitor arrived while Kinwise was watching for a possible courier scam. ${residentName} sees your message on the TV.`,
            at: now.toISOString(),
          });
        }
      }
      return { duplicate: false, decision: 'pause', alertId: alert.id };
    });
  }

  // ───────────────────────────── TV ─────────────────────────────

  /** Alexa → TV: the TV reads the family messages or today's plan aloud (it picks this up within one poll). */
  async readOnTv(actor: Identity, topic: TvCue['topic']): Promise<{ topic: TvCue['topic']; text: string; deliveredTo: string }> {
    this.requireResident(actor);
    if (topic !== 'messages' && topic !== 'today') throw new ValidationError('topic must be messages or today');
    return this.mutate(actor.householdId, (s, now) => {
      const view = todayView(s, now, true);
      const text = topic === 'messages' ? spokenMessages(view) : spokenDay(view);
      s.tvCue = { id: this.ids('cue'), topic, text, at: now.toISOString() };
      return { topic, text, deliveredTo: `${resident(s).name}'s TV` };
    });
  }

  async tvState(actor: Identity): Promise<TvStateView> {
    this.requireResident(actor);
    const { state, now } = await this.read(actor.householdId);
    const alert = activeAlert(state);
    const cg = caregivers(state)[0];
    const tz = state.household.timezone;
    return {
      household: { id: state.household.id, name: state.household.name, timezone: tz },
      resident: { id: resident(state).id, name: resident(state).name },
      caregiver: { name: cg?.name ?? 'Family', relationship: cg?.relationship },
      today: todayView(state, now, true),
      activeAlert: alert ? alertView(state, alert) : undefined,
      pendingProposals: state.expectedVisits
        .filter((v) => v.status === 'proposed')
        .map((v) => ({
          id: v.id,
          label: v.label,
          when: describeRecurrence(v.recurrence),
          proposedBy: state.household.members.find((m) => m.id === v.createdBy)?.name ?? 'Family',
        })),
      consent: state.consent,
      privacyHourUntil: isPrivacyHour(state.privacyHourUntil, now) ? state.privacyHourUntil : undefined,
      accessLog: state.accessLog.slice(0, 20).map((e) => ({ timeLabel: formatClock(new Date(e.at), tz), actor: e.actor, action: e.action })),
      cue:
        state.tvCue && now.getTime() - Date.parse(state.tvCue.at) < TV_CUE_MS
          ? { id: state.tvCue.id, topic: state.tvCue.topic, text: state.tvCue.text }
          : undefined,
      serverTime: now.toISOString(),
    };
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function maxLevelOf(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank = { none: 0, elevated: 1, high: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function labels(categories: readonly SignalCategory[]): string {
  return signsFor(categories)
    .map((s) => s.label.toLowerCase())
    .join(', ');
}

function resolutionLabel(action: AlertAction, caregiverName: string): string {
  return action === 'call_family' ? `Call ${caregiverName}` : action === 'known_person' ? 'I know this person' : 'Dismiss';
}

function addTimeline(s: HouseholdState, now: Date, kind: TimelineEntry['kind'], text: string): void {
  s.timeline.unshift({ at: now.toISOString(), kind, text });
}

function logAccess(s: HouseholdState, now: Date, actor: Identity, action: string): void {
  const entry: AccessEntry = { at: now.toISOString(), actor: actor.name, action };
  s.accessLog.unshift(entry);
}

export function expireAlerts(s: HouseholdState, now: Date): boolean {
  let changed = false;
  for (const a of s.alerts) {
    if (a.status === 'active' && Date.parse(a.expiresAt) <= now.getTime()) {
      a.status = 'expired';
      changed = true;
    }
  }
  return changed;
}

function capArrays(s: HouseholdState): void {
  s.reminders.splice(CAPS.reminders);
  s.signals.splice(CAPS.signals);
  s.visitorEvents.splice(CAPS.visitorEvents);
  s.alerts.splice(CAPS.alerts);
  s.messages.splice(CAPS.messages);
  s.accessLog.splice(CAPS.accessLog);
  s.timeline.splice(CAPS.timeline);
  s.processedEventIds.splice(CAPS.processedEventIds);
}
