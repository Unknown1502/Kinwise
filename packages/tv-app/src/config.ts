/**
 * Where the TV app finds the Kinwise hub.
 *
 * This plain file is what the browser preview (packages/tv-preview) uses: the hub runs on the
 * same machine. On Vega, src/config.vega.ts overrides it (Metro resolves *.vega.ts first).
 * The preview can also be pointed elsewhere with ?hub=…&token=… in its URL (see tv-preview).
 */
export interface TvConfig {
  /** Base URL of the Kinwise hub, without a trailing slash. */
  hubUrl: string;
  /** Bearer device token for /tv/* (AUTH_MODE=dev accepts "dev-tv"). */
  deviceToken: string;
  /** How often to poll GET /tv/state. */
  pollMs: number;
}

export const DEFAULT_CONFIG: TvConfig = {
  hubUrl: 'http://localhost:8787',
  deviceToken: 'dev-tv',
  pollMs: 2000,
};

let current: TvConfig = DEFAULT_CONFIG;

export function getConfig(): TvConfig {
  return current;
}

/** Used by the browser preview to apply ?hub= / ?token= overrides before the app mounts. */
export function setConfig(patch: Partial<TvConfig>): TvConfig {
  current = {...current, ...patch, hubUrl: (patch.hubUrl ?? current.hubUrl).replace(/\/+$/, '')};
  return current;
}
