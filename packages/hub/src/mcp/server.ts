import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { actsAsResident, PermissionError, type Identity } from '../auth/identity.js';
import type { Recurrence } from '../domain/types.js';
import { KinwiseService, NotFoundError, ValidationError } from '../services/kinwise.js';
import {
  WEEKDAYS,
  explainView,
  hhmm,
  messageResult,
  privacyResult,
  respondResult,
  screeningView,
  timelineView,
  todayView,
  visitResult,
} from './schemas.js';
import { UI_HTML } from './ui-bundle.generated.js';

export const SERVER_VERSION = '0.1.0';

export const UI_URIS = {
  screening: 'ui://kinwise/screening',
  today: 'ui://kinwise/today',
  pause: 'ui://kinwise/pause',
  timeline: 'ui://kinwise/timeline',
} as const;

const ICON = {
  src:
    'data:image/svg+xml;base64,' +
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14532d"/><path d="M32 12l16 6v12c0 11-7 18-16 22-9-4-16-11-16-22V18z" fill="#fef3c7"/><path d="M25 33l5 5 10-11" stroke="#14532d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    ).toString('base64'),
  mimeType: 'image/svg+xml',
  sizes: ['64x64'],
};

const INSTRUCTIONS = `Kinwise is a consent-first family safety add-on for an older adult who lives alone.
- When the resident describes a phone call, letter, text or visitor request involving money, a bank, a government agency, gold, gift cards, crypto or a courier, call kinwise_check_call with what was said, in their words. Then read the advice calmly.
- Route every "remind me…" request from the resident to kinwise_add_reminder. If it returns a followUp, say it.
- Never pressure, shame or alarm. Kinwise advises; it never controls. The resident can always dismiss.
- Family members (caregivers) see signals only: never transcripts, recordings or reminder text.`;

type Card = keyof typeof UI_URIS;

function ok(text: string, structured: unknown): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured as Record<string, unknown> };
}

function fail(err: unknown): CallToolResult {
  if (err instanceof PermissionError || err instanceof ValidationError || err instanceof NotFoundError) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
  throw err;
}

/** Wrap a handler so domain errors become tool errors the model can explain to the user. */
function guard<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };
}

function ui(card: Card, visibility?: Array<'model' | 'app'>) {
  return { ui: { resourceUri: UI_URIS[card], ...(visibility ? { visibility } : {}) } };
}

/**
 * Build one McpServer for one request (stateless serving). Tools are filtered by
 * the caller's role so each persona only discovers what it can use; the
 * discovery-only service identity sees the whole catalog.
 */
