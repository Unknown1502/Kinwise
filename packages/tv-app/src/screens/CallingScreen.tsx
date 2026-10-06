import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {announce} from '../a11y/announce';
import {SAFE, colors, s, type} from '../theme/theme';

export const CALLING_CONFIRMATION_MS = 5000;

/** Shown for 5 s after "Call {caregiver}": a reassuring confirmation, then back to Today at Home. */
export function CallingScreen({name}: {name: string}) {
  useEffect(() => {
    announce(`Calling ${name} now. Kinwise asked ${name} to call you right away. You don't need to open the door.`);
  }, [name]);

  return (
    <View style={styles.screen} testID="calling-screen" accessibilityLiveRegion="assertive">
      <View style={styles.ring}>
        <View style={styles.dot} />
      </View>
      <Text style={[type.display, styles.center]} accessibilityRole="header">{`Calling ${name} now…`}</Text>
      <Text style={[type.lead, styles.center, styles.sub]}>
        {`Kinwise asked ${name} to call you right away. You don't need to open the door.`}
      </Text>
      <Text style={[type.small, styles.center, styles.hint]}>Back to Today at Home in a moment.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
  },
  ring: {
    width: s(140),
    height: s(140),
    borderRadius: s(70),
    borderWidth: s(6),
    borderColor: colors.ok,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: s(40),
  },
  dot: {
    width: s(56),
    height: s(56),
    borderRadius: s(28),
    backgroundColor: colors.ok,
  },
  center: {
    textAlign: 'center',
  },
  sub: {
    marginTop: s(24),
    maxWidth: s(1300),
  },
  hint: {
    marginTop: s(36),
  },
});
