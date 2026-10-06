import React, {forwardRef, useCallback, useEffect, useState} from 'react';
import {StyleSheet, View, type AccessibilityRole, type AccessibilityState, type ViewStyle} from 'react-native';
import {SpatialNavigationFocusableView} from 'react-tv-space-navigation';
import type {SpatialNavigationNodeRef} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {isScreenReaderOn} from '../a11y/screenReader';
import {FOCUS, colors, s} from '../theme/theme';

export interface FocusableProps {
  /** Read by VoiceView. Required: every focusable element is labelled. */
  accessibilityLabel: string;
  /** Required: every focusable element declares what it is. */
  accessibilityRole: AccessibilityRole;
  accessibilityHint?: string;
  /** For switches. */
  checked?: boolean;
  busy?: boolean;
  onSelect?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Outer box style (margins, flex). */
  style?: ViewStyle;
  /** Corner radius of the content; the ring follows it. */
  radius?: number;
  children: (focused: boolean) => React.ReactElement;
}

/**
 * The single focusable primitive of the app: a react-tv-space-navigation node that draws
 * a thick (6 px) amber focus ring with a 4 px gap, and wires accessibility:
 * label + role + state on the view, and a spoken label on focus when VoiceView is on
 * (spatial navigation moves a custom focus that screen readers can't see on their own).
 */
export const Focusable = forwardRef<SpatialNavigationNodeRef, FocusableProps>(function Focusable(
  {
    accessibilityLabel,
    accessibilityRole,
    accessibilityHint,
    checked,
    busy,
    onSelect,
    onFocus,
    onBlur,
    style,
    radius = s(20),
    children,
  },
  ref,
) {
  const [focusedInNavigator, setFocused] = useState(false);
  // A root under an overlay keeps its LRUD focus but is inactive: show no ring there, so only
  // one element on screen ever looks (and reports itself) focused.
  const [rootActive, setRootActive] = useState(true);
  const focused = focusedInNavigator && rootActive;

  const handleFocus = useCallback(() => {
    setFocused(true);
    if (isScreenReaderOn()) {
      const state = checked === undefined ? '' : checked ? ', on' : ', off';
      announce(`${accessibilityLabel}${state}${accessibilityHint ? `. ${accessibilityHint}` : ''}`);
    }
    onFocus?.();
  }, [accessibilityLabel, accessibilityHint, checked, onFocus]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    onBlur?.();
  }, [onBlur]);

  const handleSelect = useCallback(() => {
    if (busy) return;
    onSelect?.();
  }, [busy, onSelect]);

  const accessibilityState: AccessibilityState = {selected: focused};
  if (checked !== undefined) accessibilityState.checked = checked;
  if (busy) accessibilityState.busy = true;

  return (
    <SpatialNavigationFocusableView
      ref={ref}
      onSelect={handleSelect}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={style}
      viewProps={{
        accessible: true,
        accessibilityLabel,
        accessibilityRole,
        accessibilityHint,
        // RN 0.72 (Vega) reads accessibilityState; react-native-web 0.21 only maps aria-* props.
        accessibilityState,
        'aria-selected': focused,
        'aria-checked': checked,
        'aria-busy': busy ? true : undefined,
        testID: `focusable:${accessibilityLabel}`,
      }}>
      {({isFocused, isRootActive}) => (
        <View
          style={[
            styles.ring,
            {borderRadius: radius + FOCUS.gap + FOCUS.width},
            isFocused && isRootActive ? styles.ringOn : null,
          ]}>
          <RootActiveSync value={isRootActive} onChange={setRootActive} />
          {children(isFocused && isRootActive)}
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
});

function RootActiveSync({value, onChange}: {value: boolean; onChange: (v: boolean) => void}) {
  useEffect(() => onChange(value), [value, onChange]);
  return null;
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: FOCUS.width,
    borderColor: 'transparent',
    padding: FOCUS.gap,
  },
  ringOn: {
    borderColor: colors.focus,
  },
});
