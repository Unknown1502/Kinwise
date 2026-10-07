import React, {forwardRef} from 'react';
import {StyleSheet, Text, View, type AccessibilityRole, type ViewStyle} from 'react-native';
import type {SpatialNavigationNodeRef} from 'react-tv-space-navigation';
import {useSurface, type Surface} from '../theme/surface';
import {RADIUS, colors, s, type} from '../theme/theme';
import {Focusable} from './Focusable';
import {Icon, type IconName, type IconTone} from './Icon';

/** primary: the one thing to do here. secondary: an alternative. quiet: least emphasis. */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface FocusButtonProps {
  label: string;
  icon?: IconName;
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

/** A large TV button: glassy until it is selected, then solid white (or deep on light surfaces). */
export const FocusButton = forwardRef<SpatialNavigationNodeRef, FocusButtonProps>(function FocusButton(
  {label, icon, accessibilityLabel, accessibilityHint, accessibilityRole = 'button', variant = 'secondary', busy, onSelect, onFocus, style},
  ref,
) {
  const surface = useSurface();
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
      radius={RADIUS.button}>
      {(focused) => {
        const face = faceFor(surface, variant, focused);
        return (
          <View style={[styles.face, {backgroundColor: face.bg, borderColor: face.border}, busy ? styles.busy : null]}>
            {icon ? <Icon name={icon} tone={face.icon} size={s(40)} style={styles.icon} /> : null}
            <Text style={[type.button, {color: face.text}]} numberOfLines={1}>
              {busy ? 'One moment…' : label}
            </Text>
          </View>
        );
      }}
    </Focusable>
  );
});

interface Face {
  bg: string;
  border: string;
  text: string;
  icon: IconTone;
}

const NONE = 'transparent';

function faceFor(surface: Surface, variant: ButtonVariant, focused: boolean): Face {
  if (surface === 'backdrop') {
    if (focused) return {bg: colors.white, border: colors.white, text: colors.deep, icon: 'dark'};
    if (variant === 'primary') return {bg: colors.sun, border: colors.sun, text: colors.deep, icon: 'dark'};
    if (variant === 'quiet') return {bg: NONE, border: colors.glassLine, text: colors.white, icon: 'light'};
    return {bg: colors.glassStrong, border: NONE, text: colors.white, icon: 'light'};
  }
  // Light and persimmon surfaces: deep is the strong colour, white marks focus.
  if (focused) {
    return surface === 'persimmon'
      ? {bg: colors.white, border: colors.white, text: colors.deep, icon: 'dark'}
      : {bg: colors.deep, border: colors.deep, text: colors.white, icon: 'light'};
  }
  if (variant === 'primary') return {bg: colors.deep, border: colors.deep, text: colors.white, icon: 'light'};
  return {bg: NONE, border: variant === 'quiet' ? NONE : colors.deep, text: colors.deep, icon: 'dark'};
}

const styles = StyleSheet.create({
  face: {
    flexDirection: 'row',
    minHeight: s(92),
    paddingHorizontal: s(38),
    paddingVertical: s(20),
    borderRadius: RADIUS.button,
    borderWidth: s(3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: s(16),
  },
  busy: {
    opacity: 0.7,
  },
});
