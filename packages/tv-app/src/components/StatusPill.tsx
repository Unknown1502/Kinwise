import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {StatusPill as StatusPillModel} from '../logic/copy';
import {colors, s, type} from '../theme/theme';

const TONES = {
  ok: {dot: colors.ok, text: colors.text, bg: colors.okTint, border: 'rgba(74, 222, 128, 0.45)'},
  caution: {dot: colors.caution, text: colors.caution, bg: colors.cautionTint, border: 'rgba(251, 191, 36, 0.55)'},
  privacy: {dot: colors.cream, text: colors.cream, bg: colors.creamTint, border: 'rgba(254, 243, 199, 0.45)'},
  muted: {dot: colors.muted, text: colors.muted, bg: colors.surface2, border: colors.line},
} as const;

/** "Kinwise is on" / "Watching the door until 8:10 PM" / "Privacy time until 3:10 PM". */
export function StatusPill({pill}: {pill: StatusPillModel}) {
  const tone = TONES[pill.tone];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={pill.text}
      style={[styles.pill, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      <View style={[styles.dot, {backgroundColor: tone.dot}]} />
      <Text style={[type.bodyStrong, {color: tone.text}]}>{pill.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: s(14),
    paddingHorizontal: s(28),
    borderRadius: s(999),
    borderWidth: s(2),
  },
  dot: {
    width: s(20),
    height: s(20),
    borderRadius: s(10),
    marginRight: s(16),
  },
});
