import { randomBytes, randomUUID } from 'node:crypto';
import { decideOnVisitor, isPrivacyHour } from '../domain/decide.js';
import { accumulate, closeRiskWindow, isWindowActive, RISK_WINDOW_HOURS, updateRiskWindow } from '../domain/risk.js';
import { screen } from '../domain/screening.js';
import { addMinutes, formatClock } from '../domain/time.js';
import {
  CAPS,
  type AccessEntry,
  type Alert,
  type AlertAction,
  type Consent,
  type ExpectedVisit,
  type Contacts,
  type HouseholdState,
  type StoredNotice,
  type Recurrence,
  type RiskLevel,
  type SignalCategory,
  type SignalRecord,
  type TimelineEntry,
  type TvCue,
  type VisitorEvent,
  type WatchOffer,
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
  /** Whether the safety watch is on, being offered, or was turned down. Nothing is watched until she says "turn on". */
  watch: WatchView;
  caregiverName: string;
  reminder?: { id: string; text: string; timeLabel: string };
}

/** How long a safety-watch question stays open, and how long "Not now" is respected before Kinwise may ask again. */
export const WATCH_OFFER_MS = 30 * 60_000;
export const WATCH_DECLINE_MS = 60 * 60_000;
export const WATCH_CHOICES = ['turn_on', 'not_now', 'review_privacy'] as const;
export type WatchChoice = (typeof WATCH_CHOICES)[number];

export interface WatchView {
  /** none: nothing flagged · offered: waiting for her answer · on: the watch is running · declined: she said "not now" */
  state: 'none' | 'offered' | 'on' | 'declined';
  untilLabel?: string;
  /** Who would be told if it looks serious: absent when family alerts are off. */
  offer?: { id: string; hours: number; expiresAt: string; notifies?: string };
}

export interface WatchResult {
  watch: WatchView;
  riskWindow: SafetyView;
  message: string;
  /** Only for "review privacy": what turning the watch on does and does not share. */
  privacy?: string[];
}

export interface TvStateView {
  household: { id: string; name: string; timezone: string };
  resident: { id: string; name: string };
  caregiver: { name: string; relationship?: string };
  today: TodayView;
  activeAlert?: AlertView;
  pendingProposals: Array<{ id: string; label: string; when: string; proposedBy: string }>;
  consent: Consent;
  /** The same answer the Alexa side gives: on, offered (with the question), declined or none. */
  watch: WatchView;
  privacyHourUntil?: string;
  accessLog: Array<{ timeLabel: string; actor: string; action: string }>;
  /** What Alexa last asked the TV to read aloud, for two minutes. */
  cue?: { id: string; topic: TvCue['topic']; text: string };
  /** The latest "Call" request while it is still within the hour: has anyone answered? */
  call?: CallView;
  serverTime: string;
}

export interface CallView {
  caregiverName: string;
  /** asked: just sent · waiting: no answer for 2 min and a second message went out · unanswered: still nothing after 5 min · confirmed: she said she is calling */
  status: 'asked' | 'waiting' | 'unanswered' | 'confirmed';
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

/** How long after pressing "Call Meera" her "I'm calling now" button still works. */
const CALL_CONFIRM_MS = 60 * 60_000;
/** No confirmation after this long: send the second message. After UNANSWERED_AFTER_MS the TV says plainly nobody has answered. */
export const RESEND_AFTER_MS = 2 * 60_000;
export const UNANSWERED_AFTER_MS = 5 * 60_000;

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

/** Subscribes a caregiver's e-mail to their own notices (and removes the old one). Absent where there is no SNS topic. */
export interface ContactSync {
  syncEmail(householdId: string, memberId: string, oldEmail: string | undefined, newEmail: string | undefined, newKey?: string): Promise<void>;
}

/** Wakes the hub up later (EventBridge Scheduler) so a follow-up does not depend on the TV polling. */
export interface FollowUpScheduler {
  schedule(householdId: string, callId: string, at: Date): Promise<void>;
}

export type ContactPatch = { [K in keyof Contacts]?: string | null };
export interface ContactsResult {
  contacts: Contacts;
  /** unchanged · confirmation_sent (they must click AWS's confirmation e-mail) · removed · failed */
  email: 'unchanged' | 'confirmation_sent' | 'removed' | 'failed';
}

const CONTACT_CHANGE_GAP_MS = 60_000;
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_SHAPE = /^\+[1-9]\d{7,14}$/;

function checkContact(kind: keyof Contacts, raw: string): string {
  const v = raw.trim();
  if (kind === 'email' ? !(EMAIL_SHAPE.test(v) && v.length <= 254) : !PHONE_SHAPE.test(v)) {
    throw new ValidationError(kind === 'email' ? 'That does not look like an e-mail address' : `The ${kind} number must look like +919876543210 (country code, digits only)`);
  }
  return v;
}

export class KinwiseService {
  private readonly store: Store;
  private readonly notifier: Notifier;
  private readonly clock: Clock;
  private readonly ids: IdGen;
  private readonly contactSync?: ContactSync;
  private readonly followUpScheduler?: FollowUpScheduler;

