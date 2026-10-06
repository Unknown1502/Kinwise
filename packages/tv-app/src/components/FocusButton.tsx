import React, {forwardRef} from 'react';
import {StyleSheet, Text, View, type AccessibilityRole, type ViewStyle} from 'react-native';
import type {SpatialNavigationNodeRef} from 'react-tv-space-navigation';
import {colors, s, type} from '../theme/theme';
import {Focusable} from './Focusable';

export type ButtonVariant = 'primary' | 'pause' | 'secondary' | 'quiet';

export interface FocusButtonProps {
  label: string;
  /** Defaults to `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  variant?: ButtonVariant;
  busy?: boolean;
  onSelect: () => void;
  onFocus?: () => void;
  style?: ViewStyle;
}

/** A large TV button. Unfocused: calm fill. Focused: cream fill + amber ring. */
export const FocusButton = forwardRef<SpatialNavigationNodeRef, FocusButtonProps>(function FocusButton(
  {label, accessibilityLabel, accessibilityHint, accessibilityRole = 'button', variant = 'secondary', busy, onSelect, onFocus, style},
  ref,
) {
  return (
    <Focusable
      ref={ref}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      busy={busy}
      onSelect={onSelect}
      onFocus={onFocus}
      style={style}
      radius={s(20)}>
      {(focused) => (
        <View style={[styles.face, faceFor(variant, focused), busy ? styles.busy : null]}>
          <Text style={[type.bodyStrong, styles.label, {color: textFor(variant, focused)}]} numberOfLines={1}>
            {busy ? 'One moment…' : label}
          </Text>
        </View>
      )}
    </Focusable>
  );
});

function faceFor(variant: ButtonVariant, focused: boolean) {
  switch (variant) {
    case 'pause':
      return {backgroundColor: colors.pause, borderColor: colors.pause};
    case 'primary':
      return {backgroundColor: colors.cream, borderColor: colors.cream};
    case 'quiet':
      return focused
        ? {backgroundColor: colors.cream, borderColor: colors.cream}
        : {backgroundColor: 'transparent', borderColor: colors.line};
    default:
      return focused
        ? {backgroundColor: colors.cream, borderColor: colors.cream}
        : {backgroundColor: colors.surface2, borderColor: colors.line};
  }
}

function textFor(variant: ButtonVariant, focused: boolean): string {
  if (variant === 'pause') return colors.onPause;
  if (variant === 'primary' || focused) return colors.onLight;
  return colors.text;
}

const styles = StyleSheet.create({
  face: {
    minHeight: s(88),
    paddingHorizontal: s(40),
    paddingVertical: s(20),
    borderRadius: s(20),
    borderWidth: s(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
  busy: {
    opacity: 0.75,
  },
});
