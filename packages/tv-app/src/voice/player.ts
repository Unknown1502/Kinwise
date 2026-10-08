import type {VoicePlayer} from './voiceTypes';

export type {VoicePlayer};

/**
 * Platform builds replace this file: player.vega.ts (Vega AudioPlayer) and player.web.ts (the
 * browser preview's <audio>). This silent version is what unit tests and type checks see.
 */

export function createPlayer(): VoicePlayer {
  return {
    play: async () => undefined,
    stop: () => undefined,
  };
}
