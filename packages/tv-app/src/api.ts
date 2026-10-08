import type {
  AlertAction,
  ConsentPatch,
  Consent,
  PrivacyHourResult,
  ProposalDecision,
  RespondResult,
  SafetyView,
  TvStateView,
} from './types';

/** Typed client for the Kinwise hub's Fire TV API (spec §6.2). Bearer device token, 8 s timeouts. */

export const DEFAULT_TIMEOUT_MS = 8000;

export class HubError extends Error {
  /** HTTP status, or 0 for network failures and timeouts. */
  readonly status: number;
  /** Hub error code (e.g. "invalid_token", "not_found"), "timeout" or "network". */
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.code = code;
  }

  /** True when retrying later may help (network trouble, timeouts, 5xx, 429). */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HubClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch (React Native and browsers both provide it). */
  fetchImpl?: FetchLike;
}

export class HubClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: HubClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  getState(): Promise<TvStateView> {
    return this.request<TvStateView>('GET', '/tv/state');
  }

  respondToAlert(alertId: string, action: AlertAction): Promise<RespondResult> {
    return this.request<RespondResult>('POST', `/tv/alerts/${encodeURIComponent(alertId)}/respond`, {action});
  }

  /** Quietly clear an expected-visitor notice on the hub after the toast was shown. */
  acknowledgeAlert(alertId: string): Promise<{ok: boolean}> {
    return this.request<{ok: boolean}>('POST', `/tv/alerts/${encodeURIComponent(alertId)}/seen`, {});
  }

  decideProposal(visitId: string, decision: ProposalDecision): Promise<unknown> {
    return this.request('POST', `/tv/proposals/${encodeURIComponent(visitId)}`, {decision});
  }

  updateConsent(patch: ConsentPatch): Promise<Consent> {
    return this.request<Consent>('POST', '/tv/consent', patch);
  }

  /** 0 ends privacy time; the hub accepts 0–720. */
  setPrivacyHour(minutes: number): Promise<PrivacyHourResult> {
    return this.request<PrivacyHourResult>('POST', '/tv/privacy-hour', {minutes});
  }

  markMessageRead(messageId: string): Promise<{ok: boolean}> {
    return this.request<{ok: boolean}>('POST', `/tv/messages/${encodeURIComponent(messageId)}/read`, {});
  }

  /** Resident ends the safety watch (risk window) early. */
  closeSafety(): Promise<SafetyView> {
    return this.request<SafetyView>('POST', '/tv/safety/close', {});
  }

  /** A short-lived link to `text` spoken in the hub's natural voice (Amazon Polly). Plays without auth headers. */
  async speechUrl(text: string): Promise<string | undefined> {
    const r = await this.request<{url?: string}>('POST', '/speech', {text});
    return typeof r?.url === 'string' ? r.url : undefined;
  }

  /** Resolve a hub-relative media path (e.g. "/media/priya-pause.mp4") against the hub URL. */
  mediaUrl(path: string | undefined): string | undefined {
    return resolveMediaUrl(this.baseUrl, path);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let res: Response;
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
      };
      if (body !== undefined) headers['content-type'] = 'application/json';
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new HubError(`Kinwise hub did not answer within ${this.timeoutMs / 1000} s`, 0, 'timeout');
      throw new HubError(`Can't reach the Kinwise hub at ${this.baseUrl}`, 0, 'network');
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown;
    try {
      const text = await res.text();
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }

    if (!res.ok) {
      const p = (payload ?? {}) as {error?: string; error_description?: string};
      throw new HubError(p.error_description ?? `Kinwise hub returned ${res.status}`, res.status, p.error ?? 'http_error');
    }
    return payload as T;
  }
}

export function resolveMediaUrl(baseUrl: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}
