/*
 * Pure-logic specs. Uses only describe/it/expect so it runs under jest (Vega toolchain,
 * `npm test` here) and under vitest (packages/tv-preview includes this folder).
 */
import {selectScreen, visibleAlert} from '../src/logic/selectScreen';
import {expectedAlert, gentleAlert, homeState, notOnboarded, pauseAlert, withAlert} from './fixtures';

describe('selectScreen', () => {
  it('shows Home when onboarded and nothing is happening', () => {
    expect(selectScreen(homeState())).toEqual({screen: 'home', overlay: null});
  });

  it('shows onboarding until consent.onboardedAt is set', () => {
    expect(selectScreen(notOnboarded(homeState()))).toEqual({screen: 'onboarding', overlay: null});
  });

  it('treats an empty onboardedAt as not onboarded', () => {
    const s = homeState();
    expect(selectScreen({...s, consent: {...s.consent, onboardedAt: ''}}).screen).toBe('onboarding');
  });

  it('takes over the whole screen with the Pause', () => {
    const alert = pauseAlert();
    expect(selectScreen(withAlert(homeState(), alert))).toEqual({screen: 'pause', overlay: null, alert});
  });

  it('shows the Pause even before onboarding (safety first)', () => {
    const sel = selectScreen(withAlert(notOnboarded(homeState()), pauseAlert()));
    expect(sel.screen).toBe('pause');
    expect(sel.overlay).toBeNull();
  });

  it('shows the Pause for an elevated-risk pause too', () => {
    expect(selectScreen(withAlert(homeState(), pauseAlert({riskLevel: 'elevated'}))).screen).toBe('pause');
  });

  it('puts a gentle alert over Home as a bottom panel', () => {
    const alert = gentleAlert();
    expect(selectScreen(withAlert(homeState(), alert))).toEqual({screen: 'home', overlay: 'gentle', alert});
  });

  it('puts a gentle alert over onboarding too', () => {
    expect(selectScreen(withAlert(notOnboarded(homeState()), gentleAlert()))).toMatchObject({
      screen: 'onboarding',
      overlay: 'gentle',
    });
  });

  it('shows an expected visitor as a toast over Home', () => {
    const alert = expectedAlert();
    expect(selectScreen(withAlert(homeState(), alert))).toEqual({screen: 'home', overlay: 'expected', alert});
  });

  it('ignores alerts that are not active', () => {
    for (const status of ['resolved', 'expired'] as const) {
      expect(selectScreen(withAlert(homeState(), pauseAlert({status})))).toEqual({screen: 'home', overlay: null});
      expect(selectScreen(withAlert(homeState(), gentleAlert({status})))).toEqual({screen: 'home', overlay: null});
    }
  });

  it('ignores alerts the TV already handled (Set)', () => {
    const state = withAlert(homeState(), pauseAlert());
    expect(selectScreen(state, {hiddenAlertIds: new Set(['alert_pause_1'])})).toEqual({screen: 'home', overlay: null});
  });

  it('ignores alerts the TV already handled (array)', () => {
    const state = withAlert(homeState(), expectedAlert());
    expect(selectScreen(state, {hiddenAlertIds: ['alert_expected_1']})).toEqual({screen: 'home', overlay: null});
  });

  it('shows a new alert even when an older one was hidden', () => {
    const state = withAlert(homeState(), pauseAlert({id: 'alert_new'}));
    expect(selectScreen(state, {hiddenAlertIds: new Set(['alert_pause_1'])}).screen).toBe('pause');
  });

  it('falls back to today.activeAlert when the top-level field is missing', () => {
    const s = homeState();
    const alert = gentleAlert();
    const state = {...s, today: {...s.today, activeAlert: alert}};
    expect(selectScreen(state)).toEqual({screen: 'home', overlay: 'gentle', alert});
  });

  it('prefers the top-level activeAlert over today.activeAlert', () => {
    const s = homeState();
    const state = {...s, activeAlert: pauseAlert(), today: {...s.today, activeAlert: gentleAlert()}};
    expect(selectScreen(state).screen).toBe('pause');
  });

  it('does not mutate its input', () => {
    const state = withAlert(homeState(), pauseAlert());
    const before = JSON.stringify(state);
    selectScreen(state, {hiddenAlertIds: new Set(['x'])});
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('visibleAlert', () => {
  it('returns undefined when there is no alert', () => {
    expect(visibleAlert(homeState())).toBeUndefined();
  });

  it('returns the active alert', () => {
    expect(visibleAlert(withAlert(homeState(), gentleAlert()))?.id).toBe('alert_gentle_1');
  });
});
