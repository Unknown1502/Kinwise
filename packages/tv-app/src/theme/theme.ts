import {StyleSheet} from 'react-native';
import {UI_SCALE} from './scale';

/** Design units (1920×1080 canvas) → layout units. */
export const s = (n: number): number => Math.round(n * UI_SCALE);

/**
 * A warm family display. An evening blue-teal backdrop with a lamp glow; notes from family on
 * apricot paper with the sender's face; each kind of thing in the day gets its own colour and icon
 * (visitors mint, reminders sun, scam warnings coral, privacy lilac). Focus is white and grows the
 * selected item, the way Fire TV does. The Pause turns the whole screen persimmon: a pause, not an
 * alarm, so never red.
 */
export const colors = {
  /** Behind the backdrop image, and the darkest text on light surfaces. */
  deep: '#0B2230',
  backdrop: '#0F3142',
  glass: 'rgba(255, 255, 255, 0.08)',
  glassLine: 'rgba(255, 255, 255, 0.14)',
  glassStrong: 'rgba(255, 255, 255, 0.16)',
  white: '#FFFFFF',
  /** Secondary text on the backdrop: 8:1. */
  soft: '#B7CCD3',
  apricot: '#FFD5BA',
  apricotRead: '#F3DCCB',
  onApricot: '#3B2418',
  onApricotSoft: '#7A4A33',
  terracotta: '#C2552E',
  mint: '#7FDDB8',
  sun: '#FFD166',
  coral: '#FF8A65',
  lilac: '#C9B8FF',
  persimmon: '#EE6A3C',
  sheet: '#F4F7F8',
  onSheetSoft: '#46606B',
  scrim: 'rgba(5, 16, 23, 0.72)',
} as const;

/**
 * Atkinson Hyperlegible Next, drawn by the Braille Institute for readers with low vision.
 * Bundled in assets/fonts (SIL OFL). Each weight is its own family name so Vega and the browser
 * preview resolve the same file; fontWeight stays set so a fallback font keeps the hierarchy.
 */
export const fonts = {
  light: 'AtkinsonHyperlegibleNext-Light',
  regular: 'AtkinsonHyperlegibleNext-Regular',
  bold: 'AtkinsonHyperlegibleNext-Bold',
  heavy: 'AtkinsonHyperlegibleNext-ExtraBold',
} as const;

/** 5% overscan-safe margins on every edge of a 1920×1080 screen. */
export const SAFE = {
  horizontal: s(96),
  vertical: s(54),
} as const;

/** Focus ring: 5 px with a 4 px gap. White on the backdrop; deep on light and persimmon surfaces. */
export const FOCUS = {
  width: s(5),
  gap: s(4),
  color: colors.white,
} as const;

/** Card corners, by size: big panels are softer than buttons and chips. */
export const RADIUS = {
  panel: s(36),
  card: s(28),
  button: s(22),
  chip: s(16),
} as const;

const light = {fontFamily: fonts.light, fontWeight: '300' as const};
const regular = {fontFamily: fonts.regular, fontWeight: '400' as const};
const bold = {fontFamily: fonts.bold, fontWeight: '700' as const};
const heavy = {fontFamily: fonts.heavy, fontWeight: '800' as const};

/** Type scale for a 10-foot screen. Nothing is smaller than 28 px; body copy is 32 px. */
export const type = StyleSheet.create({
  clock: {...light, fontSize: s(150), lineHeight: s(158), color: colors.white, letterSpacing: -s(3)},
  greeting: {...bold, fontSize: s(58), lineHeight: s(68), color: colors.white},
  pause: {...heavy, fontSize: s(108), lineHeight: s(114), color: colors.deep, letterSpacing: -s(2)},
  display: {...bold, fontSize: s(68), lineHeight: s(80), color: colors.white},
  title: {...bold, fontSize: s(56), lineHeight: s(68), color: colors.white},
  message: {...regular, fontSize: s(46), lineHeight: s(62), color: colors.onApricot},
  heading: {...bold, fontSize: s(40), lineHeight: s(50), color: colors.white},
  lead: {...regular, fontSize: s(36), lineHeight: s(52), color: colors.white},
  body: {...regular, fontSize: s(32), lineHeight: s(46), color: colors.white},
  bodyStrong: {...bold, fontSize: s(32), lineHeight: s(46), color: colors.white},
  small: {...regular, fontSize: s(28), lineHeight: s(40), color: colors.soft},
  smallStrong: {...bold, fontSize: s(28), lineHeight: s(40), color: colors.soft},
  caption: {...regular, fontSize: s(36), lineHeight: s(50), color: colors.deep},
  button: {...bold, fontSize: s(34), lineHeight: s(42), color: colors.white},
});

export const MIN_TEXT_SIZE = 28;
