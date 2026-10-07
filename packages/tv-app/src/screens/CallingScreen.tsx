import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {announce} from '../a11y/announce';
import {Avatar} from '../components/Avatar';
import {IconBadge} from '../components/Icon';
import {SAFE, colors, s, type} from '../theme/theme';

export const CALLING_CONFIRMATION_MS = 5000;

/** Shown for 5 s after "Call {caregiver}": a reassuring confirmation, then back to the home screen. */
export function CallingScreen({name}: {name: string}) {
  useEffect(() => {
    announce(`Calling ${name} now. Kinwise asked ${name} to call you right away. You don't need to open the door.`);
  }, [name]);

  return (
    <View style={styles.screen} testID="calling-screen" accessibilityLiveRegion="assertive">
      <View style={styles.halo}>
        <Avatar name={name} size={s(200)} />
        <IconBadge name="phone" color={colors.mint} size={s(84)} style={styles.phone} />
      </View>
      <Text style={[type.display, styles.center]} accessibilityRole="header">{`Calling ${name} now…`}</Text>
      <Text style={[type.lead, styles.center, styles.sub]}>
        {`Kinwise asked ${name} to call you right away. You don't need to open the door.`}
      </Text>
      <Text style={[type.small, styles.center, styles.hint]}>Back to the home screen in a moment.</Text>
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
