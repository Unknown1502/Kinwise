import type {AlertView, TvStateView} from '../types';

/**
 * Which full screen the TV shows, and which overlay (if any) sits on top of it.
 * Pure and side-effect free so it can be unit-tested exhaustively.
 *
 * Rules (spec §5.6, §5.7 and the TV design):
 *  1. An active `pause` alert takes over the whole screen, even before onboarding:
 *     safety first, and the hub only raises it when door awareness is on.
 *  2. Otherwise the resident sees onboarding until `consent.onboardedAt` is set, then Home.
 *  3. An active `gentle` alert is a bottom panel over the base screen.
 *  4. An active `expected` alert is a small toast over the base screen.
 *  5. An open safety-watch question is a bottom sheet over Home (only when nothing about a visitor is showing),
 *     because only this TV can turn the watch on.
 *  6. Alerts the TV already handled locally (answered, or an expected toast that already
 *     auto-hid) are ignored until the hub stops reporting them.
 */

export type BaseScreen = 'onboarding' | 'pause' | 'home';
export type Overlay = 'gentle' | 'expected' | 'watch' | null;

export interface ScreenSelection {
  screen: BaseScreen;
  overlay: Overlay;
  /** The alert behind the Pause screen or the overlay, if any. */
  alert?: AlertView;
}

export interface SelectOptions {
  /** Alert ids the TV has already dealt with locally. */
  hiddenAlertIds?: ReadonlySet<string> | readonly string[];
  /** A safety-watch question she pressed Back on: it stays in Settings & privacy, but the sheet is not shown again. */
  hiddenWatchOfferId?: string;
}

export function visibleAlert(state: TvStateView, opts: SelectOptions = {}): AlertView | undefined {
  const alert = state.activeAlert ?? state.today?.activeAlert;
  if (!alert || alert.status !== 'active') return undefined;
  const hidden = opts.hiddenAlertIds;
  if (hidden) {
    const isHidden = Array.isArray(hidden) ? hidden.includes(alert.id) : (hidden as ReadonlySet<string>).has(alert.id);
    if (isHidden) return undefined;
  }
  return alert;
}

export function selectScreen(state: TvStateView, opts: SelectOptions = {}): ScreenSelection {
  const alert = visibleAlert(state, opts);
  if (alert?.kind === 'pause') return {screen: 'pause', overlay: null, alert};

  const screen: BaseScreen = state.consent?.onboardedAt ? 'home' : 'onboarding';
  if (alert?.kind === 'gentle') return {screen, overlay: 'gentle', alert};
  if (alert?.kind === 'expected') return {screen, overlay: 'expected', alert};
  const offer = state.watch?.state === 'offered' ? state.watch.offer : undefined;
  if (screen === 'home' && offer && offer.id !== opts.hiddenWatchOfferId) return {screen, overlay: 'watch'};
  return {screen, overlay: null};
}
