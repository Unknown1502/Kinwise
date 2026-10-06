import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, s} from '../theme/theme';
import type {FamilyVideoProps} from './familyVideoTypes';
import {VideoPlaceholder} from './VideoPlaceholder';

export type {FamilyVideoProps};

/**
 * Browser-preview video: a plain <video> element inside a react-native-web View.
 * Browsers block autoplay with sound, so the preview plays muted; captions are shown by the
 * Pause screen regardless. Falls back to the placeholder if the file is missing.
 */
export function FamilyVideo({url, from, style}: FamilyVideoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [url]);

  if (!url || failed) return <VideoPlaceholder from={from} style={style} />;

  return (
    <View style={[styles.frame, style]} accessibilityLabel={`Video message from ${from}`} accessibilityRole="image">
      <video
        src={url}
        autoPlay
        muted
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
        style={{width: '100%', height: '100%', objectFit: 'cover', display: 'block', backgroundColor: colors.surface2}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 16 / 9,
    width: '100%',
    borderRadius: s(24),
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
});
