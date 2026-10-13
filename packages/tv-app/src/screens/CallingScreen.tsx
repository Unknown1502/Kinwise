import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {announce} from '../a11y/announce';
import {Avatar} from '../components/Avatar';
import {IconBadge} from '../components/Icon';
import {SAFE, colors, s, type} from '../theme/theme';

export const CALLING_CONFIRMATION_MS = 6000;
/** When Kinwise could not reach the caregiver the message stays long enough to read and to pick up the phone. */
export const CALLING_FAILED_MS = 25000;

/** After "Call {caregiver}": says what really happened, then returns to the home screen. */
export function CallingScreen({name, delivered}: {name: string; delivered: boolean}) {
  useEffect(() => {
    announce(
      delivered
        ? `Kinwise told ${name} to call you right away. You don't need to open the door.`
        : `Kinwise could not reach ${name}. Please call ${name} yourself. You don't need to open the door.`,
    );
  }, [name, delivered]);

  return (
    <View style={styles.screen} testID="calling-screen" accessibilityLiveRegion="assertive">
      <View style={styles.halo}>
        <Avatar name={name} size={s(200)} />
        <IconBadge name="phone" color={delivered ? colors.mint : colors.coral} size={s(84)} style={styles.phone} />
      </View>
      <Text style={[type.display, styles.center]} accessibilityRole="header">
        {delivered ? `Telling ${name} now…` : `We couldn't reach ${name}`}
      </Text>
      <Text style={[type.lead, styles.center, styles.sub]}>
        {delivered
          ? `Kinwise sent ${name} a message to call you right away. You don't need to open the door.`
          : `Please call ${name} on your phone. You don't need to open the door.`}
      </Text>
      <Text style={[type.small, styles.center, styles.hint]}>
        {delivered ? `${name}'s answer will appear on your home screen.` : 'Press Back to return to the home screen.'}
      </Text>
    </View>
  );
}

const HALO = s(260);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
  },
  halo: {
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: s(44),
  },
  phone: {
    position: 'absolute',
    right: s(4),
    bottom: s(4),
    borderWidth: s(6),
    borderColor: colors.backdrop,
  },
  center: {
    textAlign: 'center',
  },
  sub: {
    marginTop: s(20),
    maxWidth: s(1200),
    color: colors.soft,
  },
  hint: {
    marginTop: s(40),
  },
});
