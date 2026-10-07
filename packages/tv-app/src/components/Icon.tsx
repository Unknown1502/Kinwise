import React from 'react';
import {Image, View, type ImageStyle, type StyleProp, type ViewStyle} from 'react-native';
import arrowLeftDark from '../../assets/icons/arrow-left-dark.png';
import arrowLeftLight from '../../assets/icons/arrow-left-light.png';
import bellDark from '../../assets/icons/bell-dark.png';
import bellLight from '../../assets/icons/bell-light.png';
import calendarDaysDark from '../../assets/icons/calendar-days-dark.png';
import calendarDaysLight from '../../assets/icons/calendar-days-light.png';
import checkDark from '../../assets/icons/check-dark.png';
import checkLight from '../../assets/icons/check-light.png';
import clockDark from '../../assets/icons/clock-dark.png';
import clockLight from '../../assets/icons/clock-light.png';
import doorOpenDark from '../../assets/icons/door-open-dark.png';
import doorOpenLight from '../../assets/icons/door-open-light.png';
import eyeDark from '../../assets/icons/eye-dark.png';
import eyeLight from '../../assets/icons/eye-light.png';
import houseHeartDark from '../../assets/icons/house-heart-dark.png';
import houseHeartLight from '../../assets/icons/house-heart-light.png';
import messageCircleHeartDark from '../../assets/icons/message-circle-heart-dark.png';
import messageCircleHeartLight from '../../assets/icons/message-circle-heart-light.png';
import moonDark from '../../assets/icons/moon-dark.png';
import moonLight from '../../assets/icons/moon-light.png';
import phoneDark from '../../assets/icons/phone-dark.png';
import phoneLight from '../../assets/icons/phone-light.png';
import settingsDark from '../../assets/icons/settings-dark.png';
import settingsLight from '../../assets/icons/settings-light.png';
import shieldAlertDark from '../../assets/icons/shield-alert-dark.png';
import shieldAlertLight from '../../assets/icons/shield-alert-light.png';
import shieldCheckDark from '../../assets/icons/shield-check-dark.png';
import shieldCheckLight from '../../assets/icons/shield-check-light.png';
import userRoundDark from '../../assets/icons/user-round-dark.png';
import userRoundLight from '../../assets/icons/user-round-light.png';
import xDark from '../../assets/icons/x-dark.png';
import xLight from '../../assets/icons/x-light.png';
import {asset} from './asset';

/** Lucide icons (ISC licence, assets/icons/LICENSE-lucide.txt), pre-rendered light and dark so Vega needs no tinting. */
const ICONS = {
  'arrow-left': {dark: asset(arrowLeftDark), light: asset(arrowLeftLight)},
  'bell': {dark: asset(bellDark), light: asset(bellLight)},
  'calendar-days': {dark: asset(calendarDaysDark), light: asset(calendarDaysLight)},
  'check': {dark: asset(checkDark), light: asset(checkLight)},
  'clock': {dark: asset(clockDark), light: asset(clockLight)},
  'door-open': {dark: asset(doorOpenDark), light: asset(doorOpenLight)},
  'eye': {dark: asset(eyeDark), light: asset(eyeLight)},
  'house-heart': {dark: asset(houseHeartDark), light: asset(houseHeartLight)},
  'message-circle-heart': {dark: asset(messageCircleHeartDark), light: asset(messageCircleHeartLight)},
  'moon': {dark: asset(moonDark), light: asset(moonLight)},
  'phone': {dark: asset(phoneDark), light: asset(phoneLight)},
  'settings': {dark: asset(settingsDark), light: asset(settingsLight)},
  'shield-alert': {dark: asset(shieldAlertDark), light: asset(shieldAlertLight)},
  'shield-check': {dark: asset(shieldCheckDark), light: asset(shieldCheckLight)},
  'user-round': {dark: asset(userRoundDark), light: asset(userRoundLight)},
  'x': {dark: asset(xDark), light: asset(xLight)},
} as const;

export type IconName = keyof typeof ICONS;
export type IconTone = 'light' | 'dark';

/** A decorative icon; the text beside it always carries the meaning. */
export function Icon({name, tone = 'light', size, style}: {name: IconName; tone?: IconTone; size: number; style?: StyleProp<ImageStyle>}) {
  return <Image source={ICONS[name][tone]} style={[{width: size, height: size}, style]} accessible={false} />;
}

/** A dark icon on a coloured disc: the way each kind of thing in the day is marked. */
export function IconBadge({name, color, size, style}: {name: IconName; color: string; size: number; style?: StyleProp<ViewStyle>}) {
  return (
    <View
      style={[
        {width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center'},
        style,
      ]}>
      <Icon name={name} tone="dark" size={Math.round(size * 0.52)} />
    </View>
  );
}
