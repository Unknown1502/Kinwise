import type {VoicePlayer} from './voiceTypes';

export type {VoicePlayer};

/** Browser preview: a plain <audio> element. */
export function createPlayer(): VoicePlayer {
  let current: HTMLAudioElement | undefined;
  let finish: (() => void) | undefined;

  const stop = () => {
    current?.pause();
    current = undefined;
    finish?.();
    finish = undefined;
  };

  return {
    stop,
    play(url: string) {
      stop();
      if (typeof Audio === 'undefined') return Promise.resolve();
      const audio = new Audio(url);
      current = audio;
      return new Promise<void>((resolve) => {
        finish = resolve;
        const done = () => {
          if (current === audio) current = undefined;
          resolve();
        };
        audio.addEventListener('ended', done, {once: true});
        audio.addEventListener('error', done, {once: true});
        // Browsers refuse audio before the first key press; the preview just stays quiet then.
        audio.play().catch(done);
      });
    },
  };
}
