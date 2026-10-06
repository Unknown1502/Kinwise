import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {FamilyVideo} from '../components/FamilyVideo';
import {Focusable} from '../components/Focusable';
import {FocusButton} from '../components/FocusButton';
import {PAUSE_TITLE, pauseAnnouncement, pauseLine} from '../logic/copy';
import {SAFE, colors, s, type} from '../theme/theme';
import type {AlertAction, AlertView} from '../types';

export interface PauseScreenProps {
  alert: AlertView;
  /** Absolute URL of the caregiver's video, already resolved against the hub. */
  videoUrl?: string;
  /** Which action is being sent, if any. */
  busyAction?: AlertAction | null;
  error?: string;
  onRespond: (action: AlertAction) => void;
}

/**
 * The Pause: a full-screen, calm takeover when an unexpected visitor arrives during a risk
 * window. It advises; it never controls. Default focus is "Call {caregiver}".
 */
export function PauseScreen({alert, videoUrl, busyAction, error, onRespond}: PauseScreenProps) {
  const [signIndex, setSignIndex] = useState(0);
  const sign = alert.signs[signIndex] ?? alert.signs[0];
  const message = alert.pauseMessage;
  const name = alert.caregiverName;

  useEffect(() => {
    announce(pauseAnnouncement(alert));
    // Announce once per alert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id]);

  useEffect(() => {
    if (error) announce(error);
  }, [error]);

  return (
    <SpatialNavigationRoot>
      <View style={styles.screen} testID="pause-screen">
        <View style={styles.accent} />
        <View style={styles.columns}>
          <View style={styles.left}>
            <Text style={[type.smallStrong, styles.eyebrow]}>{`Kinwise · ${alert.createdLabel}`}</Text>
            <Text style={type.display} accessibilityRole="header">
              {PAUSE_TITLE}
            </Text>
            <Text style={[type.lead, styles.line]}>{pauseLine(alert)}</Text>
            {alert.description ? (
              <Text style={[type.body, styles.door]}>{`At the door: ${alert.description}`}</Text>
            ) : null}

            <View style={styles.signsBlock}>
              <Text style={[type.small, styles.signsLabel]}>Warning signs Kinwise noticed</Text>
              <SpatialNavigationView direction="horizontal" style={styles.chips}>
                {alert.signs.map((sg, index) => (
                  <Focusable
                    key={index}
                    accessibilityRole="button"
                    accessibilityLabel={`Warning sign: ${sg.label}`}
                    accessibilityHint={sg.explanation}
                    onFocus={() => setSignIndex(index)}
                    onSelect={() => {
                      setSignIndex(index);
                      announce(sg.explanation);
                    }}
                    style={styles.chipOuter}
                    radius={s(999)}>
                    {(focused) => (
                      <View
                        style={[
                          styles.chip,
                          index === signIndex ? styles.chipCurrent : null,
                          focused ? styles.chipFocused : null,
                        ]}>
                        <Text style={[type.smallStrong, styles.chipText, focused ? styles.onLight : null]}>{sg.label}</Text>
                      </View>
                    )}
                  </Focusable>
                ))}
              </SpatialNavigationView>
              {sign ? (
                <View style={styles.explanation} accessibilityLiveRegion="polite">
                  <Text style={type.body}>{sign.explanation}</Text>
                </View>
              ) : null}
            </View>

            <SpatialNavigationView direction="horizontal" style={styles.buttons}>
              <DefaultFocus>
                <FocusButton
                  variant="pause"
                  label={`Call ${name}`}
                  accessibilityHint={`Asks ${name} to call you right away`}
                  busy={busyAction === 'call_family'}
                  onSelect={() => onRespond('call_family')}
                  style={styles.buttonGap}
                />
              </DefaultFocus>
              <FocusButton
                label="I know this person"
                accessibilityHint="Closes the Pause. You can add them as an expected visitor later"
                busy={busyAction === 'known_person'}
                onSelect={() => onRespond('known_person')}
                style={styles.buttonGap}
              />
              <FocusButton
                variant="quiet"
                label="Dismiss"
                accessibilityHint="Closes the Pause"
                busy={busyAction === 'dismiss'}
                onSelect={() => onRespond('dismiss')}
              />
            </SpatialNavigationView>
            {error ? <Text style={[type.bodyStrong, styles.error]}>{error}</Text> : null}
          </View>

          <View style={styles.right}>
            {message ? (
              <View style={styles.messageCard}>
                <Text style={[type.section, styles.messageTitle]} accessibilityRole="header">
                  {`A message from ${message.from}`}
                </Text>
                <FamilyVideo url={videoUrl} from={message.from} />
                <View
                  style={styles.captions}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={`${message.from} says: ${message.text}`}>
                  <Text style={type.caption}>{`“${message.text}”`}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.messageCard}>
                <Text style={[type.section, styles.messageTitle]}>{`${name} is a button away`}</Text>
                <Text style={type.body}>{`Choose “Call ${name}” and Kinwise will ask ${name} to call you now.`}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: s(10),
    backgroundColor: colors.pause,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    flex: 1.65,
    paddingRight: s(56),
    justifyContent: 'center',
  },
  right: {
    flex: 1,
    justifyContent: 'center',
  },
  eyebrow: {
    color: colors.pause,
    marginBottom: s(12),
    letterSpacing: s(1),
  },
  line: {
    marginTop: s(20),
  },
  door: {
    marginTop: s(14),
    color: colors.muted,
  },
  signsBlock: {
    marginTop: s(32),
  },
  signsLabel: {
    marginBottom: s(8),
  },
  chips: {
    flexWrap: 'wrap',
  },
  chipOuter: {
    marginRight: s(6),
    marginBottom: s(4),
  },
  chip: {
    paddingVertical: s(10),
    paddingHorizontal: s(24),
    borderRadius: s(999),
    borderWidth: s(2),
    borderColor: 'rgba(251, 146, 60, 0.55)',
    backgroundColor: colors.pauseTint,
  },
  chipCurrent: {
    borderColor: colors.pause,
  },
  chipFocused: {
    backgroundColor: colors.cream,
    borderColor: colors.cream,
  },
  chipText: {
    color: colors.cream,
  },
  onLight: {
    color: colors.onLight,
  },
  explanation: {
    marginTop: s(12),
    backgroundColor: colors.surface,
    borderRadius: s(20),
    borderLeftWidth: s(8),
    borderLeftColor: colors.pause,
    paddingVertical: s(18),
    paddingHorizontal: s(28),
    minHeight: s(124),
    justifyContent: 'center',
  },
  buttons: {
    marginTop: s(36),
    alignItems: 'center',
  },
  buttonGap: {
    marginRight: s(16),
  },
  error: {
    marginTop: s(20),
    color: colors.caution,
  },
  messageCard: {
    backgroundColor: colors.surface,
    borderRadius: s(28),
    borderWidth: s(2),
    borderColor: colors.line,
    padding: s(32),
  },
  messageTitle: {
    marginBottom: s(20),
  },
  captions: {
    marginTop: s(24),
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: s(16),
    paddingVertical: s(16),
    paddingHorizontal: s(22),
  },
});
