import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {FocusButton} from '../components/FocusButton';
import {IconBadge, type IconName} from '../components/Icon';
import {ToggleRow} from '../components/ToggleRow';
import {useBack} from '../input/backBus';
import {consentItems} from '../logic/consentCopy';
import {FOCUS, RADIUS, SAFE, colors, s, type} from '../theme/theme';
import type {Consent, ConsentKey, TvStateView} from '../types';

export type ConsentDraft = Record<ConsentKey, boolean>;

export interface OnboardingScreenProps {
  state: TvStateView;
  active: boolean;
  busy?: boolean;
  error?: string;
  onFinish: (draft: ConsentDraft) => void;
}

const STEPS = 3;

function draftFrom(c: Consent): ConsentDraft {
  return {
    scamScreening: c.scamScreening,
    doorAwareness: c.doorAwareness,
    caregiverAlerts: c.caregiverAlerts,
    shareTimelineWithCaregiver: c.shareTimelineWithCaregiver,
  };
}

/** Three calm steps. Nothing is saved until "Finish": the resident owns every switch. */
export function OnboardingScreen({state, active, busy, error, onFinish}: OnboardingScreenProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ConsentDraft>(() => draftFrom(state.consent));
  const caregiver = state.caregiver.name;
  const resident = state.resident.name;
  const items = consentItems(caregiver);

  useBack(() => {
    if (!active || step === 0) return false;
    setStep((n) => n - 1);
    return true;
  });

  const titles = [
    'Kinwise is your second opinion',
    'Choose what Kinwise may notice',
    `${caregiver} sees signals, never recordings`,
  ];

  useEffect(() => {
    announce(`Step ${step + 1} of ${STEPS}. ${titles[step]}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <SpatialNavigationRoot key={step} isActive={active}>
      <View style={styles.screen} testID={`onboarding-step-${step + 1}`}>
        <View style={styles.column}>
          <View style={styles.stepper} accessible accessibilityRole="text" accessibilityLabel={`Step ${step + 1} of ${STEPS}`}>
            {Array.from({length: STEPS}, (_, i) => (
              <View key={i} style={[styles.stepDot, i === step ? styles.stepDotOn : null]} />
            ))}
            <Text style={[type.small, styles.stepText]}>{`Step ${step + 1} of ${STEPS}`}</Text>
          </View>
          <Text style={type.display} accessibilityRole="header">
            {titles[step]}
          </Text>

          {step === 0 ? (
            <>
              <Text style={[type.lead, styles.para]}>
                {`When something at the door doesn't add up, Kinwise pauses the moment and helps you check with ${caregiver}.`}
              </Text>
              <Text style={[type.lead, styles.para]}>
                It never locks doors or calls anyone on its own. You decide, and you own every switch.
              </Text>
              <SpatialNavigationView direction="horizontal" style={styles.buttons}>
                <DefaultFocus>
                  <FocusButton variant="primary" icon="check" label="Get started" onSelect={() => setStep(1)} />
                </DefaultFocus>
              </SpatialNavigationView>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Text style={[type.body, styles.para, styles.muted]}>You can change any of these later in Settings & privacy.</Text>
              <SpatialNavigationView direction="vertical" style={styles.toggles}>
                {items.map((item, index) => (
                  <DefaultFocus key={item.key} enable={index === 0}>
                    <ToggleRow
                      title={item.title}
                      explanation={item.explanation}
                      value={draft[item.key]}
                      onToggle={(next) => {
                        setDraft((d) => ({...d, [item.key]: next}));
                        announce(`${item.title}: ${next ? 'on' : 'off'}`);
                      }}
                      style={styles.toggle}
                    />
                  </DefaultFocus>
                ))}
              </SpatialNavigationView>
              <SpatialNavigationView direction="horizontal" style={styles.buttonsTight}>
                <FocusButton icon="arrow-left" label="Back" onSelect={() => setStep(0)} style={styles.gap} />
                <FocusButton variant="primary" label="Next" onSelect={() => setStep(2)} />
              </SpatialNavigationView>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <View style={styles.facts}>
                <Fact
                  icon="eye"
                  color={colors.mint}
                  heading={`What ${caregiver} may see`}
                  text={`Signals like “An unexpected visitor came at 2:41 PM. The Pause was shown. ${resident} chose Call ${caregiver}.”`}
                />
                <Fact icon="x" color={colors.coral} heading={`What ${caregiver} never sees`} text="Video, photos, or the words you or a caller said." />
                <Fact
                  icon="settings"
                  color={colors.sun}
                  heading="You stay in charge"
                  text={`Change any switch in Settings & privacy, and see every time ${caregiver} looks at your information.`}
                />
              </View>
              {error ? <Text style={[type.bodyStrong, styles.error]}>{error}</Text> : null}
              <SpatialNavigationView direction="horizontal" style={styles.buttonsTight}>
                <FocusButton icon="arrow-left" label="Back" onSelect={() => setStep(1)} style={styles.gap} />
                <DefaultFocus>
                  <FocusButton
                    variant="primary"
                    label="Finish"
                    accessibilityHint="Saves your choices and opens the home screen"
                    busy={busy}
                    onSelect={() => onFinish(draft)}
                  />
                </DefaultFocus>
              </SpatialNavigationView>
            </>
          ) : null}
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

function Fact({heading, text, icon, color}: {heading: string; text: string; icon: IconName; color: string}) {
  return (
    <View style={styles.fact} accessible accessibilityRole="text" accessibilityLabel={`${heading}. ${text}`}>
      <IconBadge name={icon} color={color} size={s(64)} style={styles.factHead} />
      <Text style={type.bodyStrong}>{heading}</Text>
      <Text style={[type.body, styles.muted]}>{text}</Text>
    </View>
  );
}

const RING = FOCUS.width + FOCUS.gap;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
    justifyContent: 'center',
  },
  column: {
    width: '100%',
    maxWidth: s(1500),
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(28),
  },
  stepDot: {
    width: s(56),
    height: s(6),
    borderRadius: s(3),
    marginRight: s(10),
    backgroundColor: colors.glassStrong,
  },
  stepDotOn: {
    backgroundColor: colors.sun,
  },
  stepText: {
    marginLeft: s(14),
  },
  para: {
    marginTop: s(24),
    maxWidth: s(1300),
  },
  muted: {
    color: colors.soft,
  },
  toggles: {
    marginTop: s(20),
    marginHorizontal: -RING,
  },
  toggle: {
    marginBottom: -s(4),
  },
  buttons: {
    marginTop: s(56),
    marginLeft: -RING,
  },
  buttonsTight: {
    marginTop: s(28),
    marginLeft: -RING,
  },
  gap: {
    marginRight: s(8),
  },
  facts: {
    flexDirection: 'row',
    marginTop: s(40),
    marginBottom: s(16),
  },
  fact: {
    flex: 1,
    backgroundColor: colors.glass,
    borderColor: colors.glassLine,
    borderWidth: s(2),
    borderRadius: RADIUS.card,
    padding: s(30),
    marginRight: s(24),
  },
  factHead: {
    marginBottom: s(16),
  },
  error: {
    marginTop: s(8),
    color: colors.coral,
  },
});
