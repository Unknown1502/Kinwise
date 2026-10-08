/**
 * Plain HTTP calls to the hub that are not MCP: the /sim/ask bridge to the
 * concierge and the dev-only demo routes. Every function resolves to an
 * outcome object and never rejects, so callers cannot leak unhandled rejections.
 */
import {
  type AskFailure,
  type ConciergeResponse,
  ResponseShapeError,
  badResponse,
  classifyAskFailure,
  hubUnreachable,
  parseConciergeResponse,
} from './concierge';

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

export type AskOutcome = { ok: true; response: ConciergeResponse; clientMs: number } | { ok: false; failure: AskFailure };

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** POST {hub}/sim/ask — the concierge (simulated Alexa+ orchestrator) answers and returns its tool calls. */
export async function askConcierge(
  hubUrl: string,
  token: string,
  text: string,
  sessionId: string,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal; clock?: () => number } = {},
): Promise<AskOutcome> {
  const f = opts.fetchImpl ?? defaultFetch;
  const clock = opts.clock ?? (() => performance.now());
  const started = clock();
  let res: Response;
  try {
    res = await f(`${hubUrl}/sim/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, sessionId }),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, failure: { kind: 'http_error', title: 'Okay, never mind.', hint: 'Request cancelled.' } };
    }
    return { ok: false, failure: hubUnreachable(hubUrl) };
  }
  const body = await readJson(res);
  if (!res.ok) return { ok: false, failure: classifyAskFailure(res.status, body) };
  try {
    return { ok: true, response: parseConciergeResponse(body), clientMs: clock() - started };
  } catch (err) {
    return { ok: false, failure: badResponse(err instanceof ResponseShapeError ? err.message : 'The concierge reply could not be read.') };
  }
}

// ── Dev-only routes ──

export interface Notice {
  caregiverName: string;
  kind: string;
  title: string;
  body: string;
  at: string;
}

export type NoticesOutcome = { status: 'ok'; notices: Notice[] } | { status: 'unavailable' } | { status: 'offline' };

/** Keep only well-formed notices (strings only; rendered as text, never HTML). */
export function parseNotices(body: unknown): Notice[] {
  const list = body && typeof body === 'object' && Array.isArray((body as { notices?: unknown }).notices) ? (body as { notices: unknown[] }).notices : [];
  const out: Notice[] = [];
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    const r = n as Record<string, unknown>;
    if (typeof r.title !== 'string' || typeof r.at !== 'string') continue;
    out.push({
      caregiverName: typeof r.caregiverName === 'string' ? r.caregiverName : '',
      kind: typeof r.kind === 'string' ? r.kind : 'info',
      title: r.title,
      body: typeof r.body === 'string' ? r.body : '',
      at: r.at,
    });
  }
  return out;
}

export function noticeKey(n: Notice): string {
  return `${n.at}|${n.kind}|${n.title}`;
}

export async function fetchNotices(hubUrl: string, fetchImpl: FetchImpl = defaultFetch): Promise<NoticesOutcome> {
  try {
    const res = await fetchImpl(`${hubUrl}/dev/notices`, { cache: 'no-store' });
    if (res.status === 404) return { status: 'unavailable' };
    if (!res.ok) return { status: 'offline' };
    return { status: 'ok', notices: parseNotices(await readJson(res)) };
  } catch {
    return { status: 'offline' };
  }
}

export type DevOutcome<T> = { ok: true; data: T } | { ok: false; message: string };

export async function resetDemo(hubUrl: string, fetchImpl: FetchImpl = defaultFetch): Promise<DevOutcome<{ ok: boolean }>> {
  try {
    const res = await fetchImpl(`${hubUrl}/dev/reset`, { method: 'POST' });
    if (res.status === 404) return { ok: false, message: 'Dev routes are off on this hub (DEV_ROUTES=false).' };
    if (!res.ok) return { ok: false, message: `Reset failed (HTTP ${res.status}).` };
    return { ok: true, data: { ok: true } };
  } catch {
    return { ok: false, message: `Can't reach the hub at ${hubUrl}.` };
  }
}

export interface VisitorResult {
  duplicate: boolean;
  decision: string;
  alertId?: string;
}

export async function ringDoorbell(
  hubUrl: string,
  body: { personPresent: boolean; description?: string; carrying?: string },
  fetchImpl: FetchImpl = defaultFetch,
): Promise<DevOutcome<VisitorResult>> {
  try {
    const res = await fetchImpl(`${hubUrl}/dev/visitor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 404) return { ok: false, message: 'Dev routes are off on this hub (DEV_ROUTES=false).' };
    const json = (await readJson(res)) as Partial<VisitorResult> | undefined;
    if (!res.ok || !json || typeof json.decision !== 'string') return { ok: false, message: `Doorbell failed (HTTP ${res.status}).` };
    return { ok: true, data: { duplicate: !!json.duplicate, decision: json.decision, alertId: typeof json.alertId === 'string' ? json.alertId : undefined } };
  } catch {
    return { ok: false, message: `Can't reach the hub at ${hubUrl}.` };
  }
}

/** Plain-language summary of a door decision for the demo controls. */
export function describeDecision(r: VisitorResult): string {
  if (r.duplicate) return 'Duplicate event — ignored.';
  switch (r.decision) {
    case 'pause':
      return 'Unexpected visitor during a risk window → the Pause is showing on the TV.';
    case 'gentle':
      return "Unexpected visitor, no risk window → a gentle “not on today's list” card.";
    case 'expected':
      return 'Matched an expected visit → an “expected” card.';
    case 'activity':
      return 'No person visible → logged as activity only.';
    case 'ignored':
      return 'Ignored (privacy time or door awareness off) — nothing stored.';
    default:
      return `Decision: ${r.decision}`;
  }
}

/** POST {hub}/speech — a short-lived link to `text` in the hub's natural voice (Amazon Polly), or undefined. */
export async function requestSpeech(
  hubUrl: string,
  token: string,
  text: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<{ url: string; voice: string } | undefined> {
  const f = opts.fetchImpl ?? defaultFetch;
  try {
    const res = await f(`${hubUrl}/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return undefined;
    const body = (await readJson(res)) as { url?: unknown; voice?: unknown } | undefined;
    return typeof body?.url === 'string' ? { url: body.url, voice: typeof body.voice === 'string' ? body.voice : 'natural' } : undefined;
  } catch {
    return undefined;
  }
}
