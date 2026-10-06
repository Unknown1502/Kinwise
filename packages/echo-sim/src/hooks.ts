import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNotices, type NoticesOutcome } from './lib/hubApi';
import { getSpeechRecognition, recognitionErrorMessage, stopSpeaking, transcriptsOf, type SpeechRecognitionLike } from './lib/speech';

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
