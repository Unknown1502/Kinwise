import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import backdrop from '../assets/home-bg.png';
import {SpatialNavigationDeviceTypeProvider} from 'react-tv-space-navigation';
import {announce} from './a11y/announce';
import {watchScreenReader} from './a11y/screenReader';
import {HubClient, HubError} from './api';
import {Banner} from './components/Banner';
import {asset} from './components/asset';
import {getConfig} from './config';
import {useHubState} from './hooks/useHubState';
import {useBack} from './input/backBus';
import {selectScreen} from './logic/selectScreen';
import {ExpectedToast} from './overlays/ExpectedToast';
import {GentleOverlay} from './overlays/GentleOverlay';
import {CALLING_CONFIRMATION_MS, CallingScreen} from './screens/CallingScreen';
import {HomeScreen} from './screens/HomeScreen';
import {LoadingScreen} from './screens/LoadingScreen';
import {OnboardingScreen, type ConsentDraft} from './screens/OnboardingScreen';
import {PauseScreen} from './screens/PauseScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {colors} from './theme/theme';
import type {AlertAction, AlertView, ConsentKey, ProposalDecision, TvStateView} from './types';

type Route = 'home' | 'settings';
interface Notice {
  text: string;
  tone: 'ok' | 'error';
}

const NOTICE_MS = 6000;

