import type {AlertView, SignView, TvStateView} from '../src/types';

/**
 * Fixtures shaped exactly like the hub's GET /tv/state (TvStateView), captured from a running
 * hub with the demo household (Asha, caregiver Priya) and trimmed.
 */

export const SIGNS: SignView[] = [
  {
    key: 'authority',
    label: 'Bank or agency',
    explanation: "They said they're from a bank or the government. Real agencies never ask you to move money over the phone.",
  },
  {
    key: 'urgency',
    label: 'Pressure to act now',
    explanation: 'They said your money is in danger right now. Pressure to act fast is the most common scam warning sign.',
  },
  {
    key: 'courier_pickup',
    label: 'Someone coming to collect',
    explanation: 'Someone is coming to collect something. No bank or agency ever sends a courier to pick up money.',
  },
];

export function pauseAlert(overrides: Partial<AlertView> = {}): AlertView {
  return {
    id: 'alert_pause_1',
    kind: 'pause',
    status: 'active',
    createdAt: '2026-10-05T18:18:11.895Z',
    createdLabel: '2:18 PM',
    description: 'A person at the front door holding a small box',
    riskLevel: 'high',
    signs: SIGNS,
    caregiverName: 'Priya',
    pauseMessage: {
      from: 'Priya',
      text: "Mom, it's me. Real banks and agencies never send couriers. Please don't hand anything over. I'm calling you right now.",
      videoUrl: '/media/priya-pause.mp4',
    },
    ...overrides,
  };
}

export function gentleAlert(overrides: Partial<AlertView> = {}): AlertView {
  return {
    id: 'alert_gentle_1',
    kind: 'gentle',
    status: 'active',
    createdAt: '2026-10-05T18:30:00.000Z',
    createdLabel: '2:30 PM',
    description: 'A person at the front door',
    signs: [],
    caregiverName: 'Priya',
    ...overrides,
  };
}

export function expectedAlert(overrides: Partial<AlertView> = {}): AlertView {
  return {
    id: 'alert_expected_1',
    kind: 'expected',
    status: 'active',
    createdAt: '2026-10-05T14:05:00.000Z',
    createdLabel: '10:05 AM',
    description: 'A person at the front door',
    visitLabel: 'Luis (gardener)',
    signs: [],
    caregiverName: 'Priya',
    ...overrides,
  };
}

/** A calm afternoon: onboarded, no alert, a visit, two reminders (one flagged), two messages. */
export function homeState(overrides: Partial<TvStateView> = {}): TvStateView {
  const base: TvStateView = {
    household: {id: 'hh-asha', name: "Asha's home", timezone: 'America/New_York'},
    resident: {id: 'asha', name: 'Asha'},
    caregiver: {name: 'Priya', relationship: 'daughter'},
    today: {
      householdName: "Asha's home",
      residentName: 'Asha',
      caregiverName: 'Priya',
      date: '2026-10-05',
      dateLabel: 'Monday, October 5',
      timeLabel: '2:19 PM',
      reminders: [
        {id: 'rem_1', text: 'Courier from the bank at 2 p.m.', timeLabel: '2:00 PM', flagged: true},
        {id: 'rem_2', text: 'Call the pharmacy', timeLabel: '4:30 PM', flagged: false},
      ],
      visits: [{id: 'visit_aide', label: 'Maria (home-health aide)', timeLabel: '2:00 PM–3:00 PM'}],
      messages: [
        {id: 'msg_1', from: 'Priya', text: 'Love you Mom! Call you tonight.', timeLabel: '1:02 PM', unread: true},
        {id: 'msg_2', from: 'Priya', text: 'Luis is coming Thursday as usual.', timeLabel: '9:15 AM', unread: false},
      ],
      safety: {level: 'none', signs: []},
    },
    pendingProposals: [],
    consent: {
      scamScreening: true,
      doorAwareness: true,
      caregiverAlerts: true,
      shareTimelineWithCaregiver: true,
      onboardedAt: '2026-10-05T12:00:00.000Z',
    },
    accessLog: [{timeLabel: '1:05 PM', actor: 'Priya', action: "viewed today's overview"}],
    serverTime: '2026-10-05T18:19:11.527Z',
  };
  return {...base, ...overrides};
}

/** Add an active alert to a state the way the hub does (top level and inside `today`). */
export function withAlert(state: TvStateView, alert: AlertView | undefined): TvStateView {
  return {...state, activeAlert: alert, today: {...state.today, activeAlert: alert}};
}

export function notOnboarded(state: TvStateView): TvStateView {
  const {onboardedAt: _ignored, ...consent} = state.consent;
  return {...state, consent};
}
