import React from 'react';
import {StyleSheet, Text, View, type ViewStyle} from 'react-native';
import {RADIUS, colors, s, type} from '../theme/theme';
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
      radius={RADIUS.card}
      grow={1.015}>
      {(focused) => (
        <View style={[styles.row, focused ? styles.rowFocused : null]}>
          <View style={styles.texts}>
            <Text style={[type.bodyStrong, focused ? styles.onWhite : null]}>{title}</Text>
            <Text style={[type.small, focused ? styles.onWhiteSoft : null]}>{explanation}</Text>
          </View>
          <Text style={[type.smallStrong, styles.state, focused ? styles.onWhite : value ? styles.stateOn : null]}>
            {busy ? '…' : value ? 'On' : 'Off'}
          </Text>
          <View style={[styles.track, value ? styles.trackOn : focused ? styles.trackOffOnWhite : styles.trackOff]}>
            <View style={[styles.knob, value ? styles.knobOn : focused ? styles.knobOffOnWhite : styles.knobOff]} />
          </View>
        </View>
      )}
    </Focusable>
  );
}

const TRACK_W = s(108);
const TRACK_H = s(58);
const KNOB = s(42);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.card,
    backgroundColor: colors.glass,
    paddingVertical: s(20),
    paddingHorizontal: s(30),
  },
  rowFocused: {
    backgroundColor: colors.white,
  },
  texts: {
    flex: 1,
    paddingRight: s(32),
  },
  onWhite: {color: colors.deep},
  onWhiteSoft: {color: colors.onSheetSoft},
  state: {
    width: s(64),
    textAlign: 'right',
    marginRight: s(18),
  },
  stateOn: {
    color: colors.mint,
  },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: s(3),
    justifyContent: 'center',
    paddingHorizontal: s(5),
  },
  trackOn: {
    backgroundColor: colors.mint,
    borderColor: colors.mint,
    alignItems: 'flex-end',
  },
  trackOff: {
    backgroundColor: 'transparent',
    borderColor: colors.soft,
    alignItems: 'flex-start',
  },
  trackOffOnWhite: {
    backgroundColor: 'transparent',
    borderColor: colors.onSheetSoft,
    alignItems: 'flex-start',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
  },
  knobOn: {backgroundColor: colors.deep},
  knobOff: {backgroundColor: colors.soft},
  knobOffOnWhite: {backgroundColor: colors.onSheetSoft},
});
