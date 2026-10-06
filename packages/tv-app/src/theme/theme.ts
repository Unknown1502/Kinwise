import {StyleSheet} from 'react-native';
import {UI_SCALE} from './scale';

/** Design units (1920×1080 canvas) → layout units. */
export const s = (n: number): number => Math.round(n * UI_SCALE);

/** Calm, high-contrast palette. The Pause is orange, not red: it is a pause, not an alarm. */
export const colors = {
  bg: '#0f1712',
  surface: '#17231b',
  surface2: '#1f2f24',
  line: '#2c4033',
  text: '#f5f1e8',
  muted: '#b9c2b5',
  cream: '#fef3c7',
  ok: '#4ade80',
  caution: '#fbbf24',
  pause: '#fb923c',
  focus: '#fde68a',
  onLight: '#0f1712',
  onPause: '#1c1207',
  scrim: 'rgba(8, 12, 9, 0.62)',
  cautionTint: 'rgba(251, 191, 36, 0.14)',
  okTint: 'rgba(74, 222, 128, 0.14)',
  pauseTint: 'rgba(251, 146, 60, 0.14)',
  creamTint: 'rgba(254, 243, 199, 0.12)',
} as const;

/** 5% overscan-safe margins on every edge of a 1920×1080 screen. */
export const SAFE = {
  horizontal: s(96),
  vertical: s(54),
} as const;

/** Focus ring: 6 px amber, with a 4 px gap so it reads on light and dark fills alike. */
export const FOCUS = {
  width: s(6),
  gap: s(4),
  color: colors.focus,
} as const;

/**
 * Type scale. Nothing on screen is smaller than 28 px; screen titles are 48–64 px.
 */
export const type = StyleSheet.create({
  clock: {fontSize: s(148), lineHeight: s(164), fontWeight: '300', color: colors.text, letterSpacing: -s(2)},
  display: {fontSize: s(64), lineHeight: s(76), fontWeight: '700', color: colors.cream},
  title: {fontSize: s(56), lineHeight: s(68), fontWeight: '700', color: colors.cream},
  title48: {fontSize: s(48), lineHeight: s(60), fontWeight: '700', color: colors.cream},
  section: {fontSize: s(38), lineHeight: s(48), fontWeight: '700', color: colors.cream},
  lead: {fontSize: s(38), lineHeight: s(52), fontWeight: '400', color: colors.text},
  body: {fontSize: s(32), lineHeight: s(44), fontWeight: '400', color: colors.text},
  bodyStrong: {fontSize: s(32), lineHeight: s(44), fontWeight: '700', color: colors.text},
  small: {fontSize: s(28), lineHeight: s(38), fontWeight: '400', color: colors.muted},
  smallStrong: {fontSize: s(28), lineHeight: s(38), fontWeight: '700', color: colors.muted},
  caption: {fontSize: s(36), lineHeight: s(50), fontWeight: '500', color: colors.text},
});

export const MIN_TEXT_SIZE = 28;
