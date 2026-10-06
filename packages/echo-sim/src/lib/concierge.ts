/**
 * The /sim/ask contract (ConciergeResponse) plus validation and friendly error
 * classification. Pure: no DOM, no fetch — unit-tested.
 */
import { z } from 'zod';

const textContent = z.object({ type: z.literal('text'), text: z.string() }).passthrough();
const anyContent = z.union([textContent, z.object({ type: z.string() }).passthrough()]);

export const toolResultSchema = z
  .object({
    content: z.array(anyContent).optional(),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

export const toolCallSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional().default({}),
    result: toolResultSchema.optional().default({}),
    uiResourceUri: z
      .string()
      .optional()
      .transform((v) => (v && v.startsWith('ui://') ? v : undefined)),
    latencyMs: z.number().nonnegative().optional(),
  })
  .passthrough();

export const conciergeResponseSchema = z
  .object({
    reply: z.string(),
    toolCalls: z.array(toolCallSchema).optional().default([]),
    sessionId: z.string().optional().default(''),
    model: z.string().optional().default('unknown'),
    latencyMs: z.number().nonnegative().optional().default(0),
  })
  .passthrough();

export type ToolResult = z.infer<typeof toolResultSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ConciergeResponse = z.infer<typeof conciergeResponseSchema>;

export class ResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseShapeError';
  }
}

function withoutNulls(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null));
}

/**
 * Drop JSON nulls on the envelope levels only (response, tool call, tool result),
 * since Python serialisers often emit null for "absent". structuredContent is untouched.
 */
export function normaliseNulls(body: unknown): unknown {
  const top = withoutNulls(body) as { toolCalls?: unknown } | unknown;
  if (top && typeof top === 'object' && Array.isArray((top as { toolCalls?: unknown }).toolCalls)) {
    const t = top as { toolCalls: unknown[] };
    t.toolCalls = t.toolCalls.map((c) => {
      const call = withoutNulls(c) as { result?: unknown } | unknown;
      if (call && typeof call === 'object' && 'result' in call) (call as { result: unknown }).result = withoutNulls((call as { result: unknown }).result);
      return call;
    });
  }
  return top;
}

/** Validate and normalise a /sim/ask body. Throws ResponseShapeError on a bad shape. */
export function parseConciergeResponse(body: unknown): ConciergeResponse {
  const parsed = conciergeResponseSchema.safeParse(normaliseNulls(body));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? first.path.join('.') : 'body';
    throw new ResponseShapeError(`The concierge sent an unexpected reply (${where}: ${first?.message ?? 'invalid'}).`);
  }
  return parsed.data;
}

/** Join the text blocks of a tool result (what a voice surface would read). */
export function resultText(result: { content?: ReadonlyArray<{ type: string; text?: unknown }> } | undefined): string {
  if (!result?.content) return '';
  return result.content
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

export type AskFailureKind =
  | 'hub_unreachable'
  | 'unauthorized'
  | 'forbidden'
  | 'concierge_not_configured'
  | 'concierge_down'
  | 'bad_request'
  | 'bad_response'
  | 'http_error';

export interface AskFailure {
  kind: AskFailureKind;
  /** Calm, user-facing headline (shown on the Echo screen). */
  title: string;
  /** Developer hint (how to fix it). */
  hint: string;
  status?: number;
}

export const START_CONCIERGE_HINT = 'Start the concierge: cd agents/concierge && uv run kinwise-concierge';
export const START_HUB_HINT = 'Start the hub: cd packages/hub && npm run dev';

function errorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error: unknown }).error;
    return typeof e === 'string' ? e : undefined;
  }
  return undefined;
}

function errorDescription(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error_description' in body) {
    const e = (body as { error_description: unknown }).error_description;
    return typeof e === 'string' ? e : undefined;
  }
  return undefined;
}

/** Map an HTTP failure from POST /sim/ask to a calm explanation and a fix-it hint. */
export function classifyAskFailure(status: number, body: unknown): AskFailure {
  const code = errorCode(body);
  if (status === 401) {
    return {
      kind: 'unauthorized',
      status,
      title: "Kinwise didn't recognise this device.",
      hint: 'The hub rejected the bearer token (401). Check VITE_ASHA_TOKEN / VITE_PRIYA_TOKEN and that the hub runs with AUTH_MODE=dev.',
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      status,
      title: "This device isn't allowed to do that.",
      hint: errorDescription(body) ?? 'The hub returned 403 (forbidden). Check the token role and the allowed origins.',
    };
  }
  if (status === 503 && code === 'concierge_not_configured') {
    return {
      kind: 'concierge_not_configured',
      status,
      title: "The assistant isn't connected yet.",
      hint: `The hub has no concierge configured (503). ${START_CONCIERGE_HINT}`,
    };
  }
  if (status === 400) {
    return { kind: 'bad_request', status, title: "Sorry, I didn't catch that.", hint: errorDescription(body) ?? 'The hub returned 400.' };
  }
  if (status >= 500) {
    return {
      kind: 'concierge_down',
      status,
      title: "Sorry, the assistant isn't answering right now.",
      hint: `The hub could not reach the concierge (${status}). ${START_CONCIERGE_HINT}`,
    };
  }
  return { kind: 'http_error', status, title: 'Sorry, something went wrong.', hint: `The hub returned HTTP ${status}.` };
}

export function hubUnreachable(hubUrl: string): AskFailure {
  return {
    kind: 'hub_unreachable',
    title: "I can't reach Kinwise right now.",
    hint: `No response from the hub at ${hubUrl}. ${START_HUB_HINT}`,
  };
}

export function badResponse(message: string): AskFailure {
  return { kind: 'bad_response', title: 'Sorry, something went wrong.', hint: message };
}

/** A short spoken apology for a failure (Alexa-style, never alarming). */
export function spokenFailure(f: AskFailure): string {
  switch (f.kind) {
    case 'hub_unreachable':
      return "Sorry, I can't reach Kinwise right now.";
    case 'concierge_not_configured':
    case 'concierge_down':
      return "Sorry, I'm having trouble answering right now.";
    case 'bad_request':
      return "Sorry, I didn't catch that.";
    default:
      return 'Sorry, something went wrong.';
  }
}
