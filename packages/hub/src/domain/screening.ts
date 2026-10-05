import { CATEGORY_ORDER, CATEGORY_RULES } from './patterns.js';
import type { RiskLevel, ScreeningResult, SignalCategory } from './types.js';

/** Lowercase, drop apostrophes, turn every other non-alphanumeric run into one space. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Spec §5.2: <2 → none, 2 → elevated, ≥3 or courier+unusual payment → high. */
export function levelFor(categories: readonly SignalCategory[]): RiskLevel {
  const set = new Set(categories);
  if (set.has('courier_pickup') && set.has('unusual_payment')) return 'high';
  if (set.size >= 3) return 'high';
  if (set.size === 2) return 'elevated';
  return 'none';
}

export function sortCategories(categories: Iterable<SignalCategory>): SignalCategory[] {
  const set = new Set(categories);
  return CATEGORY_ORDER.filter((c) => set.has(c));
}

export function screen(text: string): ScreeningResult {
  const normalized = normalize(text);
  if (!normalized) return { level: 'none', categories: [] };
  const hits = CATEGORY_RULES.filter((rule) => rule.patterns.some((p) => p.test(normalized))).map((r) => r.key);
  // Single-category hits are kept (level stays `none`): cross-session accumulation
  // needs them, e.g. "courier at 2" today + "it's the bank calling" later.
  const categories = sortCategories(hits);
  return { level: levelFor(categories), categories };
}

/** Max of two risk levels. */
export function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { none: 0, elevated: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}
