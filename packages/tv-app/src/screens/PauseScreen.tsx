import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {FamilyVideo} from '../components/FamilyVideo';
import {Focusable} from '../components/Focusable';
import {FocusButton} from '../components/FocusButton';
import {IconBadge} from '../components/Icon';
import {PAUSE_TITLE, pauseAnnouncement, pauseLine} from '../logic/copy';
import {OnSurface} from '../theme/surface';
import {FOCUS, RADIUS, SAFE, colors, s, type} from '../theme/theme';
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
 * The Pause: the whole screen turns persimmon when an unexpected visitor arrives during a risk
 * window, so the room itself changes colour, noticeable even from the hallway. It advises; it
 * never controls. Default focus is "Call {caregiver}".
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
    <OnSurface surface="persimmon">
      <SpatialNavigationRoot>
        <View style={styles.screen} testID="pause-screen">
          <View style={styles.columns}>
            <View style={styles.left}>
              <View style={styles.whenRow}>
                <IconBadge name="door-open" color={colors.white} size={s(64)} />
                <Text style={[type.bodyStrong, styles.when]}>{`${alert.createdLabel}, someone is at your door`}</Text>
              </View>
              <Text style={type.pause} accessibilityRole="header">
                {PAUSE_TITLE}
              </Text>
              <Text style={[type.lead, styles.ink, styles.line]}>{pauseLine(alert)}</Text>
              {alert.description ? (
                <Text style={[type.body, styles.ink, styles.door]}>{alert.description}</Text>
              ) : null}

              {alert.signs.length ? (
                <View style={styles.signs}>
                  <Text style={[type.smallStrong, styles.ink, styles.signsLabel]}>What Kinwise noticed</Text>
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
                        radius={CHIP_RADIUS}>
                        {(focused) => (
                          <View style={[styles.chip, index === signIndex ? styles.chipCurrent : null, focused ? styles.chipFocused : null]}>
                            <Text
                              style={[
                                type.smallStrong,
                                styles.ink,
                                index === signIndex && !focused ? styles.onInk : null,
                              ]}>
                              {sg.label}
                            </Text>
                          </View>
                        )}
                      </Focusable>
                    ))}
                  </SpatialNavigationView>
                  {sign ? (
                    <Text style={[type.body, styles.ink, styles.explanation]} accessibilityLiveRegion="polite">
                      {sign.explanation}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <SpatialNavigationView direction="horizontal" style={styles.buttons}>
                <DefaultFocus>
                  <FocusButton
                    variant="primary"
                    icon="phone"
                    label={`Call ${name}`}
                    accessibilityHint={`Asks ${name} to call you right away`}
                    busy={busyAction === 'call_family'}
                    onSelect={() => onRespond('call_family')}
                    style={styles.buttonGap}
                  />
                </DefaultFocus>
                <FocusButton
                  icon="check"
                  label="I know this person"
                  accessibilityHint="Closes the Pause. You can add them as an expected visitor later"
                  busy={busyAction === 'known_person'}
                  onSelect={() => onRespond('known_person')}
                  style={styles.buttonGap}
                />
                <FocusButton
                  variant="quiet"
                  icon="x"
                  label="Dismiss"
                  accessibilityHint="Closes the Pause"
                  busy={busyAction === 'dismiss'}
                  onSelect={() => onRespond('dismiss')}
                />
              </SpatialNavigationView>
              {error ? <Text style={[type.bodyStrong, styles.ink, styles.error]}>{error}</Text> : null}
            </View>

            <View style={styles.right}>
              {message ? (
                <>
                  <Text style={[type.smallStrong, styles.ink, styles.messageLabel]} accessibilityRole="header">
                    {`A message from ${message.from}`}
                  </Text>
                  <FamilyVideo url={videoUrl} from={message.from} />
                  <View accessible accessibilityRole="text" accessibilityLabel={`${message.from} says: ${message.text}`}>
                    <Text style={[type.caption, styles.quote]}>{`“${message.text}”`}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.noMessage}>
                  <Text style={[type.heading, styles.ink]}>{`${name} is one button away`}</Text>
                  <Text style={[type.body, styles.ink, styles.noMessageText]}>
                    {`Choose “Call ${name}” and Kinwise will ask ${name} to call you now.`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </SpatialNavigationRoot>
    </OnSurface>
  );
}

const CHIP_RADIUS = RADIUS.chip;
const RING = FOCUS.width + FOCUS.gap;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.persimmon,
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    flex: 1.55,
    paddingRight: s(72),
    justifyContent: 'center',
  },
  right: {
    flex: 1,
    justifyContent: 'center',
  },
  ink: {
    color: colors.deep,
  },
  onInk: {
    color: colors.white,
  },
  whenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(22),
  },
  when: {
    color: colors.deep,
    marginLeft: s(18),
  },
  line: {
    marginTop: s(28),
  },
  door: {
    marginTop: s(10),
  },
  signs: {
    marginTop: s(34),
  },
  signsLabel: {
    marginBottom: s(6),
  },
  chips: {
    flexWrap: 'wrap',
    marginLeft: -RING,
  },
  chipOuter: {
    marginRight: s(2),
  },
  chip: {
    paddingVertical: s(8),
    paddingHorizontal: s(22),
    borderRadius: CHIP_RADIUS,
    borderWidth: s(3),
    borderColor: colors.deep,
  },
  chipCurrent: {
    backgroundColor: colors.deep,
  },
  chipFocused: {
    backgroundColor: colors.white,
    borderColor: colors.white,
  },
  explanation: {
    marginTop: s(10),
    minHeight: s(92),
    maxWidth: s(1000),
  },
  buttons: {
    marginTop: s(30),
    marginLeft: -RING,
    alignItems: 'center',
  },
  buttonGap: {
    marginRight: s(8),
  },
  error: {
    marginTop: s(16),
  },
  messageLabel: {
    marginBottom: s(14),
  },
  quote: {
    marginTop: s(22),
  },
  noMessage: {
    backgroundColor: 'rgba(11, 34, 48, 0.1)',
    borderRadius: RADIUS.panel,
    padding: s(40),
  },
  noMessageText: {
    marginTop: s(12),
  },
});
