import React from 'react';
import {StyleSheet, Text, View, type ViewStyle} from 'react-native';
import {colors, s, type} from '../theme/theme';

/** Shown instead of the family video when there is none, while it loads, or if it fails. */
export function VideoPlaceholder({from, note, style}: {from: string; note?: string; style?: ViewStyle}) {
  return (
    <View style={[styles.frame, style]} accessible accessibilityRole="image" accessibilityLabel={`${from}`}>
      <View style={styles.avatar}>
        <Text style={styles.initial}>{from.trim().charAt(0).toUpperCase() || '♥'}</Text>
      </View>
      <Text style={[type.bodyStrong, styles.name]}>{from}</Text>
      {note ? <Text style={type.small}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 16 / 9,
    width: '100%',
    borderRadius: s(24),
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: s(120),
    height: s(120),
    borderRadius: s(60),
    backgroundColor: colors.pauseTint,
    borderWidth: s(3),
    borderColor: colors.pause,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: s(16),
  },
  initial: {
    fontSize: s(56),
    lineHeight: s(66),
    fontWeight: '700',
    color: colors.cream,
  },
  name: {
    color: colors.cream,
  },
});