  constructor(deps: { store: Store; notifier: Notifier; clock?: Clock; ids?: IdGen; contactSync?: ContactSync; followUp?: FollowUpScheduler }) {
    this.contactSync = deps.contactSync;
    this.followUpScheduler = deps.followUp;
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
    return (await this.mutateNotifying(householdId, fn)).result;
  }

  /** Like `mutate`, and also says whether every notice reached the caregiver (true when there was nothing to send). */
  private async mutateNotifying<T>(
    householdId: string,
    fn: (s: HouseholdState, now: Date, p: Pending) => T,
  ): Promise<{ result: T; delivered: boolean }> {
    for (let attempt = 0; ; attempt++) {
      const { state, now } = await this.read(householdId);
      const expected = state.version;
      const pending: Pending = { notices: [] };
      const result = fn(state, now, pending);
      if (pending.notices.length) state.notices = [...[...pending.notices].reverse(), ...(state.notices ?? [])];
      capArrays(state);
      state.version = expected + 1;
      try {
        await this.store.save(state, expected);
      } catch (err) {
        if (err instanceof ConflictError && attempt < 4) continue;
        throw err;
      }
      let delivered = true;
      for (const n of pending.notices) delivered = (await this.notifier.notify(n)) && delivered;
      return { result, delivered };
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
        this.noteSigns(s, now, pending, { at: now.toISOString(), source: 'reminder', categories: screening.categories, level: screening.level });
      }
      if (screening.level !== 'none' && isWindowActive(s.riskWindow, now)) {
        addTimeline(s, now, 'reminder_flagged', `A reminder matched scam warning signs (${labels(screening.categories)}).`);
      }

      const window = safetyView(s, now);
      const open = openOffer(s, now);
      const seen = open ? accumulate(open.signals, now) : { level: 'none' as RiskLevel, categories: [] as SignalCategory[] };
      const shownLevel = maxLevelOf(window.level, seen.level);
      const flagged = screening.level !== 'none' || (shownLevel !== 'none' && screening.categories.length > 0);
      return {
        mode: 'reminder' as const,
        level: maxLevelOf(screening.level, flagged ? shownLevel : 'none'),
        signs: signsFor(screening.categories),
        advice: flagged ? adviceFor(shownLevel, screening.categories, primaryCaregiverName(s)) : [],
        watch: watchView(s, now),
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
        this.noteSigns(s, now, pending, { at: now.toISOString(), source: 'check', categories: screening.categories, level: screening.level });
        const window = s.riskWindow;
        const open = openOffer(s, now);
        if (isWindowActive(window, now)) {
          level = maxLevelOf(level, window.level);
          categories = window.categories;
        } else if (open) {
          const seen = accumulate(open.signals, now);
          level = maxLevelOf(level, seen.level);
          categories = seen.categories;
        }
      }
      if (level !== 'none' && isWindowActive(s.riskWindow, now)) {
        addTimeline(s, now, 'call_checked', `${resident(s).name} asked Kinwise to check a call: ${categories.length} warning signs.`);
      }
      return {
        mode: 'check' as const,
        level,
        signs: signsFor(categories),
        advice: adviceFor(level, categories, primaryCaregiverName(s)),
        riskWindow: safetyView(s, now),
        watch: watchView(s, now),
        caregiverName: primaryCaregiverName(s),
      };
    });
  }

  /**
   * A new warning sign never starts a watch by itself. While a watch she turned on is running it extends
   * that watch; otherwise it becomes (or joins) a question for her, unless she said "not now" in the last hour
   * or switched scam screening off. Nothing is recorded as a signal until she answers "turn on".
   */
  private noteSigns(s: HouseholdState, now: Date, pending: Pending, signal: SignalRecord): void {
    if (!s.consent.scamScreening || signal.categories.length === 0) return;
    if (isWindowActive(s.riskWindow, now)) {
      s.signals.unshift(signal);
      this.applyWindow(s, now, pending);
      return;
    }
    if (s.watchDeclinedUntil && Date.parse(s.watchDeclinedUntil) > now.getTime()) return;
    const expiresAt = addMinutes(now, WATCH_OFFER_MS / 60_000);
    const open = openOffer(s, now);
    if (open) {
      open.signals.unshift(signal);
      open.expiresAt = expiresAt;
      return;
    }
    s.watchOffer = { id: this.ids('offer'), createdAt: now.toISOString(), expiresAt, signals: [signal] };
  }

  /** Her answer to the safety-watch question (`offerId` omitted = the one open question). Only she (or her TV) can give it; a repeat does nothing twice. */
  async respondToWatch(actor: Identity, offerId: string | undefined, choice: WatchChoice): Promise<WatchResult> {
    this.requireResident(actor);
    if (!WATCH_CHOICES.includes(choice)) throw new ValidationError('choice must be turn_on, not_now or review_privacy');
    return this.mutate(actor.householdId, (s, now, pending) => {
      const name = resident(s).name;
      const family = s.consent.caregiverAlerts ? primaryCaregiverName(s) : undefined;
      const view = (message: string, privacy?: string[]): WatchResult => ({ watch: watchView(s, now), riskWindow: safetyView(s, now), message, privacy });

      const open = openOffer(s, now);
      if (!open || (offerId !== undefined && open.id !== offerId)) {
        const last = s.lastWatchAnswer;
        if (offerId !== undefined && last?.offerId === offerId && last.choice === choice) {
          return view(choice === 'turn_on' ? 'The safety watch is already on.' : "Okay, it's still off.");
        }
        throw new ValidationError('That question has run out. Ask me about the call again if you still want a safety watch.');
      }

      if (choice === 'review_privacy') return view('Here is what the safety watch does.', privacyLines(s, now));

      s.lastWatchAnswer = { offerId: open.id, choice: choice as 'turn_on' | 'not_now', at: now.toISOString() };
      s.watchOffer = undefined;
      if (choice === 'not_now') {
        s.watchDeclinedUntil = addMinutes(now, WATCH_DECLINE_MS / 60_000);
        addTimeline(s, now, 'watch_declined', `${name} chose not to turn on a safety watch.`);
        return view("Okay, I won't turn it on. I'm here if you change your mind.");
      }

      s.watchDeclinedUntil = undefined;
      for (const sig of [...open.signals].reverse()) {
        s.signals.unshift(sig);
        addTimeline(
          s,
          now,
          sig.source === 'check' ? 'call_checked' : 'reminder_flagged',
          sig.source === 'check'
            ? `${name} asked Kinwise to check a call: ${sig.categories.length} warning signs.`
            : `A reminder matched scam warning signs (${labels(sig.categories)}).`,
        );
      }
      addTimeline(s, now, 'watch_on', `${name} turned on a safety watch.`);
      this.applyWindow(s, now, pending);
      const until = s.riskWindow ? formatClock(new Date(s.riskWindow.expiresAt), s.household.timezone) : '';
      return view(`The safety watch is on until ${until}.${family ? ` I'll tell ${family} if it looks serious.` : ''}`);
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
  /**
   * Her TV says the Pause is on screen. Only the TV can know that, so this is the one thing that turns "sent" into
   * "shown" (it does not mean she looked). Repeats are harmless: the first one counts.
   */
  async markAlertShown(actor: Identity, alertId: string): Promise<void> {
    this.requireResident(actor);
    await this.mutate(actor.householdId, (s, now) => {
      const alert = s.alerts.find((a) => a.id === alertId);
      if (!alert) throw new NotFoundError('No such alert');
      if (alert.kind !== 'pause' || alert.shownAt) return;
      alert.shownAt = now.toISOString();
      addTimeline(s, now, 'pause_shown', `The Pause appeared on ${resident(s).name}'s TV.`);
    });
  }

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
      if (!s.consent.scamScreening) s.watchOffer = undefined;
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

  async respondToAlert(actor: Identity, alertId: string, action: AlertAction): Promise<{ alert: AlertView; message: string; delivered?: boolean }> {
    this.requireResident(actor);
    let askedCall: string | undefined;
    const { result, delivered } = await this.mutateNotifying(actor.householdId, (s, now, pending) => {
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
        const callId = this.ids('call');
        askedCall = callId;
        s.callRequest = { id: callId, requestedAt: now.toISOString() };
        for (const c of caregivers(s)) {
          pending.notices.push({
            householdId: s.household.id,
            caregiverId: c.id,
            caregiverName: c.name,
            kind: 'call_request',
            title: `${residentName} wants to talk to you now`,
            body: `${residentName} chose "Call ${c.name}" on ${surface} during a Kinwise Pause. Please call now.`,
            at: now.toISOString(),
            callId,
          });
        }
      } else if (action === 'known_person') {
        message = 'Okay. You can add them as an expected visitor so I remember next time.';
        addTimeline(s, now, 'alert_resolved', `${residentName} said they know the visitor.`);
      } else {
        message = 'Okay, I closed the alert.';
        addTimeline(s, now, 'alert_resolved', `${residentName} dismissed the alert.`);
      }
      return { alert: alertView(s, alert, { forResident: true, now }), message, caregiverName };
    });
    if (askedCall) await this.scheduleFollowUp(actor.householdId, askedCall);
    const { caregiverName, ...view } = result;
    if (action !== 'call_family') return view;
    if (delivered) return { ...view, delivered };
    // Do not let the TV promise a call nobody was told about.
    return { ...view, message: `I couldn't reach ${caregiverName}. Please try calling ${caregiverName} yourself.`, delivered };
  }

  /** The caregiver, signed in, says she is calling. */
  async acknowledgeCall(actor: Identity, callId: string): Promise<void> {
    if (actor.role !== 'caregiver') throw new PermissionError('Only family members can confirm a call');
    await this.confirmCall(actor.householdId, callId);
  }

  /** The caregiver pressed the button in her phone notification: the signed link already proved which call it is. */
  async acknowledgeCallByLink(householdId: string, callId: string): Promise<void> {
    await this.confirmCall(householdId, callId);
  }

  private async confirmCall(householdId: string, callId: string): Promise<void> {
    await this.mutate(householdId, (s, now) => {
      const call = s.callRequest;
      if (!call || call.id !== callId) throw new NotFoundError('No such call request');
      if (call.ackedAt) return; // pressed twice: nothing more to say
      if (now.getTime() - Date.parse(call.requestedAt) > CALL_CONFIRM_MS) throw new ValidationError('This call request has expired');
      call.ackedAt = now.toISOString();
      const name = primaryCaregiverName(s);
      s.messages.unshift({ id: this.ids('msg'), from: name, text: "I got your request and I'm calling you now.", at: now.toISOString() });
      addTimeline(s, now, 'alert_resolved', `${name} confirmed they are calling ${resident(s).name}.`);
    });
  }

  async explainLastAlert(actor: Identity): Promise<ExplainView> {
    this.requirePerson(actor);
    const build = (s: HouseholdState, now: Date): ExplainView => {
      const last = s.alerts.find((a) => a.kind !== 'expected');
      const risk = safetyView(s, now);
      if (!last) return { riskWindow: risk, summary: 'There have been no alerts recently.' };
      const view = alertView(s, last, { forResident: actsAsResident(actor), now });
      const why =
        last.kind === 'pause'
          ? `A visitor nobody expected arrived while Kinwise was watching for a possible scam (${view.signs.map((x) => x.label.toLowerCase()).join(', ')}).`
          : 'A visitor arrived who was not on the expected list. No scam warning signs were active.';
      const shown =
        last.kind !== 'pause'
          ? ''
          : view.delivery === 'shown'
            ? ' The Pause appeared on the TV.'
            : view.delivery === 'not_confirmed'
              ? ' The TV has not confirmed that the Pause appeared, so it may not have been seen.'
              : ' Kinwise sent it to the TV and is waiting for the TV to confirm it appeared.';
      const outcome = last.resolution
        ? `${shown} ${resident(s).name} chose "${resolutionLabel(last.resolution, view.caregiverName)}" at ${view.resolvedLabel}.`
        : last.status === 'active'
          ? shown
          : shown;
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
        return timelineView(s, when ?? now, resident(s).name, false);
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
          // The demo doorbell is always a stranger, so the walkthrough works at any hour.
          expectedVisits: event.source === 'demo' && event.unscheduled ? [] : s.expectedVisits,
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
      addTimeline(s, now, 'pause_sent', `A Pause was sent to ${residentName}'s TV.`);
      if (decision.notifyCaregiver) {
        for (const c of caregivers(s)) {
          pending.notices.push({
            householdId: s.household.id,
            caregiverId: c.id,
            caregiverName: c.name,
            kind: 'pause',
            title: `Kinwise paused a visit at ${residentName}'s door`,
            body: `An unexpected visitor arrived while Kinwise was watching for a possible courier scam. Kinwise sent a Pause to ${residentName}'s TV but cannot tell whether she has seen it. A quick call from you may help.`,
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

  // ───────────────────────────── caregiver contacts ─────────────────────────────

  private caregiverMember(s: HouseholdState, actor: Identity) {
    const m = actor.role === 'caregiver' ? s.household.members.find((x) => x.id === actor.userId && x.role === 'caregiver') : undefined;
    if (!m) throw new PermissionError('Only a family member can see or change their own contacts');
    return m;
  }

  async getContacts(actor: Identity): Promise<Contacts> {
    const { state } = await this.read(actor.householdId);
    return { ...(this.caregiverMember(state, actor).contacts ?? {}) };
  }

  /** For the notifiers: where to reach this caregiver. No access logging, nothing leaves the hub except in a notice. */
  async contactsFor(householdId: string, memberId: string): Promise<(Contacts & { emailKey?: string }) | undefined> {
    const { state } = await this.read(householdId);
    const m = state.household.members.find((x) => x.id === memberId);
    return m?.contacts ? { ...m.contacts, ...(m.emailKey ? { emailKey: m.emailKey } : {}) } : m?.emailKey ? { emailKey: m.emailKey } : undefined;
  }

  /**
   * The caregiver sets where Kinwise reaches them. A new e-mail is subscribed first (they must confirm AWS's
   * message), and kept only if that worked, so nothing is ever stored that nothing is subscribed to.
   */
  async setContacts(actor: Identity, patch: ContactPatch): Promise<ContactsResult> {
    const { state } = await this.read(actor.householdId);
    const me = this.caregiverMember(state, actor);
    const next: Contacts = { ...(me.contacts ?? {}) };
    for (const kind of ['email', 'sms', 'whatsapp'] as const) {
      const v = patch[kind];
      if (v === undefined) continue;
      if (v === null || v.trim() === '') delete next[kind];
      else next[kind] = checkContact(kind, v);
    }
    // One address, one family member: removing someone's old subscription must never remove another person's.
    if (next.email && state.household.members.some((m) => m.id !== me.id && m.contacts?.email?.toLowerCase() === next.email!.toLowerCase())) {
      throw new ValidationError('That e-mail address is already used by another family member');
    }
    // Claim the one-a-minute gate BEFORE touching SNS, so two parallel saves cannot both subscribe.
    await this.mutate(actor.householdId, (s2, at) => {
      const m = this.caregiverMember(s2, actor);
      if (m.contactsChangedAt && at.getTime() - Date.parse(m.contactsChangedAt) < CONTACT_CHANGE_GAP_MS) {
        throw new ValidationError('Please wait a minute before changing contacts again');
      }
      m.contactsChangedAt = at.toISOString();
    });
    const oldEmail = me.contacts?.email;
    let newKey = me.emailKey;
    let email: ContactsResult['email'] = 'unchanged';
    if (next.email !== oldEmail) {
      const candidate = next.email ? randomBytes(9).toString('base64url') : undefined;
      try {
        await this.contactSync?.syncEmail(actor.householdId, me.id, oldEmail, next.email, candidate);
        email = next.email ? 'confirmation_sent' : 'removed';
        newKey = candidate;
      } catch (err) {
        console.error('[contacts] e-mail subscription failed:', err instanceof Error ? err.message : 'unknown error');
        email = 'failed';
        if (oldEmail) next.email = oldEmail;
        else delete next.email;
      }
    }
    try {
      await this.mutate(actor.householdId, (s2) => {
        const m = this.caregiverMember(s2, actor);
        m.contacts = next;
        if (newKey) m.emailKey = newKey;
        else delete m.emailKey;
      });
    } catch (err) {
      // The subscription changed but the record did not: put the subscription back, best effort, then say it failed.
      if (email === 'confirmation_sent' || email === 'removed') {
        await this.contactSync?.syncEmail(actor.householdId, me.id, next.email, oldEmail, me.emailKey).catch(() => undefined);
      }
      throw err;
    }
    return { contacts: next, email };
  }

  /** What the caregiver was told, newest first (the demo phone panel). No access logging: it is not a family look at Asha's day. */
  async recentNotices(householdId: string): Promise<StoredNotice[]> {
    return (await this.read(householdId)).state.notices ?? [];
  }

  async tvState(actor: Identity): Promise<TvStateView> {
    this.requireResident(actor);
    let { state, now } = await this.read(actor.householdId);
    // The TV polls every two seconds while Asha waits, so it is also what notices that nobody has answered.
    if (resendDue(state, now)) {
      await this.resendCall(actor.householdId);
      ({ state, now } = await this.read(actor.householdId));
    }
    const alert = activeAlert(state);
    const cg = caregivers(state)[0];
    const tz = state.household.timezone;
    return {
      household: { id: state.household.id, name: state.household.name, timezone: tz },
      resident: { id: resident(state).id, name: resident(state).name },
      caregiver: { name: cg?.name ?? 'Family', relationship: cg?.relationship },
      today: todayView(state, now, true),
      activeAlert: alert ? alertView(state, alert, { forResident: true, now }) : undefined,
      pendingProposals: state.expectedVisits
        .filter((v) => v.status === 'proposed')
        .map((v) => ({
          id: v.id,
          label: v.label,
          when: describeRecurrence(v.recurrence),
          proposedBy: state.household.members.find((m) => m.id === v.createdBy)?.name ?? 'Family',
        })),
      consent: state.consent,
      watch: watchView(state, now),
      privacyHourUntil: isPrivacyHour(state.privacyHourUntil, now) ? state.privacyHourUntil : undefined,
      accessLog: state.accessLog.slice(0, 20).map((e) => ({ timeLabel: formatClock(new Date(e.at), tz), actor: e.actor, action: e.action })),
      cue:
        state.tvCue && now.getTime() - Date.parse(state.tvCue.at) < TV_CUE_MS
          ? { id: state.tvCue.id, topic: state.tvCue.topic, text: state.tvCue.text }
          : undefined,
      call: callView(state, now),
      serverTime: now.toISOString(),
    };
  }

  /** Ask to be woken just after the re-send is due. A failure is only logged: the TV poll still covers it. */
  private async scheduleFollowUp(householdId: string, callId: string): Promise<void> {
    if (!this.followUpScheduler) return;
    try {
      await this.followUpScheduler.schedule(householdId, callId, new Date(this.clock.now().getTime() + RESEND_AFTER_MS + 10_000));
    } catch (err) {
      console.error('[followup] could not schedule:', err instanceof Error ? err.message : 'unknown error');
    }
  }

  /** Called by the scheduler for ONE call: send its second message if nobody has confirmed. Safe to call any time, and many times. */
  async followUp(householdId: string, callId: string): Promise<void> {
    let due = false;
    try {
      const { state, now } = await this.read(householdId);
      due = state.callRequest?.id === callId && resendDue(state, now);
    } catch (err) {
      if (err instanceof NotFoundError) return;
      throw err;
    }
    if (due) await this.resendCall(householdId, callId);
  }

  /** Second message to the caregiver. Re-checks inside the write, so many polls at once send exactly one. */
  private async resendCall(householdId: string, callId?: string): Promise<void> {
    await this.mutate(householdId, (s, now, pending) => {
      if ((callId && s.callRequest?.id !== callId) || !resendDue(s, now)) return;
      s.callRequest!.resentAt = now.toISOString();
      const residentName = resident(s).name;
      for (const c of caregivers(s)) {
        pending.notices.push({
          householdId: s.household.id,
          caregiverId: c.id,
          caregiverName: c.name,
          kind: 'call_request',
          title: `${residentName} is still waiting for you`,
          body: `${residentName} asked you to call a few minutes ago and nobody has confirmed yet. Please call now.`,
          at: now.toISOString(),
          callId: s.callRequest!.id,
        });
      }
      addTimeline(s, now, 'alert_resolved', `Nobody had answered, so Kinwise sent ${primaryCaregiverName(s)} a second message.`);
    });
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function resendDue(s: HouseholdState, now: Date): boolean {
  const call = s.callRequest;
  if (!call || call.ackedAt || call.resentAt) return false;
  const age = now.getTime() - Date.parse(call.requestedAt);
  return age >= RESEND_AFTER_MS && age <= CALL_CONFIRM_MS;
}

function callView(s: HouseholdState, now: Date): CallView | undefined {
  const call = s.callRequest;
  if (!call) return undefined;
  const age = now.getTime() - Date.parse(call.requestedAt);
  if (age > CALL_CONFIRM_MS) return undefined;
  const caregiverName = primaryCaregiverName(s);
  if (call.ackedAt) return { caregiverName, status: 'confirmed' };
  if (age >= UNANSWERED_AFTER_MS) return { caregiverName, status: 'unanswered' };
  if (age >= RESEND_AFTER_MS) return { caregiverName, status: 'waiting' };
  return { caregiverName, status: 'asked' };
}


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
  s.notices?.splice(CAPS.notices);
}

/** The question she has not answered yet, if it has not run out. */
function openOffer(s: HouseholdState, now: Date): WatchOffer | undefined {
  const o = s.watchOffer;
  return o && Date.parse(o.expiresAt) > now.getTime() ? o : undefined;
}

export function watchView(s: HouseholdState, now: Date): WatchView {
  const tz = s.household.timezone;
  if (isWindowActive(s.riskWindow, now)) return { state: 'on', untilLabel: formatClock(new Date(s.riskWindow.expiresAt), tz) };
  const open = openOffer(s, now);
  if (open) {
    const notifies = s.consent.caregiverAlerts ? primaryCaregiverName(s) : undefined;
    return { state: 'offered', offer: { id: open.id, hours: RISK_WINDOW_HOURS, expiresAt: open.expiresAt, notifies } };
  }
  if (s.watchDeclinedUntil && Date.parse(s.watchDeclinedUntil) > now.getTime()) return { state: 'declined' };
  return { state: 'none' };
}

/** What "turn on" would and would not do, in plain words, for "review privacy". Built from her actual settings. */
function privacyLines(s: HouseholdState, now: Date): string[] {
  const until = formatClock(new Date(addMinutes(now, RISK_WINDOW_HOURS * 60)), s.household.timezone);
  const family = primaryCaregiverName(s);
  return [
    'Kinwise keeps only the kinds of warning sign it noticed, never your words.',
    `If you turn it on, it pays closer attention to the front door until about ${until}.`,
    "If someone you don't expect arrives, your TV shows a Pause and says why. It never says who the person is.",
    s.consent.caregiverAlerts
      ? `${family} is told only if it looks serious, with a short message and no recordings or what you said.`
      : `${family} would not be told, because family alerts are off.`,
    'You can end the watch on your TV or by asking me, or use privacy time, at any moment.',
  ];
}
