import {useCallback, useEffect, useMemo, useRef} from 'react';
import {HubError, type HubClient} from '../api';
import {createPlayer} from './player';

const MAX_WAITING = 4;

export interface Voice {
  /** Say these lines after whatever is being said now. */
  speak: (lines: string[]) => void;
  /** Stop talking and say these lines right away (a visitor at the door beats a message). */
  speakNow: (lines: string[]) => void;
}

/**
 * The TV's voice: each line is fetched from the hub as natural speech (Amazon Polly) and played in
 * order. If the hub has no voice configured (503) the TV simply stays quiet for the session.
 */
export function useVoice(client: HubClient, enabled: boolean): Voice {
  const player = useMemo(() => createPlayer(), []);
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const available = useRef(true);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      queue.current = [];
      player.stop();
    }
  }, [enabled, player]);

  useEffect(() => () => player.stop(), [player]);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length > 0 && enabledRef.current && available.current) {
        const line = queue.current.shift()!;
        let url: string | undefined;
        try {
          url = await client.speechUrl(line);
        } catch (err) {
          if (err instanceof HubError && err.status === 503) available.current = false;
          continue;
        }
        if (url && enabledRef.current) await player.play(url);
      }
    } finally {
      running.current = false;
    }
  }, [client, player]);

  const speak = useCallback(
    (lines: string[]) => {
      if (!enabledRef.current || !available.current || lines.length === 0) return;
      queue.current.push(...lines);
      if (queue.current.length > MAX_WAITING) queue.current.splice(0, queue.current.length - MAX_WAITING);
      void pump();
    },
    [pump],
  );

  const speakNow = useCallback(
    (lines: string[]) => {
      queue.current = [];
      player.stop();
      speak(lines);
    },
    [player, speak],
  );

  return useMemo(() => ({speak, speakNow}), [speak, speakNow]);
}
