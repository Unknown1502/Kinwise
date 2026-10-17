import type { Identity } from '../auth/identity.js';
import type { VisitorEvent } from '../domain/types.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../seed.js';
import { KinwiseService, type IngestResult } from '../services/kinwise.js';
import { OutboxNotifier } from '../services/notifier.js';
import { MemoryStore } from '../store/memory.js';

/**
 * "Measured, not demonstrated": the same situations run through the real Kinwise service (the code the
 * hub runs, with a fake clock), compared with a door-only rule. Run it: `npm run scenarios -w @kinwise/hub`.
 *
 * "Door-only" is an ablation, not a named product: the same rules (expected-visit list, privacy time,
 * presence) but it never hears the phone call. A door-only rule has one policy for a stranger, so it is
 * shown both ways: urgent for every stranger, or calm for every stranger.
 */

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };

const CALL = 'A man from the FTC said my accounts are compromised and I should withdraw it as gold. Do not tell my family.';
const REMINDER = 'Courier from the bank picking up a package';
/** Thursday 2026-10-08 (the gardener's day) in New York, UTC-4; override `date` for the aide's Tuesday. */
const DAY = '2026-10-08';

/** What Asha answers when asked "turn on a six-hour safety watch?" (default: turn on). `none` leaves the question unanswered. */
type Answer = 'turn_on' | 'not_now' | 'none';

type Step =
  | { at: string; do: 'check'; answer?: Answer }
  | { at: string; do: 'reminder'; answer?: Answer }
  | { at: string; do: 'privacy'; minutes: number }
  | { at: string; do: 'end_watch' }
  | { at: string; do: 'consent'; set: { scamScreening?: boolean; doorAwareness?: boolean; caregiverAlerts?: boolean } }
  /** `old`: the event describes a visit that many minutes ago (a retried webhook). `twice`: the same event id arrives again. */
  | { at: string; do: 'visitor'; present?: boolean; old?: number; twice?: boolean };

export type Truth = 'scam' | 'benign' | 'by-design';

export interface Scenario {
  id: string;
  title: string;
  truth: Truth;
  date?: string;
  steps: Step[];
}

