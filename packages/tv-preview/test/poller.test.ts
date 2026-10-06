import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {isStale, nextDelay, Poller} from '../../tv-app/src/logic/poller';

describe('nextDelay', () => {
  it('polls every 2 s while healthy', () => {
    expect(nextDelay(0)).toBe(2000);
  });

  it('backs off exponentially and caps at 15 s', () => {
    expect([1, 2, 3, 4, 10, 100].map((n) => nextDelay(n))).toEqual([4000, 8000, 15000, 15000, 15000, 15000]);
  });

  it('respects custom base and cap', () => {
    expect(nextDelay(2, 1000, 3000)).toBe(3000);
    expect(nextDelay(1, 1000, 3000)).toBe(2000);
  });
});

describe('isStale', () => {
  it('is false before any data arrived', () => {
    expect(isStale(undefined, 1_000_000)).toBe(false);
  });
  it('is false within 10 s and true after', () => {
    expect(isStale(0, 10_000)).toBe(false);
    expect(isStale(0, 10_001)).toBe(true);
  });
});

describe('Poller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A fetch whose outcome per call is scripted: true = success, false = failure. */
  function scripted(outcomes: boolean[]) {
    let i = 0;
    const times: number[] = [];
    const fetch = vi.fn(async () => {
      times.push(Date.now());
      const ok = outcomes[Math.min(i, outcomes.length - 1)];
      i += 1;
      if (!ok) throw new Error('hub down');
      return {n: i};
    });
    return {fetch, times};
  }

  it('fetches immediately, then every 2 s', async () => {
    const {fetch, times} = scripted([true]);
    const onData = vi.fn();
    const p = new Poller({fetch, onData, onError: vi.fn()});
    const t0 = Date.now();
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6000);
    p.stop();
    expect(times.map((t) => t - t0)).toEqual([0, 2000, 4000, 6000]);
    expect(onData).toHaveBeenCalledTimes(4);
  });

  it('backs off 4 s, 8 s, 15 s, 15 s on errors and recovers to 2 s', async () => {
    const {fetch, times} = scripted([false, false, false, false, true, true]);
    const onError = vi.fn();
    const onData = vi.fn();
    const p = new Poller({fetch, onData, onError});
    const t0 = Date.now();
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4000 + 8000 + 15000 + 15000 + 2000);
    p.stop();
    expect(times.map((t) => t - t0)).toEqual([0, 4000, 12000, 27000, 42000, 44000]);
    expect(onError.mock.calls.map((c) => c[1])).toEqual([1, 2, 3, 4]);
    expect(onData).toHaveBeenCalledTimes(2);
    expect(p.consecutiveFailures).toBe(0);
  });

  it('refresh() polls right away and coalesces with a request in flight', async () => {
    let resolveFetch: ((v: number) => void) | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const p = new Poller({fetch, onData: vi.fn(), onError: vi.fn()});
    p.start();
    expect(fetch).toHaveBeenCalledTimes(1);
    p.refresh();
    p.refresh();
    expect(fetch).toHaveBeenCalledTimes(1); // still in flight
    resolveFetch!(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2); // queued refresh ran immediately, once
    resolveFetch!(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2); // back to the normal 2 s rhythm
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it('refresh() while idle skips the wait', async () => {
    const {fetch} = scripted([true]);
    const p = new Poller({fetch, onData: vi.fn(), onError: vi.fn()});
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    p.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('stop() prevents further polls and callbacks', async () => {
    let resolveFetch: ((v: number) => void) | undefined;
    const fetch = vi.fn(() => new Promise<number>((r) => (resolveFetch = r)));
    const onData = vi.fn();
    const p = new Poller({fetch, onData, onError: vi.fn()});
    p.start();
    p.stop();
    resolveFetch!(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(p.isRunning).toBe(false);
  });
});
