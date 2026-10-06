import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  DefaultFocus,
  SpatialNavigationRoot,
  SpatialNavigationScrollView,
  SpatialNavigationView,
} from 'react-tv-space-navigation';
import type {SpatialNavigationNodeRef} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {Focusable} from '../components/Focusable';
import {FocusButton} from '../components/FocusButton';
import {ToggleRow} from '../components/ToggleRow';
import {consentItems} from '../logic/consentCopy';
import {plural} from '../logic/copy';
import {SAFE, colors, s, type} from '../theme/theme';
import type {ConsentKey, ProposalDecision, TvStateView} from '../types';

export interface SettingsScreenProps {
  state: TvStateView;
  active: boolean;
  busyKey?: string | null;
  onToggle: (key: ConsentKey, value: boolean) => void;
  onPrivacy: (minutes: number) => void;
  onDecide: (visitId: string, decision: ProposalDecision) => void;
  onCloseSafety: () => void;
  onBack: () => void;
}

const PRIVACY_CHOICES = [
  {minutes: 30, label: '30 minutes'},
  {minutes: 60, label: '1 hour'},
  {minutes: 120, label: '2 hours'},
];

function focusSafely(ref: React.RefObject<SpatialNavigationNodeRef>) {
  try {
    ref.current?.focus();
  } catch {
    // The node may not be registered yet; LRUD keeps a sensible focus anyway.
  }
}

/** Consent, privacy time, proposals, the access log and the safety watch, all owned by the resident. */
export function SettingsScreen({state, active, busyKey, onToggle, onPrivacy, onDecide, onCloseSafety, onBack}: SettingsScreenProps) {
  const {today, consent, pendingProposals, accessLog} = state;
  const caregiver = state.caregiver.name;
  const safety = today.safety;
  const watching = safety.level !== 'none';
  const privacyLabel = today.privacyHourUntilLabel;
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<SpatialNavigationNodeRef>(null);
  const endRef = useRef<SpatialNavigationNodeRef>(null);
  const firstConfirm = useRef(true);

  useEffect(() => {
    announce('Settings and privacy. Press Back to return to Today at Home.');
  }, []);

  useEffect(() => {
    if (!watching) setConfirming(false);
  }, [watching]);

  useEffect(() => {
    if (firstConfirm.current) {
      firstConfirm.current = false;
      return;
    }
    if (confirming) {
      focusSafely(keepRef);
      announce('End the safety watch now? Keep watching is selected.');
    } else {
      focusSafely(endRef);
    }
  }, [confirming]);

  return (
    <SpatialNavigationRoot isActive={active}>
      <View style={styles.screen} testID="settings-screen">
        <View style={styles.header}>
          <Text style={type.title} accessibilityRole="header">
            Settings & privacy
          </Text>
          <Text style={type.small}>Back returns to Today at Home</Text>
        </View>

        <SpatialNavigationScrollView offsetFromStart={s(160)} style={styles.scroll}>
          <View style={styles.content}>
            <DefaultFocus>
              <FocusButton label="Back to Today at Home" onSelect={onBack} style={styles.backButton} />
            </DefaultFocus>

            <Section title="What Kinwise may notice">
              <SpatialNavigationView direction="vertical">
                {consentItems(caregiver).map((item) => (
                  <ToggleRow
                    key={item.key}
                    title={item.title}
                    explanation={item.explanation}
                    value={consent[item.key]}
                    busy={busyKey === `consent:${item.key}`}
                    onToggle={(next) => onToggle(item.key, next)}
                    style={styles.rowGap}
                  />
                ))}
              </SpatialNavigationView>
            </Section>

            <Section title="Privacy time">
              <Text style={[type.body, styles.sectionText]}>
                {privacyLabel
                  ? `Privacy time is on until ${privacyLabel}. Kinwise isn't noticing the door and keeps no door activity.`
                  : 'Turn on privacy time and Kinwise stops noticing the door for a while. Nothing is recorded.'}
              </Text>
              <SpatialNavigationView direction="horizontal" style={styles.buttonRow}>
                {PRIVACY_CHOICES.map((c) => (
                  <FocusButton
                    key={c.minutes}
                    label={c.label}
                    accessibilityLabel={`Privacy time for ${c.label}`}
                    busy={busyKey === `privacy:${c.minutes}`}
                    onSelect={() => onPrivacy(c.minutes)}
                    style={styles.gap}
                  />
                ))}
                {privacyLabel ? (
                  <FocusButton
                    variant="quiet"
                    label="End privacy time"
                    busy={busyKey === 'privacy:0'}
                    onSelect={() => onPrivacy(0)}
                  />
                ) : null}
              </SpatialNavigationView>
            </Section>

            <Section title="Waiting for your OK">
              <SpatialNavigationView direction="vertical">
                {pendingProposals.length === 0 ? (
                  <Text style={[type.body, styles.sectionText]}>Nothing is waiting for you.</Text>
                ) : null}
                {pendingProposals.map((p, index) => (
                  <View key={index} style={styles.proposal}>
                    <View style={styles.proposalText}>
                      <Text style={type.bodyStrong}>{`${p.label} · ${p.when}`}</Text>
                      <Text style={type.small}>{`Suggested by ${p.proposedBy}. It only counts as expected once you approve it.`}</Text>
                    </View>
                    <SpatialNavigationView direction="horizontal">
                      <FocusButton
                        variant="primary"
                        label="Approve"
                        accessibilityLabel={`Approve ${p.label}, ${p.when}`}
                        busy={busyKey === `proposal:${p.id}:approve`}
                        onSelect={() => onDecide(p.id, 'approve')}
                        style={styles.gap}
                      />
                      <FocusButton
                        label="Decline"
                        accessibilityLabel={`Decline ${p.label}, ${p.when}`}
                        busy={busyKey === `proposal:${p.id}:decline`}
                        onSelect={() => onDecide(p.id, 'decline')}
                      />
                    </SpatialNavigationView>
                  </View>
                ))}
              </SpatialNavigationView>
            </Section>

            {/* Always-present node: the safety section comes and goes with the risk window. */}
            <SpatialNavigationView direction="vertical">
              {watching ? (
                <Section title="Safety watch" tone="caution">
                  <Text style={[type.body, styles.sectionText]}>
                    {`Kinwise is watching the door more closely${safety.untilLabel ? ` until ${safety.untilLabel}` : ''}` +
                      (safety.signs.length
                        ? `, because it noticed ${plural(safety.signs.length, 'warning sign', 'warning signs')} today.`
                        : '.')}
                  </Text>
                  {confirming ? (
                    <Text style={[type.bodyStrong, styles.confirmText]}>
                      End the safety watch now? Kinwise will go back to its usual door awareness.
                    </Text>
                  ) : null}
                  <SpatialNavigationView direction="horizontal" style={styles.buttonRow}>
                    {confirming ? (
                      <>
                        <FocusButton
                          ref={keepRef}
                          variant="primary"
                          label="Keep watching"
                          onSelect={() => setConfirming(false)}
                          style={styles.gap}
                        />
                        <FocusButton
                          label="Yes, end it"
                          accessibilityLabel="Yes, end the safety watch"
                          busy={busyKey === 'safety'}
                          onSelect={() => {
                            onCloseSafety();
                            setConfirming(false);
                          }}
                        />
                      </>
                    ) : (
                      <FocusButton
                        ref={endRef}
                        label="End safety watch"
                        accessibilityHint="Asks you to confirm first"
                        onSelect={() => setConfirming(true)}
                      />
                    )}
                  </SpatialNavigationView>
                </Section>
              ) : (
                <View />
              )}
            </SpatialNavigationView>

            <Section title="Who has seen my information">
              <Text style={[type.small, styles.sectionText]}>
                {`Every time ${caregiver} or anyone else in your family looks at Kinwise, it shows up here.`}
              </Text>
              <SpatialNavigationView direction="vertical">
                {accessLog.length === 0 ? (
                  <Text style={[type.body, styles.sectionText]}>No one has looked at your information yet.</Text>
                ) : null}
                {accessLog.map((e, index) => (
                  <Focusable
                    key={index}
                    accessibilityRole="text"
                    accessibilityLabel={`${e.timeLabel}. ${e.actor} ${e.action}.`}
                    style={styles.logOuter}
                    radius={s(16)}>
                    {(focused) => (
                      <View style={[styles.logRow, focused ? styles.logRowFocused : null]}>
                        <Text style={[type.smallStrong, styles.logTime, focused ? styles.onLight : null]}>{e.timeLabel}</Text>
                        <Text style={[type.body, focused ? styles.onLight : null]}>{`${e.actor} ${e.action}`}</Text>
                      </View>
                    )}
                  </Focusable>
                ))}
              </SpatialNavigationView>
            </Section>
          </View>
        </SpatialNavigationScrollView>
      </View>
    </SpatialNavigationRoot>
  );
}

