import { levelFor, maxLevel, sortCategories } from './screening.js';
import { addMinutes } from './time.js';
import type { RiskLevel, RiskWindow, SignalCategory, SignalRecord } from './types.js';

export const RISK_WINDOW_HOURS = 6;
export const ACCUMULATION_HOURS = 24;

/** Spec §5.3: union categories from the last 24 h of signals and level the union. */
export function accumulate(
  signals: readonly SignalRecord[],
  now: Date,
  hours = ACCUMULATION_HOURS,
): { level: RiskLevel; categories: SignalCategory[] } {
  const since = now.getTime() - hours * 3_600_000;
  const recent = signals.filter((s) => Date.parse(s.at) >= since && Date.parse(s.at) <= now.getTime());
  const categories = sortCategories(recent.flatMap((s) => s.categories));
  // An individual signal can be `high` on its own (e.g. courier + gold); keep the max.
  const level = recent.reduce<RiskLevel>((acc, s) => maxLevel(acc, s.level), levelFor(categories));
  return { level, categories };
}

export function isWindowActive(window: RiskWindow | undefined, now: Date): window is RiskWindow {
  return !!window && !window.closedAt && Date.parse(window.expiresAt) > now.getTime();
}

export interface WindowChange {
  window: RiskWindow | undefined;
  change: 'none' | 'opened' | 'upgraded' | 'extended';
}

/**
 * Spec §5.4: open, upgrade or extend the risk window after a new signal.
 * `signals` must already include the new signal.
 */
export function updateRiskWindow(
  current: RiskWindow | undefined,
  signals: readonly SignalRecord[],
  now: Date,
  newId: () => string,
  hours = RISK_WINDOW_HOURS,
): WindowChange {
  const { level, categories } = accumulate(signals, now);
  if (level === 'none') return { window: current, change: 'none' };
  const expiresAt = addMinutes(now, hours * 60);

  if (!isWindowActive(current, now)) {
    return {
      window: { id: newId(), openedAt: now.toISOString(), expiresAt, level, categories },
      change: 'opened',
    };
  }

  const upgraded = current.level === 'elevated' && level === 'high';
  return {
    window: {
      ...current,
      level: maxLevel(current.level, level) as RiskWindow['level'],
      categories: sortCategories([...current.categories, ...categories]),
      expiresAt: Date.parse(expiresAt) > Date.parse(current.expiresAt) ? expiresAt : current.expiresAt,
    },
    change: upgraded ? 'upgraded' : 'extended',
  };
}

export function closeRiskWindow(window: RiskWindow, now: Date, reason: string): RiskWindow {
  return { ...window, closedAt: now.toISOString(), closedReason: reason };
}
