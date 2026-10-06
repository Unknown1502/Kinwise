import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {SAFE, colors, s, type} from '../theme/theme';

/** Before the first /tv/state arrives. Explains plainly what to check if the hub can't be reached. */
export function LoadingScreen({hubUrl, error}: {hubUrl: string; error?: unknown}) {
  const message = error instanceof Error ? error.message : undefined;
  return (
    <View style={styles.screen} testID="loading-screen">
      <Text style={styles.brand} accessibilityRole="header">
        Kinwise
      </Text>
      <Text style={[type.lead, styles.center]} accessibilityLiveRegion="polite">
        {error ? 'Still trying to reach Kinwise…' : 'Connecting to Kinwise…'}
      </Text>
      {error ? (
        <>
          <Text style={[type.small, styles.center, styles.detail]}>{message ?? 'The Kinwise hub did not answer.'}</Text>
          <Text style={[type.small, styles.center]}>{`Hub address: ${hubUrl}`}</Text>
          <Text style={[type.small, styles.center]}>Check that the hub is running and this TV is on the same network.</Text>
        </>
      ) : null}
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
  brand: {
    fontSize: s(96),
    lineHeight: s(112),
    fontWeight: '700',
    color: colors.cream,
    marginBottom: s(24),
  },
  center: {
    textAlign: 'center',
  },
  detail: {
    marginTop: s(24),
  },
});