function Section({title, tone, children}: {title: string; tone?: 'caution'; children: React.ReactNode}) {
  return (
    <View style={[styles.section, tone === 'caution' ? styles.sectionCaution : null]}>
      <Text style={[type.section, tone === 'caution' ? styles.cautionTitle : null]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: SAFE.horizontal,
    paddingTop: SAFE.vertical,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: s(16),
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: SAFE.vertical + s(200),
    maxWidth: s(1500),
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: s(12),
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: s(28),
    borderWidth: s(2),
    borderColor: colors.line,
    paddingVertical: s(28),
    paddingHorizontal: s(32),
    marginBottom: s(24),
  },
  sectionCaution: {
    borderColor: 'rgba(251, 191, 36, 0.6)',
    backgroundColor: '#1d2318',
  },
  cautionTitle: {
    color: colors.caution,
  },
  sectionText: {
    marginTop: s(8),
    marginBottom: s(12),
  },
  confirmText: {
    color: colors.cream,
    marginBottom: s(8),
  },
  rowGap: {
    marginBottom: s(2),
  },
  buttonRow: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  gap: {
    marginRight: s(16),
  },
  proposal: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: s(12),
  },
  proposalText: {
    flex: 1,
    paddingRight: s(24),
  },
  logOuter: {
    marginHorizontal: -s(10),
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: s(10),
    paddingHorizontal: s(16),
    borderRadius: s(16),
  },
  logRowFocused: {
    backgroundColor: colors.cream,
  },
  logTime: {
    width: s(170),
  },
  onLight: {
    color: colors.onLight,
  },
});
