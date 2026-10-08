import {AudioPlayer} from '@amazon-devices/react-native-w3cmedia';
import type {VoicePlayer} from './voiceTypes';

export type {VoicePlayer};

const LINE_TIMEOUT_MS = 30_000;

/**
 * Vega OS: @amazon-devices/react-native-w3cmedia AudioPlayer (an HTMLAudioElement), the same
 * initialize → src → load → play lifecycle FamilyVideo uses for video. One player per line,
 * released when the line ends, so nothing holds the audio pipeline between announcements.
 */
export function createPlayer(): VoicePlayer {
  let current: AudioPlayer | undefined;
  let finish: (() => void) | undefined;

  const release = (player: AudioPlayer) => {
    try {
      player.pause();
      player.deinitializeSync(1000);
    } catch (err) {
      console.warn('[kinwise] voice player cleanup failed', err);
    }
  };

  const stop = () => {
    if (current) release(current);
    current = undefined;
    finish?.();
    finish = undefined;
  };

  return {
    stop,
    async play(url: string) {
      stop();
      const player = new AudioPlayer();
      current = player;
      try {
        await player.initialize();
      } catch (err) {
        console.warn('[kinwise] voice player could not start', err);
        if (current === player) current = undefined;
        return;
      }
      if (current !== player) {
        release(player);
        return;
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          player.removeEventListener('ended', done);
          player.removeEventListener('error', done);
          resolve();
        };
        const timer = setTimeout(done, LINE_TIMEOUT_MS);
        finish = done;
        player.addEventListener('ended', done);
        player.addEventListener('error', done);
        player.autoplay = true;
        player.src = url;
        player.load();
        player.play();
      });
      if (current === player) {
        release(player);
        current = undefined;
      }
    },
  };
}
