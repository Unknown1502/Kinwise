import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {SAFE, colors, s, type} from '../theme/theme';
import {IconBadge} from './Icon';

/** Unobtrusive top-centre notice ("Reconnecting…", short confirmations). Never takes focus. */
export function Banner({text, tone = 'muted'}: {text: string; tone?: 'muted' | 'ok' | 'error'}) {
  const badge =
    tone === 'ok'
      ? ({name: 'check', color: colors.mint} as const)
      : tone === 'error'
        ? ({name: 'shield-alert', color: colors.coral} as const)
        : ({name: 'clock', color: colors.soft} as const);
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.banner} accessible accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={text}>
        <IconBadge name={badge.name} color={badge.color} size={s(56)} />
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
    backgroundColor: colors.deep,
    borderColor: colors.glassLine,
    borderWidth: s(2),
    borderRadius: s(44),
    paddingVertical: s(12),
    paddingLeft: s(12),
    paddingRight: s(36),
  },
  text: {
    flexShrink: 1,
    marginLeft: s(18),
  },
});
