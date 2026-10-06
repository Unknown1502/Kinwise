import {useCallback, useEffect, useRef, useState} from 'react';
import type {HubClient} from '../api';
import {isStale, Poller, POLL_INTERVAL_MS, STALE_AFTER_MS} from '../logic/poller';
import type {TvStateView} from '../types';

export interface HubState {
  state?: TvStateView;
  /** Last polling error (cleared on the next success). */
  error?: unknown;
  /** Local Date.now() of the last successful poll. */
  lastUpdated?: number;
  /** Data older than 10 s: show the unobtrusive "Reconnecting…" banner. */
  stale: boolean;
  /** Poll right away (after the resident pressed something). */
  refresh: () => void;
  /** Optimistically apply a local change until the next poll confirms it. */
  patch: (fn: (s: TvStateView) => TvStateView) => void;
}

interface Snapshot {
  state?: TvStateView;
  error?: unknown;
  lastUpdated?: number;
}

/** Polls GET /tv/state every 2 s, backing off exponentially (up to 15 s) while the hub is unreachable. */
export function useHubState(
  client: HubClient,
  opts: {intervalMs?: number; maxBackoffMs?: number; staleMs?: number} = {},
): HubState {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const staleMs = opts.staleMs ?? STALE_AFTER_MS;
  const [snap, setSnap] = useState<Snapshot>({});
  const [stale, setStale] = useState(false);
  const pollerRef = useRef<Poller<TvStateView> | null>(null);
  const lastUpdatedRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const poller = new Poller<TvStateView>({
      fetch: () => client.getState(),
      intervalMs,
      maxBackoffMs: opts.maxBackoffMs,
      onData: (state, at) => {
        lastUpdatedRef.current = at;
        setSnap({state, lastUpdated: at, error: undefined});
        setStale(false);
      },
      onError: (error) => {
        setSnap((prev) => ({...prev, error}));
        setStale(isStale(lastUpdatedRef.current, Date.now(), staleMs));
      },
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [client, intervalMs, opts.maxBackoffMs, staleMs]);

  // Re-check staleness between polls (backoff can stretch to 15 s).
  useEffect(() => {
    const id = setInterval(() => setStale(isStale(lastUpdatedRef.current, Date.now(), staleMs)), 1000);
    return () => clearInterval(id);
  }, [staleMs]);

  const refresh = useCallback(() => pollerRef.current?.refresh(), []);
  const patch = useCallback((fn: (s: TvStateView) => TvStateView) => {
    setSnap((prev) => (prev.state ? {...prev, state: fn(prev.state)} : prev));
  }, []);

  return {...snap, stale, refresh, patch};
}
