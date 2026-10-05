import type { HouseholdState } from './domain/types.js';

export const DEMO_HOUSEHOLD_ID = 'hh-asha';

/**
 * Demo household used by local dev, tests and the video. Asha lives alone;
 * Priya is her daughter. Weekdays: 0 = Sunday … 6 = Saturday.
 */
export function demoHousehold(now: Date, timezone = 'America/New_York'): HouseholdState {
  const iso = now.toISOString();
  return {
    version: 0,
    household: {
      id: DEMO_HOUSEHOLD_ID,
      name: "Asha's home",
      timezone,
      members: [
        { id: 'asha', name: 'Asha', role: 'resident' },
        { id: 'priya', name: 'Priya', role: 'caregiver', relationship: 'daughter' },
      ],
      pauseMessage: {
        from: 'Priya',
        text: "Mom, it's me. Real banks and agencies never send couriers. Please don't hand anything over. I'm calling you right now.",
        videoUrl: '/media/priya-pause.mp4',
      },
    },
    consent: {
      scamScreening: true,
      doorAwareness: true,
      caregiverAlerts: true,
      shareTimelineWithCaregiver: true,
    },
    reminders: [],
    expectedVisits: [
      {
        id: 'visit_luis',
        label: 'Luis (gardener)',
        recurrence: { kind: 'weekly', weekday: 4, start: '10:00', end: '11:00' },
        status: 'active',
        createdBy: 'asha',
        createdAt: iso,
      },
      {
        id: 'visit_aide',
        label: 'Maria (home-health aide)',
        recurrence: { kind: 'weekly', weekday: 2, start: '14:00', end: '15:00' },
        status: 'active',
        createdBy: 'asha',
        createdAt: iso,
      },
    ],
    signals: [],
    visitorEvents: [],
    alerts: [],
    messages: [],
    accessLog: [],
    timeline: [],
    processedEventIds: [],
    ignoredDoorEvents: 0,
  };
}
