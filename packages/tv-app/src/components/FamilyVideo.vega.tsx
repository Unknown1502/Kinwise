import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {KeplerVideoSurfaceView, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {colors, s} from '../theme/theme';
import type {FamilyVideoProps} from './familyVideoTypes';
import {VideoPlaceholder} from './VideoPlaceholder';

export type {FamilyVideoProps};

/**
 * Vega OS family video using @amazon-devices/react-native-w3cmedia, following the lifecycle in
 * Amazon's multi-TV sample (VideoHandler.kepler.ts + PlayerScreen.vega.tsx):
 *   new VideoPlayer() → initialize() → src/load() → 'loadedmetadata' → render
 *   KeplerVideoSurfaceView → onSurfaceViewCreated → setSurfaceHandle() + play().
 * Captions are always rendered as large text by the Pause screen, so KeplerCaptionsView is not used.
 *
 * TODO(vega-device): verified only by reading the sample, not on hardware. Confirm on the
 * Vega Virtual Device that (1) a non-fullscreen KeplerVideoSurfaceView renders inside the card,
 * and (2) plain-HTTP MP4 from the hub plays. If either fails, return <VideoPlaceholder/> here:
 * the Pause still works with captions only.
 */
export function FamilyVideo({url, from, style}: FamilyVideoProps) {
  const playerRef = useRef<VideoPlayer | null>(null);
  const surfaceRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    if (!url) return;
    let cancelled = false;
    const player = new VideoPlayer();
    playerRef.current = player;

    const onLoadedMetadata = () => {
      if (!cancelled) setReady(true);
    };
    const onError = () => {
      if (!cancelled) setFailed(true);
    };

    player
      .initialize()
      .then(() => {
        if (cancelled) return;
        player.addEventListener('loadedmetadata', onLoadedMetadata);
        player.addEventListener('error', onError);
        player.autoplay = false;
        player.src = url;
        player.pause();
        player.load();
      })
      .catch(onError);

    return () => {
      cancelled = true;
      try {
        player.pause();
        player.removeEventListener('loadedmetadata', onLoadedMetadata);
        player.removeEventListener('error', onError);
        if (surfaceRef.current) player.clearSurfaceHandle(surfaceRef.current);
        player.deinitializeSync(1500);
      } catch (err) {
        console.warn('[kinwise] FamilyVideo cleanup failed', err);
      }
      if (playerRef.current === player) playerRef.current = null;
      surfaceRef.current = null;
    };
  }, [url]);

  const onSurfaceViewCreated = useCallback((surfaceHandle: string) => {
    surfaceRef.current = surfaceHandle;
    const player = playerRef.current;
    if (!player) return;
    player.setSurfaceHandle(surfaceHandle);
    player.play();
  }, []);

  const onSurfaceViewDestroyed = useCallback((surfaceHandle: string) => {
    playerRef.current?.clearSurfaceHandle(surfaceHandle);
    surfaceRef.current = null;
  }, []);

  if (!url || failed) return <VideoPlaceholder from={from} style={style} />;

  return (
    <View style={[styles.frame, style]} accessible accessibilityRole="image" accessibilityLabel={`Video message from ${from}`}>
      {ready ? (
        <KeplerVideoSurfaceView
          style={styles.surface}
          onSurfaceViewCreated={onSurfaceViewCreated}
          onSurfaceViewDestroyed={onSurfaceViewDestroyed}
          testID="family-video-surface"
        />
      ) : (
        <VideoPlaceholder from={from} style={styles.surface} />
      )}
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
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
});
