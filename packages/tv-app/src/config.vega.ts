/**
 * Vega override of src/config.ts (Metro resolves *.vega.ts before *.ts).
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ EDIT THIS ONE CONSTANT before `npm run build:debug`.                          │
 * │ The Vega Virtual Device and a Fire TV stick are separate network hosts:       │
 * │ "localhost" there is the device itself, not your laptop. Use the LAN IP of    │
 * │ the machine running the hub (e.g. `hostname -I` on Ubuntu), or the deployed   │
 * │ API Gateway URL.                                                               │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */
export const HUB_URL = 'http://192.168.1.50:8787';

/** Device token for /tv/*. "dev-tv" works with the hub's AUTH_MODE=dev; use a DEVICE_TOKENS entry on AWS. */
export const DEVICE_TOKEN = 'dev-tv';

export interface TvConfig {
  hubUrl: string;
  deviceToken: string;
  pollMs: number;
}

export const DEFAULT_CONFIG: TvConfig = {
  hubUrl: HUB_URL,
  deviceToken: DEVICE_TOKEN,
  pollMs: 2000,
};

let current: TvConfig = DEFAULT_CONFIG;

export function getConfig(): TvConfig {
  return current;
}

export function setConfig(patch: Partial<TvConfig>): TvConfig {
  current = {...current, ...patch, hubUrl: (patch.hubUrl ?? current.hubUrl).replace(/\/+$/, '')};
  return current;
}
