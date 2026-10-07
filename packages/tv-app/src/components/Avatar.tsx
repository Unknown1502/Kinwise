import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, fonts} from '../theme/theme';

/** A family member's face, as their initial on a warm disc (Kinwise keeps no photos). */
export function Avatar({name, size, color = colors.terracotta}: {name: string; size: number; color?: string}) {
  return (
    <View style={[styles.disc, {width: size, height: size, borderRadius: size / 2, backgroundColor: color}]}>
      <Text style={[styles.initial, {fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.56)}]}>
        {name.trim().charAt(0).toUpperCase() || '♥'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: colors.white,
  },
});
