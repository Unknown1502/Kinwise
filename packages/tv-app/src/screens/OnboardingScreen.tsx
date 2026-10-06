import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {FocusButton} from '../components/FocusButton';
import {ToggleRow} from '../components/ToggleRow';
import {useBack} from '../input/backBus';
import {consentItems} from '../logic/consentCopy';
import {SAFE, colors, s, type} from '../theme/theme';
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
                  <FocusButton variant="primary" label="Get started" onSelect={() => setStep(1)} />
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
                <FocusButton label="Back" onSelect={() => setStep(0)} style={styles.gap} />
                <FocusButton variant="primary" label="Next" onSelect={() => setStep(2)} />
              </SpatialNavigationView>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <View style={styles.facts}>
                <Fact
                  heading={`What ${caregiver} may see`}
                  text={`Signals like “An unexpected visitor came at 2:41 PM. The Pause was shown. ${resident} chose Call ${caregiver}.”`}
                />
                <Fact heading={`What ${caregiver} never sees`} text="Video, photos, or the words you or a caller said." />
                <Fact
                  heading="You stay in charge"
                  text={`Change any switch in Settings & privacy, and see every time ${caregiver} looks at your information.`}
                />
              </View>
              {error ? <Text style={[type.bodyStrong, styles.error]}>{error}</Text> : null}
              <SpatialNavigationView direction="horizontal" style={styles.buttonsTight}>
                <FocusButton label="Back" onSelect={() => setStep(1)} style={styles.gap} />
                <DefaultFocus>
                  <FocusButton
                    variant="primary"
                    label="Finish"
                    accessibilityHint="Saves your choices and opens Today at Home"
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

function Fact({heading, text}: {heading: string; text: string}) {
  return (
    <View style={styles.fact} accessible accessibilityRole="text" accessibilityLabel={`${heading}. ${text}`}>
      <Text style={type.bodyStrong}>{heading}</Text>
      <Text style={[type.body, styles.muted]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
    alignItems: 'center',
    justifyContent: 'center',
  },
  column: {
    width: '100%',
    maxWidth: s(1440),
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(24),
  },
  stepDot: {
    width: s(18),
    height: s(18),
    borderRadius: s(9),
    marginRight: s(12),
    backgroundColor: colors.line,
  },
  stepDotOn: {
    backgroundColor: colors.cream,
    width: s(44),
  },
  stepText: {
    marginLeft: s(12),
  },
  para: {
    marginTop: s(24),
    maxWidth: s(1300),
  },
  muted: {
    color: colors.muted,
  },
  toggles: {
    marginTop: s(24),
  },
  toggle: {
    marginBottom: s(4),
  },
  buttons: {
    marginTop: s(56),
  },
  buttonsTight: {
    marginTop: s(28),
  },
  gap: {
    marginRight: s(16),
  },
  facts: {
    marginTop: s(32),
  },
  fact: {
    backgroundColor: colors.surface,
    borderRadius: s(24),
    borderWidth: s(2),
    borderColor: colors.line,
    paddingVertical: s(24),
    paddingHorizontal: s(32),
    marginBottom: s(16),
  },
  error: {
    marginTop: s(8),
    color: colors.caution,
  },
});
