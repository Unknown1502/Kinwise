import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {announce} from '../a11y/announce';
import {SAFE, colors, s, type} from '../theme/theme';
import type {AlertView} from '../types';

export const EXPECTED_TOAST_MS = 8000;

export function expectedText(alert: Pick<AlertView, 'visitLabel'>): string {
  return `${alert.visitLabel ?? 'Your visitor'} is here — expected`;
}

/** Small, non-interactive toast for an expected visitor. Hides itself after 8 s. */
export function ExpectedToast({alert, onDone}: {alert: AlertView; onDone: (alertId: string) => void}) {
  useEffect(() => {
    announce(`${alert.visitLabel ?? 'Your visitor'} is here. They're on today's list.`);
    const t = setTimeout(() => onDone(alert.id), EXPECTED_TOAST_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id]);

  return (
    <View pointerEvents="none" style={styles.wrap} testID="expected-toast">
      <View style={styles.toast} accessible accessibilityRole="alert" accessibilityLabel={expectedText(alert)}>
        <View style={styles.dot} />
        <View>
          <Text style={type.bodyStrong}>{expectedText(alert)}</Text>
          <Text style={type.small}>{`On today's list · ${alert.createdLabel}`}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: SAFE.vertical + s(120),
    right: SAFE.horizontal,
    zIndex: 45,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: s(820),
    backgroundColor: colors.surface2,
    borderRadius: s(24),
    borderWidth: s(2),
    borderColor: 'rgba(74, 222, 128, 0.55)',
    paddingVertical: s(24),
    paddingHorizontal: s(32),
  },
  dot: {
    width: s(22),
    height: s(22),
    borderRadius: s(11),
    backgroundColor: colors.ok,
    marginRight: s(22),
  },
});
