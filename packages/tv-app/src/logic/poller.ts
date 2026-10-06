/**
 * Polling with exponential backoff, independent of React so it can be tested with fake timers.
 * Success → poll again after `intervalMs` (2 s). Each consecutive failure doubles the delay,
 * capped at `maxBackoffMs` (15 s): 4 s, 8 s, 15 s, 15 s, …
 */

export const POLL_INTERVAL_MS = 2000;
export const MAX_BACKOFF_MS = 15000;
export const STALE_AFTER_MS = 10000;

export function nextDelay(failures: number, baseMs = POLL_INTERVAL_MS, maxMs = MAX_BACKOFF_MS): number {
  if (failures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 16));
}

/** True when we have shown data before but have not refreshed it for longer than `staleMs`. */
export function isStale(lastUpdated: number | undefined, now: number, staleMs = STALE_AFTER_MS): boolean {
  return lastUpdated !== undefined && now - lastUpdated > staleMs;
}

type TimerId = ReturnType<typeof setTimeout>;

export interface PollerOptions<T> {
  fetch: () => Promise<T>;
  onData: (data: T, at: number) => void;
  onError: (error: unknown, consecutiveFailures: number) => void;
  intervalMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
}

export class Poller<T> {
  private readonly opts: Required<Omit<PollerOptions<T>, 'fetch' | 'onData' | 'onError'>> & PollerOptions<T>;
  private timer: TimerId | undefined;
  private running = false;
  private inFlight = false;
  private refreshQueued = false;
  private failures = 0;

  constructor(opts: PollerOptions<T>) {
    this.opts = {
      intervalMs: POLL_INTERVAL_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      now: () => Date.now(),
      ...opts,
    };
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    this.refreshQueued = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Poll now (e.g. right after the resident pressed a button). Coalesces with a request in flight. */
  refresh(): void {
    if (!this.running) return;
    if (this.inFlight) {
      this.refreshQueued = true;
      return;
    }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    this.timer = undefined;
    this.inFlight = true;
    let ok = false;
    let data: T | undefined;
    let error: unknown;
    try {
      data = await this.opts.fetch();
      ok = true;
    } catch (err) {
      error = err;
    }
    this.inFlight = false;
    if (!this.running) return;

    if (ok) {
      this.failures = 0;
      this.opts.onData(data as T, this.opts.now());
    } else {
      this.failures += 1;
      this.opts.onError(error, this.failures);
    }
    if (!this.running) return;

    if (this.refreshQueued) {
      this.refreshQueued = false;
      this.schedule(0);
    } else {
      this.schedule(nextDelay(this.failures, this.opts.intervalMs, this.opts.maxBackoffMs));
    }
  }

  private schedule(ms: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }
}
