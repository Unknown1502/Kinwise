import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {announce} from '../a11y/announce';
import {IconBadge} from '../components/Icon';
import {SAFE, colors, s, type} from '../theme/theme';
import type {AlertView} from '../types';

export const EXPECTED_TOAST_MS = 8000;

export function expectedText(alert: Pick<AlertView, 'visitLabel'>): string {
  return `${alert.visitLabel ?? 'Your visitor'} is at the door`;
}

/** Small, non-interactive note for an expected visitor. Hides itself after 8 s. */
export function ExpectedToast({alert, onDone}: {alert: AlertView; onDone: (alertId: string) => void}) {
  useEffect(() => {
    announce(`${alert.visitLabel ?? 'Your visitor'} is here. They're on today's list.`);
    const t = setTimeout(() => onDone(alert.id), EXPECTED_TOAST_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id]);

  return (
    <View pointerEvents="none" style={styles.wrap} testID="expected-toast">
      <View style={styles.toast} accessible accessibilityRole="alert" accessibilityLabel={`${expectedText(alert)}. They're on today's list.`}>
        <IconBadge name="door-open" color={colors.mint} size={s(68)} />
        <View style={styles.texts}>
          <Text style={type.bodyStrong}>{expectedText(alert)}</Text>
          <Text style={type.small}>{`On today's list, ${alert.createdLabel}`}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: SAFE.vertical + s(24),
    right: SAFE.horizontal,
    zIndex: 45,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: s(760),
    backgroundColor: colors.deep,
    borderColor: colors.mint,
    borderWidth: s(3),
    borderRadius: s(48),
    paddingVertical: s(14),
    paddingLeft: s(14),
    paddingRight: s(36),
  },
  texts: {
    flexShrink: 1,
    marginLeft: s(20),
  },
});
