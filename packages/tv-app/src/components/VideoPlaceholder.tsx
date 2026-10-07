import React from 'react';
import {StyleSheet, Text, View, type ViewStyle} from 'react-native';
import {colors, s, type} from '../theme/theme';
import {Avatar} from './Avatar';

/** Shown instead of the family video when there is none, while it loads, or if it fails. */
export function VideoPlaceholder({from, note, style}: {from: string; note?: string; style?: ViewStyle}) {
  return (
    <View style={[styles.frame, style]} accessible accessibilityRole="image" accessibilityLabel={`${from}`}>
      <Avatar name={from} size={s(132)} />
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
    backgroundColor: colors.deep,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  name: {
    marginTop: s(16),
  },
});