function friendlyError(err: unknown): string {
  if (err instanceof HubError) {
    if (err.code === 'timeout' || err.code === 'network') return "Kinwise couldn't be reached. Please try again.";
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

/** The alert is already closed elsewhere (Echo, expiry): just let it go. */
function isGoneError(err: unknown): boolean {
  return err instanceof HubError && (err.status === 404 || (err.status === 400 && /no longer active/i.test(err.message)));
}

export interface AppProps {
  /** Injected by tests and the preview; defaults to a client built from config. */
  client?: HubClient;
}

/**
 * Kinwise on Fire TV. No navigation library: a tiny state machine picks the screen.
 *   hub state ──selectScreen()──► onboarding | pause | home (+ gentle / expected overlay)
 *   local     ──────────────────► settings route, 5 s "Calling…" confirmation, notices
 */
export function App({client: injected}: AppProps = {}) {
  const config = getConfig();
  const client = useMemo(
    () => injected ?? new HubClient({baseUrl: config.hubUrl, token: config.deviceToken}),
    [injected, config.hubUrl, config.deviceToken],
  );
  const hub = useHubState(client, {intervalMs: config.pollMs});
  const {refresh, patch} = hub;
  const [route, setRoute] = useState<Route>('home');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [calling, setCalling] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pauseError, setPauseError] = useState<string | undefined>();
  const [onboardingError, setOnboardingError] = useState<string | undefined>();

  useEffect(() => watchScreenReader(), []);

  useEffect(() => {
    if (!calling) return;
    const t = setTimeout(() => setCalling(null), CALLING_CONFIRMATION_MS);
    return () => clearTimeout(t);
  }, [calling]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const hide = useCallback((alertId: string) => {
    setHidden((prev) => {
      if (prev.has(alertId)) return prev;
      const next = new Set(prev);
      next.add(alertId);
      return next;
    });
  }, []);

  const say = useCallback((text: string, tone: Notice['tone'] = 'ok') => {
    setNotice({text, tone});
    announce(text);
  }, []);

  /** Run one resident action: mark it busy, call the hub, refresh, and explain failures calmly. */
  const run = useCallback(
    async (key: string, action: () => Promise<void>, onError?: (err: unknown) => void) => {
      setBusyKey(key);
      try {
        await action();
      } catch (err) {
        if (onError) onError(err);
        else say(friendlyError(err), 'error');
      } finally {
        setBusyKey(null);
        refresh();
      }
    },
    [refresh, say],
  );

  const state = hub.state;
  const selection = state ? selectScreen(state, {hiddenAlertIds: hidden}) : undefined;
  const alert = selection?.alert;
  const showPause = !calling && selection?.screen === 'pause';
  const gentle = !calling && !showPause && selection?.overlay === 'gentle' ? alert : undefined;
  const expected = !calling && !showPause && selection?.overlay === 'expected' ? alert : undefined;
  const baseActive = !gentle;

  // Leaving Settings when something more important takes over keeps Back predictable.
  useEffect(() => {
    if (showPause || selection?.screen === 'onboarding') setRoute('home');
    // An earlier confirmation ("Okay, I closed the alert.") must not linger over the Pause.
    if (showPause) setNotice(null);
  }, [showPause, selection?.screen]);

  const respond = useCallback(
    (target: AlertView, action: AlertAction) => {
      setPauseError(undefined);
      return run(
        `alert:${action}`,
        async () => {
          const res = await client.respondToAlert(target.id, action);
          hide(target.id);
          if (action === 'call_family') {
            setCalling(target.caregiverName);
          } else {
            say(res.message);
          }
        },
        (err) => {
          if (isGoneError(err)) {
            hide(target.id);
            return;
          }
          const text =
            action === 'call_family'
              ? `Kinwise couldn't reach ${target.caregiverName}. Please call ${target.caregiverName} on your phone.`
              : friendlyError(err);
          if (target.kind === 'pause') setPauseError(text);
          else say(text, 'error');
        },
      );
    },
    [client, hide, run, say],
  );

  const togglePrivacy = useCallback(
    (minutes: number) =>
      run(`privacy:${minutes}`, async () => {
        const res = await client.setPrivacyHour(minutes);
        say(res.untilLabel ? `Privacy time is on until ${res.untilLabel}.` : 'Privacy time has ended. Kinwise is noticing the door again.');
      }),
    [client, run, say],
  );

  const homePrivacy = useCallback(() => {
    const on = Boolean(state?.today.privacyHourUntilLabel);
    void run('privacy', async () => {
      const res = await client.setPrivacyHour(on ? 0 : 60);
      say(res.untilLabel ? `Privacy time is on until ${res.untilLabel}.` : 'Privacy time has ended. Kinwise is noticing the door again.');
    });
  }, [client, run, say, state?.today.privacyHourUntilLabel]);

  const readMessage = useCallback(
    (id: string) => {
      patch((s: TvStateView) => ({
        ...s,
        today: {...s.today, messages: s.today.messages.map((m) => (m.id === id ? {...m, unread: false} : m))},
      }));
      announce('Marked as read.');
      void run(`msg:${id}`, () => client.markMessageRead(id).then(() => undefined));
    },
    [client, patch, run],
  );

  const toggleConsent = useCallback(
    (key: ConsentKey, value: boolean) =>
      run(`consent:${key}`, async () => {
        const consent = await client.updateConsent({[key]: value});
        patch((s) => ({...s, consent}));
        announce(`${value ? 'Turned on' : 'Turned off'}.`);
      }),
    [client, patch, run],
  );

  const decide = useCallback(
    (visitId: string, decision: ProposalDecision) =>
      run(`proposal:${visitId}:${decision}`, async () => {
        await client.decideProposal(visitId, decision);
        say(decision === 'approve' ? 'Added to your expected visitors.' : 'Declined. Nothing was added.');
      }),
    [client, run, say],
  );

  const closeSafety = useCallback(
    () =>
      run('safety', async () => {
        await client.closeSafety();
        say('Safety watch ended. Kinwise is back to its usual door awareness.');
      }),
    [client, run, say],
  );

  const finishOnboarding = useCallback(
    (draft: ConsentDraft) => {
      setOnboardingError(undefined);
      return run(
        'onboard',
        async () => {
          const consent = await client.updateConsent({...draft, onboarded: true});
          patch((s) => ({...s, consent}));
          say('All set. Welcome to Kinwise.');
        },
        (err) => setOnboardingError(friendlyError(err)),
      );
    },
    [client, patch, run, say],
  );

  useBack(() => {
    if (calling) {
      setCalling(null);
      return true;
    }
    if (showPause) {
      // The Pause is never closed by a stray Back press; every choice is one press away.
      announce('To close the Pause, choose Dismiss.');
      return true;
    }
    if (gentle) {
      void respond(gentle, 'dismiss');
      return true;
    }
    if (route === 'settings') {
      setRoute('home');
      return true;
    }
    return false;
  });

  let base: React.ReactNode;
  if (!state || !selection) {
    base = <LoadingScreen hubUrl={client.baseUrl} error={hub.error} />;
  } else if (calling) {
    base = <CallingScreen name={calling} />;
  } else if (showPause && alert) {
    base = (
      <PauseScreen
        key={alert.id}
        alert={alert}
        videoUrl={client.mediaUrl(alert.pauseMessage?.videoUrl)}
        busyAction={busyKey?.startsWith('alert:') ? (busyKey.slice(6) as AlertAction) : null}
        error={pauseError}
        onRespond={(action) => void respond(alert, action)}
      />
    );
  } else if (selection.screen === 'onboarding') {
    base = (
      <OnboardingScreen
        state={state}
        active={baseActive}
        busy={busyKey === 'onboard'}
        error={onboardingError}
        onFinish={(draft) => void finishOnboarding(draft)}
      />
    );
  } else if (route === 'settings') {
    base = (
      <SettingsScreen
        state={state}
        active={baseActive}
        busyKey={busyKey}
        onToggle={(k, v) => void toggleConsent(k, v)}
        onPrivacy={(m) => void togglePrivacy(m)}
        onDecide={(id, d) => void decide(id, d)}
        onCloseSafety={() => void closeSafety()}
        onBack={() => setRoute('home')}
      />
    );
  } else {
    base = (
      <HomeScreen
        state={state}
        receivedAt={hub.lastUpdated ?? Date.now()}
        active={baseActive}
        busyKey={busyKey}
        onPrivacy={homePrivacy}
        onOpenSettings={() => setRoute('settings')}
        onReadMessage={readMessage}
      />
    );
  }

  return (
    <SpatialNavigationDeviceTypeProvider>
      <View style={styles.app}>
        <Image source={BACKDROP} style={styles.backdrop} resizeMode="cover" accessible={false} />
        {base}
        {gentle ? (
          <GentleOverlay
            key={gentle.id}
            alert={gentle}
            busyAction={busyKey?.startsWith('alert:') ? (busyKey.slice(6) as AlertAction) : null}
            onRespond={(action) => void respond(gentle, action)}
          />
        ) : null}
        {expected ? (
          <ExpectedToast
            key={expected.id}
            alert={expected}
            onDone={(id) => {
              hide(id);
              // Best effort: also clear it on the hub so other surfaces stop showing it.
              client.acknowledgeAlert(id).catch(() => undefined);
            }}
          />
        ) : null}
        {state && hub.stale ? <Banner text="Reconnecting to Kinwise…" /> : null}
        {!hub.stale && notice && !showPause ? <Banner text={notice.text} tone={notice.tone} /> : null}
      </View>
    </SpatialNavigationDeviceTypeProvider>
  );
}

export default App;

const BACKDROP = asset(backdrop);

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.backdrop,
    overflow: 'hidden',
  },
  // Vega ignores edge pinning on images: give the backdrop an explicit full size.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
});
