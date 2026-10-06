import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {FocusButton} from '../components/FocusButton';
import {SAFE, colors, s, type} from '../theme/theme';
import type {AlertAction, AlertView} from '../types';

export const GENTLE_TITLE = "A visitor isn't on today's list";

export interface GentleOverlayProps {
  alert: AlertView;
  busyAction?: AlertAction | null;
  onRespond: (action: AlertAction) => void;
}

/** Bottom panel for an unexpected visitor when no risk window is open. Informational, not urgent. */
export function GentleOverlay({alert, busyAction, onRespond}: GentleOverlayProps) {
  useEffect(() => {
    announce(`${GENTLE_TITLE}. ${alert.description}. I know this person is selected. You can also choose Dismiss.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id]);

  return (
    <View style={styles.scrim} testID="gentle-overlay">
      <SpatialNavigationRoot>
        <View style={styles.panel} accessibilityViewIsModal>
          <View style={styles.texts}>
            <Text style={type.title48} accessibilityRole="header">
              {GENTLE_TITLE}
            </Text>
            <Text style={[type.body, styles.desc]}>{`${alert.createdLabel} · ${alert.description}`}</Text>
            <Text style={[type.small, styles.desc]}>
              You don't have to answer the door. If you know them, let Kinwise know.
            </Text>
          </View>
          <SpatialNavigationView direction="horizontal" style={styles.buttons}>
            <DefaultFocus>
              <FocusButton
                variant="primary"
                label="I know this person"
                busy={busyAction === 'known_person'}
                onSelect={() => onRespond('known_person')}
                style={styles.gap}
              />
            </DefaultFocus>
            <FocusButton label="Dismiss" busy={busyAction === 'dismiss'} onSelect={() => onRespond('dismiss')} />
          </SpatialNavigationView>
        </View>
      </SpatialNavigationRoot>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
    paddingHorizontal: SAFE.horizontal,
    paddingBottom: SAFE.vertical,
    zIndex: 40,
  },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: s(32),
    borderWidth: s(2),
    borderColor: 'rgba(251, 191, 36, 0.55)',
    borderTopWidth: s(8),
    borderTopColor: colors.caution,
    paddingVertical: s(40),
    paddingHorizontal: s(48),
  },
  texts: {
    flex: 1,
    paddingRight: s(40),
  },
  desc: {
    marginTop: s(10),
  },
  buttons: {
    alignItems: 'center',
  },
  gap: {
    marginRight: s(16),
  },
});
