import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNotices, type NoticesOutcome } from './lib/hubApi';
import {
  getSpeechRecognition,
  recognitionErrorMessage,
  stopSpeaking,
  transcriptsOf,
  wakeStep,
  type SpeechRecognitionLike,
} from './lib/speech';

/** The current time, refreshed every `ms`. */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Scale a fixed-size element to fit its container (like a device on a desk). */
export function useFitScale(width: number, height: number, max = 1.25) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width: w, height: h } = entry.contentRect;
      if (w <= 0 || h <= 0) return;
      setScale(Math.max(0.25, Math.min(w / width, h / height, max)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, max]);
  return { ref, scale };
}

export interface SpeechInput {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string;
  start: () => void;
  stop: () => void;
}

/** Web Speech API recogniser (en-US, interim results). */
export function useSpeechRecognition(onFinal: (text: string) => void): SpeechInput {
  const [supported] = useState(() => !!getSpeechRecognition());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError('Voice input is not available in this browser. You can type instead.');
      return;
    }
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
    stopSpeaking(); // barge-in: the user talks over Alexa
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    finalRef.current = '';
    setInterim('');
    setError('');
    rec.onresult = (e) => {
      const { final, interim: tail } = transcriptsOf(e);
      if (final) finalRef.current = final;
      setInterim([final, tail].filter(Boolean).join(' '));
    };
    rec.onerror = (e) => {
      const msg = recognitionErrorMessage(e.error);
      if (msg) setError(msg);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = finalRef.current.trim();
      finalRef.current = '';
      setInterim('');
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      setError('Could not start the microphone. You can type instead.');
    }
  }, []);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported, listening, interim, error, start, stop };
}

export type WakeState = 'off' | 'waiting' | 'awake';

export interface WakeWord {
  supported: boolean;
  on: boolean;
  state: WakeState;
  /** What is being heard after "Alexa", live. */
  heard: string;
  error: string;
  setOn: (on: boolean) => void;
}

const AWAKE_MS = 8000;
/** Errors that mean the mic can't be used: switch hands-free off instead of retrying forever. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/**
 * Hands-free "Alexa": a continuous recogniser that waits for the wake word. "Alexa, …" sends what
 * follows; "Alexa" alone listens for the next sentence for 8 s. It is paused while Alexa thinks or
 * speaks (so she never hears herself) and while the push-to-talk mic is in use.
 */
export function useWakeWord(onCommand: (text: string) => void, paused: boolean): WakeWord {
  const [supported] = useState(() => !!getSpeechRecognition());
  const [on, setOnState] = useState(false);
  const [state, setState] = useState<WakeState>('off');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const awakeUntil = useRef(0);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ on: false, paused });
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  });

  const sleep = useCallback(() => {
    awakeUntil.current = 0;
    clearTimeout(sleepTimer.current);
    setHeard('');
    setState(live.current.on ? 'waiting' : 'off');
  }, []);

  const wake = useCallback(() => {
    awakeUntil.current = Date.now() + AWAKE_MS;
    setState('awake');
    clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(sleep, AWAKE_MS);
  }, [sleep]);

  const stopRec = useCallback(() => {
    clearTimeout(restartTimer.current);
    const rec = recRef.current;
    recRef.current = null;
    try {
      rec?.abort();
    } catch {
      /* already stopped */
    }
  }, []);

  const startRec = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor || recRef.current || !live.current.on || live.current.paused) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const step = wakeStep(r[0]?.transcript ?? '', r.isFinal, Date.now() < awakeUntil.current);
        if (step.kind === 'command') {
          sleep();
          onCommandRef.current(step.text);
        } else if (step.kind === 'wake') {
          wake();
          setHeard(step.heard);
        } else if (step.kind === 'heard') {
          setHeard(step.heard);
        }
      }
    };
    rec.onerror = (e) => {
      if (FATAL.has(e.error)) {
        setError(recognitionErrorMessage(e.error));
        live.current.on = false;
        setOnState(false);
        setState('off');
      }
    };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      // Browsers end continuous recognition after a while; keep listening while hands-free is on.
      if (live.current.on && !live.current.paused) restartTimer.current = setTimeout(startRec, 300);
    };
    recRef.current = rec;
    try {
      rec.start();
      setState((s) => (s === 'awake' ? s : 'waiting'));
    } catch {
      recRef.current = null;
    }
  }, [sleep, wake]);

  useEffect(() => {
    live.current = { on, paused };
    if (on && !paused) startRec();
    else stopRec();
    if (!on) {
      sleep();
      setState('off');
    }
  }, [on, paused, startRec, stopRec, sleep]);

  useEffect(
    () => () => {
      live.current.on = false;
      clearTimeout(sleepTimer.current);
      stopRec();
    },
    [stopRec],
  );

  const setOn = useCallback(
    (next: boolean) => {
      if (next && !getSpeechRecognition()) {
        setError('Hands-free listening needs Chrome or Edge.');
        return;
      }
      setError('');
      if (next) stopSpeaking();
      setOnState(next);
    },
    [],
  );

  return { supported, on, state, heard, error, setOn };
}

/** Poll {hub}/dev/notices every `ms` ("Priya's phone"). */
export function useNotices(hubUrl: string, ms = 2000): NoticesOutcome | undefined {
  const [state, setState] = useState<NoticesOutcome | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const out = await fetchNotices(hubUrl);
      if (!alive) return;
      setState((prev) => (prev && JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
      // If the dev route is missing, check again rarely (the hub may be restarted with dev routes).
      timer = setTimeout(() => void tick(), out.status === 'unavailable' ? 30_000 : ms);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [hubUrl, ms]);
  return state;
}
