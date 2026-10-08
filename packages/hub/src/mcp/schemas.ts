import { z } from 'zod';

/** Output schemas mirror services/views.ts so structuredContent is validated against outputSchema. */

const level = z.enum(['none', 'elevated', 'high']);
const category = z.enum(['authority', 'urgency', 'secrecy', 'unusual_payment', 'courier_pickup', 'remote_access']);

export const sign = z.object({
  key: category,
  label: z.string(),
  explanation: z.string(),
});

export const safety = z.object({
  level,
  untilLabel: z.string().optional(),
  signs: z.array(sign),
});

export const alertView = z.object({
  id: z.string(),
  kind: z.enum(['pause', 'gentle', 'expected']),
  status: z.enum(['active', 'resolved', 'expired']),
  createdAt: z.string(),
  createdLabel: z.string(),
  description: z.string(),
  visitLabel: z.string().optional(),
  riskLevel: z.enum(['elevated', 'high']).optional(),
  signs: z.array(sign),
  caregiverName: z.string(),
  pauseMessage: z.object({ from: z.string(), text: z.string(), videoUrl: z.string().optional() }).optional(),
  resolution: z.enum(['call_family', 'known_person', 'dismiss']).optional(),
  resolvedLabel: z.string().optional(),
});

export const screeningView = z.object({
  mode: z.enum(['reminder', 'check']),
  level,
  signs: z.array(sign),
  advice: z.array(z.string()),
  followUp: z.string().optional(),
  riskWindow: safety,
  caregiverName: z.string(),
  reminder: z.object({ id: z.string(), text: z.string(), timeLabel: z.string() }).optional(),
});

export const todayView = z.object({
  householdName: z.string(),
  residentName: z.string(),
  caregiverName: z.string(),
  date: z.string(),
  dateLabel: z.string(),
  timeLabel: z.string(),
  reminders: z
    .array(z.object({ id: z.string(), text: z.string(), timeLabel: z.string(), flagged: z.boolean() }))
    .optional(),
  visits: z.array(z.object({ id: z.string(), label: z.string(), timeLabel: z.string() })),
  messages: z.array(z.object({ id: z.string(), from: z.string(), text: z.string(), timeLabel: z.string(), unread: z.boolean() })),
  safety,
  activeAlert: alertView.optional(),
  privacyHourUntilLabel: z.string().optional(),
});

export const timelineView = z.object({
  date: z.string(),
  dateLabel: z.string(),
  residentName: z.string(),
  entries: z.array(z.object({ at: z.string(), timeLabel: z.string(), kind: z.string(), text: z.string() })),
  summary: z.object({
    pausesShown: z.number(),
    unexpectedVisitors: z.number(),
    expectedVisitors: z.number(),
    flaggedCalls: z.number(),
  }),
});

export const explainView = z.object({
  alert: alertView.optional(),
  riskWindow: safety,
  summary: z.string(),
});

export const visitResult = z.object({
  visit: z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['active', 'proposed']),
  }),
  description: z.string(),
  needsApproval: z.boolean(),
});

export const respondResult = z.object({ alert: alertView, message: z.string() });
export const privacyResult = z.object({ active: z.boolean(), untilLabel: z.string().optional() });
export const messageResult = z.object({ id: z.string(), deliveredTo: z.string() });

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const tvReadResult = z.object({
  topic: z.enum(['messages', 'today']),
  text: z.string(),
  deliveredTo: z.string(),
});
