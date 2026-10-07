import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {NoteTone, StatusNote} from '../logic/today';
import {colors, s, type} from '../theme/theme';
import {IconBadge, type IconName} from './Icon';

const TONE: Record<NoteTone, {color: string; icon: IconName}> = {
  ok: {color: colors.mint, icon: 'shield-check'},
  caution: {color: colors.coral, icon: 'shield-alert'},
  privacy: {color: colors.lilac, icon: 'moon'},
  muted: {color: colors.soft, icon: 'shield-check'},
};

/** "Kinwise is on / Looking out for unexpected visitors" in a glass chip with its icon. */
export function StatusChip({note}: {note: StatusNote}) {
  const tone = TONE[note.tone];
  return (
    <View style={styles.chip} accessible accessibilityRole="text" accessibilityLabel={`${note.title}. ${note.detail}.`}>
      <IconBadge name={tone.icon} color={tone.color} size={s(68)} />
      <View style={styles.texts}>
        <Text style={type.bodyStrong}>{note.title}</Text>
        <Text style={type.small}>{note.detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: s(700),
    marginTop: s(24),
    backgroundColor: colors.glass,
    borderColor: colors.glassLine,
    borderWidth: s(2),
    borderRadius: s(48),
    paddingVertical: s(14),
    paddingLeft: s(14),
    paddingRight: s(34),
  },
  texts: {
    flexShrink: 1,
    marginLeft: s(20),
  },
});
