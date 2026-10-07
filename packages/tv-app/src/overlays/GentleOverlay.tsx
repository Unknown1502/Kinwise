import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {FocusButton} from '../components/FocusButton';
import {IconBadge} from '../components/Icon';
import {OnSurface} from '../theme/surface';
import {FOCUS, SAFE, colors, s, type} from '../theme/theme';
import type {AlertAction, AlertView} from '../types';

export const GENTLE_TITLE = "A visitor isn't on today's list";

export interface GentleOverlayProps {
  alert: AlertView;
  busyAction?: AlertAction | null;
  onRespond: (action: AlertAction) => void;
}

/** For an unexpected visitor when no risk window is open: a light sheet across the bottom. Informational, not urgent. */
export function GentleOverlay({alert, busyAction, onRespond}: GentleOverlayProps) {
  useEffect(() => {
    announce(`${GENTLE_TITLE}. ${alert.description}. I know this person is selected. You can also choose Dismiss.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id]);

  return (
    <View style={styles.scrim} testID="gentle-overlay">
      <OnSurface surface="sheet">
        <SpatialNavigationRoot>
          <View style={styles.sheet} accessibilityViewIsModal>
            <IconBadge name="door-open" color={colors.sun} size={s(96)} style={styles.badge} />
            <View style={styles.texts}>
              <Text style={[type.heading, styles.deep]} accessibilityRole="header">
                {GENTLE_TITLE}
              </Text>
              <Text style={[type.body, styles.deep, styles.desc]}>{`${alert.description}, ${alert.createdLabel}.`}</Text>
              <Text style={[type.body, styles.soft]}>You don't have to answer the door. If you know them, let Kinwise know.</Text>
            </View>
            <SpatialNavigationView direction="horizontal" style={styles.buttons}>
              <DefaultFocus>
                <FocusButton
                  variant="primary"
                  icon="check"
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
      </OnSurface>
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
  sheet: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sheet,
    borderRadius: s(36),
    paddingVertical: s(36),
    paddingHorizontal: s(40),
  },
  badge: {
    marginRight: s(32),
  },
  texts: {
    flex: 1,
    paddingRight: s(40),
  },
  deep: {
    color: colors.deep,
  },
  soft: {
    color: colors.onSheetSoft,
  },
  desc: {
    marginTop: s(8),
  },
  buttons: {
    alignItems: 'center',
    marginRight: -(FOCUS.width + FOCUS.gap),
  },
  gap: {
    marginRight: s(12),
  },
});
