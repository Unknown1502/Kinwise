import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {SAFE, colors, s, type} from '../theme/theme';

/** Unobtrusive top-centre banner ("Reconnecting…", short confirmations). Never takes focus. */
export function Banner({text, tone = 'muted'}: {text: string; tone?: 'muted' | 'ok' | 'error'}) {
  const accent = tone === 'ok' ? colors.ok : tone === 'error' ? colors.caution : colors.muted;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View
        style={[styles.banner, {borderColor: accent}]}
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={text}>
        <View style={[styles.dot, {backgroundColor: accent}]} />
        <Text style={[type.body, styles.text]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: SAFE.vertical,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: s(1300),
    backgroundColor: colors.surface2,
    borderWidth: s(2),
    borderRadius: s(999),
    paddingVertical: s(14),
    paddingHorizontal: s(32),
  },
  dot: {
    width: s(16),
    height: s(16),
    borderRadius: s(8),
    marginRight: s(16),
  },
  text: {
    color: colors.text,
  },
});