export function buildMcpServer(identity: Identity, service: KinwiseService): McpServer {
  const server = new McpServer(
    {
      name: 'kinwise',
      title: 'Kinwise',
      version: SERVER_VERSION,
      icons: [ICON],
      websiteUrl: 'https://github.com/kinwise-app/kinwise',
    },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  );

  const isService = identity.role === 'service';
  const resident = isService || actsAsResident(identity);
  const caregiver = isService || identity.role === 'caregiver';

  // ── MCP Apps UI resources ──
  for (const card of Object.keys(UI_URIS) as Card[]) {
    registerAppResource(
      server,
      `kinwise-${card}-card`,
      UI_URIS[card],
      {
        title: `Kinwise ${card} card`,
        description: `Interactive ${card} card for Echo Show-style displays`,
        mimeType: RESOURCE_MIME_TYPE,
        _meta: { ui: { prefersBorder: false } },
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: UI_HTML[card], _meta: { ui: { prefersBorder: false } } }],
      }),
    );
  }

  // ── Resident tools ──
  if (resident) {
    registerAppTool(
      server,
      'kinwise_add_reminder',
      {
        title: 'Add a reminder',
        description:
          "Save a reminder for the resident. Kinwise also screens it for courier-scam warning signs (for example 'a courier from the bank is picking up a package'). Use for every 'remind me…' request from the resident.",
        inputSchema: z.object({
          text: z.string().min(1).max(500).describe("What to be reminded about, in the resident's own words"),
          at: z.string().describe('When, as an ISO 8601 date-time with offset, e.g. 2026-10-08T14:00:00-04:00'),
        }),
        outputSchema: screeningView,
        annotations: { title: 'Add a reminder', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: ui('screening'),
      },
      guard(async ({ text, at }) => {
        const v = await service.addReminder(identity, { text, at });
        const said = `Okay, I'll remind you at ${v.reminder?.timeLabel}: ${v.reminder?.text}.`;
        return ok(v.followUp ? `${said} ${v.followUp}` : said, v);
      }),
    );

    registerAppTool(
      server,
      'kinwise_check_call',
      {
        title: 'Second opinion on a call',
        description:
          "Give the resident a calm second opinion on a phone call, letter, text or visitor request. Pass what the caller said, in the resident's words. Kinwise checks six courier-scam warning signs, combines them with earlier signals today, and may watch the front door more closely for a few hours. The words themselves are never stored.",
        inputSchema: z.object({
          description: z.string().min(1).max(2000).describe('What the caller said or asked for'),
        }),
        outputSchema: screeningView,
        annotations: { title: 'Second opinion on a call', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: ui('screening'),
      },
      guard(async ({ description }) => {
        const v = await service.checkCall(identity, { description });
        const signs = v.signs.map((s) => s.label.toLowerCase()).join(', ');
        const text =
          v.level === 'high'
            ? `This has the warning signs of a scam: ${signs}. Real banks and agencies never send couriers to collect money. Please don't hand anything over. Would you like me to call ${v.caregiverName}?`
            : v.level === 'elevated'
              ? `Some of this sounds like a scam (${signs}). Let's check with ${v.caregiverName} before doing anything.`
              : "I don't see common scam warning signs. If anything feels off, it's okay to hang up and call back on a number you trust.";
        return ok(text, v);
      }),
    );

    registerAppTool(
      server,
      'kinwise_respond_to_alert',
      {
        title: 'Respond to the door alert',
        description:
          'Act on the alert currently shown about a visitor at the door: call family, say the visitor is known, or dismiss. Only when the resident asks.',
        inputSchema: z.object({
          alertId: z.string().describe('The id of the active alert (from kinwise_get_today.activeAlert.id)'),
          action: z.enum(['call_family', 'known_person', 'dismiss']),
        }),
        outputSchema: respondResult,
        annotations: { title: 'Respond to the door alert', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: ui('pause', ['model', 'app']),
      },
      guard(async ({ alertId, action }) => {
        const r = await service.respondToAlert(identity, alertId, action);
        return ok(r.message, r);
      }),
    );

    server.registerTool(
      'kinwise_set_privacy_hour',
      {
        title: 'Privacy time',
        description:
          'Pause Kinwise for a while. During privacy time Kinwise ignores the doorbell completely and stores nothing. Use 0 to end privacy time early.',
        inputSchema: z.object({ minutes: z.number().int().min(0).max(720).describe('How long, in minutes (0 ends it)') }),
        outputSchema: privacyResult,
        annotations: { title: 'Privacy time', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        icons: [ICON],
      },
      guard(async ({ minutes }) => {
        const r = await service.setPrivacyHour(identity, minutes);
        const out = { active: !!r.until, untilLabel: r.untilLabel };
        return ok(r.until ? `Privacy time is on until ${r.untilLabel}. I won't notice the door until then.` : 'Privacy time is off.', out);
      }),
    );
  }

  // ── Shared tools ──
  registerAppTool(
    server,
    'kinwise_get_today',
    {
      title: "Today at home",
      description:
        "Today's overview: expected visitors, family messages, safety status and any alert at the door. The resident also sees their own reminders; family members never see reminder text.",
      inputSchema: z.object({}),
      outputSchema: todayView,
      annotations: { title: 'Today at home', readOnlyHint: true, openWorldHint: false },
      _meta: ui('today'),
    },
    guard(async () => {
      const v = await service.getToday(identity);
      const visits = v.visits.length ? `Expected today: ${v.visits.map((x) => `${x.label} at ${x.timeLabel}`).join('; ')}.` : 'No visitors are expected today.';
      const safetyLine =
        v.safety.level === 'none' ? '' : ` Kinwise is watching the door more closely until ${v.safety.untilLabel}.`;
      return ok(`It's ${v.dateLabel}. ${visits}${safetyLine}`, v);
    }),
  );

  registerAppTool(
    server,
    'kinwise_explain_last_alert',
    {
      title: 'Why did Kinwise alert?',
      description: 'Explain the most recent door alert in plain language: what happened, which warning signs were active, and what was chosen.',
      inputSchema: z.object({}),
      outputSchema: explainView,
      annotations: { title: 'Why did Kinwise alert?', readOnlyHint: true, openWorldHint: false },
      _meta: ui('pause'),
    },
    guard(async () => {
      const v = await service.explainLastAlert(identity);
      return ok(v.summary, v);
    }),
  );

  registerAppTool(
    server,
    'kinwise_get_day_timeline',
    {
      title: "How's the day going?",
      description:
        "A timeline of today's signals at home (visitors, Pauses, choices made) for family members. Signals only — never recordings or transcripts. Respects the resident's sharing choice.",
      inputSchema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, defaults to today') }),
      outputSchema: timelineView,
      annotations: { title: "How's the day going?", readOnlyHint: true, openWorldHint: false },
      _meta: ui('timeline'),
    },
    guard(async ({ date }) => {
      const v = await service.getTimeline(identity, date);
      const s = v.summary;
      const text =
        v.entries.length === 0
          ? `A quiet day so far for ${v.residentName}.`
          : `${v.residentName}'s day: ${s.expectedVisitors} expected visitors, ${s.unexpectedVisitors} unexpected, ${s.pausesShown} Pause${s.pausesShown === 1 ? '' : 's'} shown. Latest: ${v.entries.at(-1)?.text}`;
      return ok(text, v);
    }),
  );

  server.registerTool(
    'kinwise_add_expected_visit',
    {
      title: 'Add an expected visitor',
      description:
        "Tell Kinwise about someone who is expected (gardener, aide, family). Give a weekday for a weekly visit or a date for a one-time visit, plus a start and end time (24-hour HH:MM, household time). Residents' additions are active right away; family members' additions wait for the resident's approval on the TV.",
      inputSchema: z.object({
        label: z.string().min(1).max(80).describe('Who, e.g. "Luis (gardener)"'),
        weekday: z.enum(WEEKDAYS).optional().describe('For a weekly visit'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('For a one-time visit, YYYY-MM-DD'),
        start: hhmm,
        end: hhmm,
      }),
      outputSchema: visitResult,
      annotations: { title: 'Add an expected visitor', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      icons: [ICON],
    },
    guard(async ({ label, weekday, date, start, end }) => {
      if (!weekday && !date) throw new ValidationError('Give a weekday for a weekly visit or a date for a one-time visit');
      const recurrence: Recurrence = date
        ? { kind: 'once', date, start, end }
        : { kind: 'weekly', weekday: WEEKDAYS.indexOf(weekday!), start, end };
      const r = await service.addExpectedVisit(identity, { label, recurrence });
      const out = { visit: { id: r.visit.id, label: r.visit.label, status: r.visit.status }, description: r.description, needsApproval: r.needsApproval };
      return ok(
        r.needsApproval
          ? `Sent for approval on the TV: ${r.visit.label} (${r.description}). It becomes active once approved there.`
          : `Got it. ${r.visit.label} is expected ${r.description}.`,
        out,
      );
    }),
  );

  // ── Caregiver tools ──
  if (caregiver) {
    server.registerTool(
      'kinwise_send_family_message',
      {
        title: 'Send a message to the TV',
        description: "Send a short, kind message that appears on the resident's TV home screen.",
        inputSchema: z.object({ text: z.string().min(1).max(280) }),
        outputSchema: messageResult,
        annotations: { title: 'Send a message to the TV', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        icons: [ICON],
      },
      guard(async ({ text }) => {
        const r = await service.sendFamilyMessage(identity, text);
        return ok(`Sent. It's on ${r.deliveredTo} now.`, r);
      }),
    );
  }

  return server;
}
