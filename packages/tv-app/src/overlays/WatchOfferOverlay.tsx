import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DefaultFocus, SpatialNavigationRoot, SpatialNavigationView} from 'react-tv-space-navigation';
import {announce} from '../a11y/announce';
import {FocusButton} from '../components/FocusButton';
import {IconBadge} from '../components/Icon';
import {OnSurface} from '../theme/surface';
import {FOCUS, SAFE, colors, s, type} from '../theme/theme';
import type {WatchChoice, WatchView} from '../types';

export const WATCH_TITLE = 'Kinwise has a question';

export interface WatchOfferOverlayProps {
  offer: NonNullable<WatchView['offer']>;
  busy?: WatchChoice | null;
  onAnswer: (choice: WatchChoice) => void;
}

/**
 * The safety-watch question, on the one screen that can answer it: this TV is authenticated as hers, and Alexa cannot
 * tell who is speaking. "Not now" has focus, so an accidental OK press starts nothing and tells nobody.
 */
export function WatchOfferOverlay({offer, busy, onAnswer}: WatchOfferOverlayProps) {
  const tell = offer.notifies ? (offer.tellsNow ? `, and send ${offer.notifies} a short message right away` : `, and tell ${offer.notifies} if it looks serious`) : '';
  useEffect(() => {
    announce(`${WATCH_TITLE}. Would you like a ${offer.hours}-hour safety watch for your front door${tell}? Not now is selected. You can choose Turn on.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id]);

  return (
    <View style={styles.scrim} testID="watch-offer-overlay">
      <OnSurface surface="sheet">
        <SpatialNavigationRoot>
          <View style={styles.sheet} accessibilityViewIsModal>
            <IconBadge name="shield-alert" color={colors.coral} size={s(96)} style={styles.badge} />
            <View style={styles.texts}>
              <Text style={[type.heading, styles.deep]} accessibilityRole="header">
                {WATCH_TITLE}
              </Text>
              <Text style={[type.body, styles.deep, styles.desc]}>
                {`Something you asked Kinwise about matched warning signs of a courier scam. Would you like a ${offer.hours}-hour safety watch for your front door${tell}?`}
              </Text>
              <Text style={[type.body, styles.soft]}>Nothing is turned on, and nobody is told, unless you choose Turn on.</Text>
            </View>
            <SpatialNavigationView direction="horizontal" style={styles.buttons}>
              <DefaultFocus>
                <FocusButton label="Not now" busy={busy === 'not_now'} onSelect={() => onAnswer('not_now')} style={styles.gap} />
              </DefaultFocus>
              <FocusButton
                variant="primary"
                icon="check"
                label="Turn on"
                accessibilityLabel={`Turn on a ${offer.hours} hour safety watch`}
                busy={busy === 'turn_on'}
                onSelect={() => onAnswer('turn_on')}
              />
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
    marginTop: s(8),
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