export const SCENARIOS: Scenario[] = [
  { id: 'scam-call-then-courier', title: 'Scam call checked at 10:20, a courier rings at 2:41 PM', truth: 'scam',
    steps: [{ at: '10:20', do: 'check' }, { at: '14:41', do: 'visitor' }] },
  { id: 'scam-reminder-then-courier', title: 'Reminder "courier from the bank" saved at 10:15, a courier rings at 2:41 PM', truth: 'scam',
    steps: [{ at: '10:15', do: 'reminder' }, { at: '14:41', do: 'visitor' }] },
  { id: 'courier-after-window-expired', title: 'Scam call checked at 8:00 AM, a courier rings at 2:30 PM (6½ hours later)', truth: 'scam',
    steps: [{ at: '08:00', do: 'check' }, { at: '14:30', do: 'visitor' }] },
  { id: 'delivery-no-call', title: 'A delivery driver rings at 2:41 PM, no call that day', truth: 'benign',
    steps: [{ at: '14:41', do: 'visitor' }] },
  { id: 'neighbour-no-call', title: 'A neighbour drops by at 5:00 PM, no call that day', truth: 'benign',
    steps: [{ at: '17:00', do: 'visitor' }] },
  { id: 'gardener-after-scam-call', title: 'Scam call checked at 9:30, the gardener arrives at 10:15 (his usual hour)', truth: 'benign',
    steps: [{ at: '09:30', do: 'check' }, { at: '10:15', do: 'visitor' }] },
  { id: 'aide-on-schedule', title: "The home-health aide arrives on her Tuesday at 2:30 PM", truth: 'benign', date: '2026-10-06',
    steps: [{ at: '14:30', do: 'visitor' }] },
  { id: 'privacy-time', title: 'Scam call checked at 10:20, Asha turns on privacy time, someone rings at 12:30', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check' }, { at: '12:00', do: 'privacy', minutes: 120 }, { at: '12:30', do: 'visitor' }] },
  { id: 'nobody-visible', title: 'Scam call checked at 10:20, the doorbell sees motion but no person at 2:41 PM', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check' }, { at: '14:41', do: 'visitor', present: false }] },
  // Consent, revocation and failure paths (truth "by design": they are the resident's choices or protections, not detections).
  { id: 'watch-declined', title: 'Scam call checked at 10:20, Asha answers "Not now" to the safety watch, a courier rings at 2:41 PM', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check', answer: 'not_now' }, { at: '14:41', do: 'visitor' }] },
  { id: 'watch-unanswered', title: 'Scam call checked at 10:20, the safety-watch question is never answered, a courier rings at 2:41 PM', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check', answer: 'none' }, { at: '14:41', do: 'visitor' }] },
  { id: 'watch-ended', title: 'Scam call checked at 10:20, watch on, Asha ends it at 12:00, a courier rings at 2:41 PM', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check' }, { at: '12:00', do: 'end_watch' }, { at: '14:41', do: 'visitor' }] },
  { id: 'screening-revoked', title: 'Asha switches scam screening off at 9:00, checks a call at 10:20, a courier rings at 2:41 PM', truth: 'by-design',
    steps: [{ at: '09:00', do: 'consent', set: { scamScreening: false } }, { at: '10:20', do: 'check' }, { at: '14:41', do: 'visitor' }] },
  { id: 'door-revoked', title: 'Watch on at 10:20, Asha switches door awareness off at 12:00, someone rings at 2:41 PM', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check' }, { at: '12:00', do: 'consent', set: { doorAwareness: false } }, { at: '14:41', do: 'visitor' }] },
  { id: 'call-no-visitor', title: 'Scam call checked at 10:20, watch on, nobody comes to the door all day', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check' }] },
  { id: 'duplicate-event', title: 'Watch on at 10:20, the same courier event reaches the hub twice at 2:41 PM', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check' }, { at: '14:41', do: 'visitor', twice: true }] },
  { id: 'late-event', title: 'Watch on at 10:20, a retried event from 2:41 PM only reaches the hub at 3:30 PM', truth: 'by-design',
    steps: [{ at: '10:20', do: 'check' }, { at: '15:30', do: 'visitor', old: 49 }] },
];

export type KinwiseOutcome = 'Pause' | 'Note' | 'Greeting' | 'Quiet';
export type DoorOnlyOutcome = 'Alert' | 'Note' | 'Greeting' | 'Quiet';

export interface Row {
  id: string;
  title: string;
  truth: Truth;
  kinwise: KinwiseOutcome;
  doorOnlyUrgent: DoorOnlyOutcome;
  doorOnlyCalm: DoorOnlyOutcome;
  kinwiseFamilyPinged: boolean;
}

export interface Score {
  scamsCaught: number;
  scamsTotal: number;
  falseUrgent: number;
  benignTotal: number;
  familyPings: number;
}

export interface Evaluation {
  rows: Row[];
  summary: { kinwise: Score; doorOnlyUrgent: Score; doorOnlyCalm: Score };
}

const KINWISE_LABEL: Record<IngestResult['decision'], KinwiseOutcome> = {
  pause: 'Pause',
  gentle: 'Note',
  expected: 'Greeting',
  activity: 'Quiet',
  ignored: 'Quiet',
};

/** Same rules without the phone call: a stranger is just a stranger. */
function doorOnly(decision: IngestResult['decision'], strangerIs: 'Alert' | 'Note'): DoorOnlyOutcome {
  if (decision === 'pause' || decision === 'gentle') return strangerIs;
  return decision === 'expected' ? 'Greeting' : 'Quiet';
}

async function run(scenario: Scenario): Promise<Row> {
  const date = scenario.date ?? DAY;
  const at = (hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`);
  const clock = { t: at('06:00'), now() { return this.t; } };
  const notifier = new OutboxNotifier(() => {});
  const service = new KinwiseService({ store: new MemoryStore(), notifier, clock });
  await service.createHousehold(demoHousehold(clock.now()));

  let decision: IngestResult['decision'] = 'ignored';
  let pinged = false;
  let n = 0;
  for (const step of scenario.steps) {
    clock.t = at(step.at);
    if (step.do === 'check' || step.do === 'reminder') {
      const v = step.do === 'check'
        ? await service.checkCall(asha, { description: CALL })
        : await service.addReminder(asha, { text: REMINDER, at: at('14:00').toISOString() });
      const answer = step.answer ?? 'turn_on';
      if (v.watch.offer && answer !== 'none') await service.respondToWatch(asha, v.watch.offer.id, answer);
    } else if (step.do === 'privacy') await service.setPrivacyHour(asha, step.minutes);
    else if (step.do === 'end_watch') await service.closeRiskWindow(asha, 'Resident ended the safety watch');
    else if (step.do === 'consent') await service.updateConsent(asha, step.set);
    else {
      const present = step.present ?? true;
      const before = notifier.outbox.length;
      const event: VisitorEvent = {
        eventId: `${scenario.id}-${++n}`,
        deviceId: 'front-door',
        occurredAt: new Date(clock.t.getTime() - (step.old ?? 0) * 60_000).toISOString(),
        source: 'demo',
        ringEventType: 'button_press',
        perception: {
          personPresent: present,
          peopleCount: present ? 1 : 0,
          description: present ? 'A person at the front door' : 'Motion at the front door, no one visible',
        },
      };
      decision = (await service.ingestVisitor(HH, event)).decision;
      if (step.twice) await service.ingestVisitor(HH, event);
      pinged = notifier.outbox.length - before > 0;
    }
  }
  return {
    id: scenario.id,
    title: scenario.title,
    truth: scenario.truth,
    kinwise: KINWISE_LABEL[decision],
    doorOnlyUrgent: doorOnly(decision, 'Alert'),
    doorOnlyCalm: doorOnly(decision, 'Note'),
    kinwiseFamilyPinged: pinged,
  };
}

function score(rows: Row[], urgent: (r: Row) => boolean, pings: (r: Row) => boolean): Score {
  const scams = rows.filter((r) => r.truth === 'scam');
  const benign = rows.filter((r) => r.truth === 'benign');
  return {
    scamsCaught: scams.filter(urgent).length,
    scamsTotal: scams.length,
    falseUrgent: benign.filter(urgent).length,
    benignTotal: benign.length,
    familyPings: rows.filter((r) => r.truth !== 'by-design' && pings(r)).length,
  };
}

export async function runScenarios(): Promise<Evaluation> {
  const rows: Row[] = [];
  for (const s of SCENARIOS) rows.push(await run(s));
  return {
    rows,
    summary: {
      kinwise: score(rows, (r) => r.kinwise === 'Pause', (r) => r.kinwiseFamilyPinged),
      doorOnlyUrgent: score(rows, (r) => r.doorOnlyUrgent === 'Alert', (r) => r.doorOnlyUrgent === 'Alert'),
      doorOnlyCalm: score(rows, () => false, () => false),
    },
  };
}

function mark(truth: Truth, outcome: string, urgentLabel: string): string {
  const urgent = outcome === urgentLabel;
  if (truth === 'scam') return urgent ? `${outcome} ✔ caught` : `${outcome} ✘ missed`;
  if (truth === 'benign') return urgent ? `${outcome} ✘ false alarm` : outcome;
  return outcome;
}

/** The text of docs/evaluation.md. A test keeps the published file identical to this output. */
export function renderMarkdown({ rows, summary }: Evaluation): string {
  const truthLabel: Record<Truth, string> = { scam: 'a scam', benign: 'harmless', 'by-design': 'by design' };
  const table = rows
    .map((r) => `| ${r.title} | ${truthLabel[r.truth]} | ${mark(r.truth, r.kinwise, 'Pause')} | ${mark(r.truth, r.doorOnlyUrgent, 'Alert')} | ${mark(r.truth, r.doorOnlyCalm, 'Alert')} |`)
    .join('\n');
  const line = (name: string, s: Score) =>
    `| ${name} | ${s.scamsCaught} of ${s.scamsTotal} | ${s.falseUrgent} of ${s.benignTotal} | ${s.familyPings} |`;
  return `# Measured, not demonstrated

Every row below is run through the real Kinwise service (the same code the hub runs, with a fake clock), then compared with a **door-only** rule. Rerun it any time:

\`\`\`bash
npm run scenarios -w @kinwise/hub          # prints this table
npm run scenarios -w @kinwise/hub -- --write   # rewrites this file (a test fails if it drifts)
\`\`\`

**Door-only** is not a named product. It is Kinwise's own rules (the expected-visitor list, privacy time, presence) *without* the phone call: it never hears that Asha asked about a scam. A door-only rule has one policy for a stranger, so both are shown: **urgent** (alert and tell the family every time) or **calm** (a quiet note every time).

What Kinwise shows: **Pause** = the full-screen Pause on the TV (and the family is told when risk is high); **Note** = a gentle card; **Greeting** = an expected visitor, no alarm; **Quiet** = nothing.

| Situation | Truth | Kinwise | Door-only, urgent | Door-only, calm |
|---|---|---|---|---|
${table}

## Scorecard

| | Scams caught | False urgent alerts on harmless visitors | Family pinged |
|---|---|---|---|
${line('**Kinwise**', summary.kinwise)}
${line('Door-only, urgent for every stranger', summary.doorOnlyUrgent)}
${line('Door-only, calm for every stranger', summary.doorOnlyCalm)}

## What this says, and what it does not

- Knowing about the call is what lets Kinwise be **urgent when it matters and calm when it does not**. A door-only rule must pick one: it either cries wolf at every delivery and neighbour, or it never raises the alarm.
- **Kinwise misses one scam**, reported as a failure: a courier who arrives after the 6-hour risk window has closed (\`RISK_WINDOW_HOURS\` in \`packages/hub/src/domain/risk.ts\`). A longer window would catch it at the cost of more Pauses. That trade-off belongs to Asha and her family, so it is left as it is.
- The rows marked "by design" are the resident's choices and the system's protections (privacy time, "Not now", ending or revoking the watch, no visitor, a duplicate or late event), not detections, so they are shown but not scored. "Family pinged" counts only the scored rows.
- **Asking first has a cost, and it is the point.** A scam call Asha will not turn a watch on for ("Not now", or the question goes unanswered) is not followed by a Pause: a courier at 2:41 PM gets only a gentle note. Kinwise will not watch or tell her family without her say-so, so in those rows it deliberately catches nothing. How often real residents answer "Not now" is unknown and would need a field study.
- These are scripted situations, not a field study. They prove the rules do what they claim; they do not estimate how often scams really happen.
- The Pause also tells Asha *why*: "At 10:20 AM you asked Kinwise about a call, and it matched courier-scam warning signs." It is built from the time and kind of each earlier warning, never from the words said, and the family never see it for a reminder (reminders are Asha's own).
`;
}
