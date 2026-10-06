import React from 'react';
import {StyleSheet, Text, View, type ViewStyle} from 'react-native';
import {colors, s, type} from '../theme/theme';
import {Focusable} from './Focusable';

export interface ToggleRowProps {
  title: string;
  /** One plain-language line explaining what the switch does. */
  explanation: string;
  value: boolean;
  busy?: boolean;
  onToggle: (next: boolean) => void;
  style?: ViewStyle;
}

/** A consent switch: the whole row is one focusable target with role "switch". */
export function ToggleRow({title, explanation, value, busy, onToggle, style}: ToggleRowProps) {
  return (
    <Focusable
      accessibilityLabel={title}
      accessibilityHint={explanation}
      accessibilityRole="switch"
      checked={value}
      busy={busy}
      onSelect={() => onToggle(!value)}
      style={style}
      radius={s(24)}>
      {(focused) => (
        <View style={[styles.row, focused ? styles.rowFocused : null]}>
          <View style={styles.texts}>
            <Text style={[type.bodyStrong, focused ? styles.onLight : null]}>{title}</Text>
            <Text style={[type.small, focused ? styles.onLightMuted : null]}>{explanation}</Text>
          </View>
          <View style={[styles.pill, value ? styles.pillOn : styles.pillOff]}>
            <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
            <Text style={[type.smallStrong, {color: value ? colors.onLight : colors.text}]}>
              {busy ? '…' : value ? 'On' : 'Off'}
            </Text>
          </View>
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: s(24),
    paddingVertical: s(22),
    paddingHorizontal: s(32),
  },
  rowFocused: {
    backgroundColor: colors.cream,
  },
  texts: {
    flex: 1,
    paddingRight: s(32),
  },
  onLight: {color: colors.onLight},
  onLightMuted: {color: '#3b4a3f'},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: s(150),
    paddingVertical: s(10),
    paddingHorizontal: s(18),
    borderRadius: s(999),
    borderWidth: s(2),
  },
  pillOn: {backgroundColor: colors.ok, borderColor: colors.ok},
  pillOff: {backgroundColor: colors.surface, borderColor: colors.muted},
  knob: {
    width: s(26),
    height: s(26),
    borderRadius: s(13),
    marginRight: s(12),
  },
  knobOn: {backgroundColor: colors.onLight},
  knobOff: {backgroundColor: colors.muted},
});
