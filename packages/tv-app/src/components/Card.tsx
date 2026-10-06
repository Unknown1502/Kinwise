import React from 'react';
import {StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {colors, s, type} from '../theme/theme';

/** A calm surface with an optional section title. Not focusable on its own. */
export function Card({title, children, style}: {title?: string; children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <Text style={[type.section, styles.title]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function EmptyLine({children}: {children: string}) {
  return <Text style={[type.small, styles.empty]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: s(28),
    paddingVertical: s(32),
    paddingHorizontal: s(36),
    borderWidth: s(2),
    borderColor: colors.line,
  },
  title: {
    marginBottom: s(20),
  },
  empty: {
    marginTop: s(4),
  },
});
