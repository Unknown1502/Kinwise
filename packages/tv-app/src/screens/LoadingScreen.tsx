import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {IconBadge} from '../components/Icon';
import {SAFE, colors, fonts, s, type} from '../theme/theme';

/** Before the first /tv/state arrives. Explains plainly what to check if the hub can't be reached. */
export function LoadingScreen({hubUrl, error}: {hubUrl: string; error?: unknown}) {
  const message = error instanceof Error ? error.message : undefined;
  return (
    <View style={styles.screen} testID="loading-screen">
      <View style={styles.brandRow}>
        <IconBadge name="house-heart" color={colors.apricot} size={s(120)} />
        <Text style={styles.brand} accessibilityRole="header">
          Kinwise
        </Text>
      </View>
      <Text style={[type.lead, styles.center]} accessibilityLiveRegion="polite">
        {error ? 'Still trying to reach Kinwise…' : 'Connecting to Kinwise…'}
      </Text>
      {error ? (
        <View style={styles.help}>
          <Text style={[type.small, styles.center]}>{message ?? 'The Kinwise hub did not answer.'}</Text>
          <Text style={[type.small, styles.center]}>{`Hub address: ${hubUrl}`}</Text>
          <Text style={[type.small, styles.center]}>Check that the hub is running and this TV is on the same network.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SAFE.horizontal,
    paddingVertical: SAFE.vertical,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(32),
  },
  brand: {
    fontFamily: fonts.heavy,
    fontWeight: '800',
    fontSize: s(104),
    lineHeight: s(116),
    letterSpacing: -s(2),
    color: colors.white,
    marginLeft: s(32),
  },
  center: {
    textAlign: 'center',
  },
  help: {
    marginTop: s(28),
    alignItems: 'center',
  },
});
