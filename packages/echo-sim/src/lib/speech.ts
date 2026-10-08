/**
 * Speech helpers: Alexa's spoken replies and the Web Speech API recogniser for the mic.
 * Replies use the hub's natural voice (Amazon Polly) when it is available and fall back to the
 * browser's speechSynthesis. Voice choice, text clean-up and wake-word parsing are pure and
 * unit-tested.
 */

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

const NATURAL_HINTS = [/natural/i, /neural/i, /online/i, /aria/i, /jenny/i, /ava/i, /samantha/i, /google us english/i, /zira/i];

/** Pick a natural-sounding en-US voice when one is available. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | undefined {
  if (!voices.length) return undefined;
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  const enUs = voices.filter((v) => norm(v.lang) === 'en-us');
  for (const hint of NATURAL_HINTS) {
    const hit = enUs.find((v) => hint.test(v.name));
    if (hit) return hit;
  }
  return enUs.find((v) => v.default) ?? enUs[0] ?? voices.find((v) => norm(v.lang).startsWith('en')) ?? voices[0];
}

/** Make a reply comfortable to speak: drop emoji and markdown, collapse whitespace. */
export function speakableText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export type VoiceKind = 'natural' | 'browser';
/** Where natural-voice audio comes from: text → a playable URL (or undefined to use the browser voice). */
export type NaturalVoiceSource = (text: string) => Promise<{ url: string; voice: string } | undefined>;

let naturalVoice: NaturalVoiceSource | undefined;
let onVoiceUsed: ((kind: VoiceKind, name: string) => void) | undefined;
let generation = 0;
let playing: HTMLAudioElement | undefined;
let pendingEnd: (() => void) | undefined;

/** Use the hub's natural voice for replies (pass undefined for the browser voice only). */
export function setNaturalVoice(source: NaturalVoiceSource | undefined, onUsed?: (kind: VoiceKind, name: string) => void): void {
  naturalVoice = source;
  onVoiceUsed = onUsed;
}

type SpeakOpts = { onStart?: () => void; onEnd?: () => void };

/** Speak a reply, cancelling anything still being spoken. Never throws. */
export function speak(text: string, opts: SpeakOpts = {}): void {
  const clean = speakableText(text);
  if (!clean) return;
  stopSpeaking();
  const mine = ++generation;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    if (pendingEnd === end) pendingEnd = undefined;
    opts.onEnd?.();
  };
  pendingEnd = end;
  const fallback = () => {
    if (mine === generation) speakWithBrowser(clean, { onStart: opts.onStart, onEnd: end });
  };
  if (!naturalVoice || typeof Audio === 'undefined') {
    fallback();
    return;
  }
  void naturalVoice(clean)
    .then((got) => {
      if (mine !== generation) return;
      if (!got) return fallback();
      const audio = new Audio(got.url);
      playing = audio;
      audio.onplaying = () => {
        opts.onStart?.();
        onVoiceUsed?.('natural', got.voice);
      };
      audio.onended = () => {
        if (playing === audio) playing = undefined;
        end();
      };
      audio.onerror = () => {
        if (playing === audio) playing = undefined;
        fallback();
      };
      audio.play().catch(() => {
        if (playing === audio) playing = undefined;
        fallback();
      });
    })
    .catch(fallback);
}

/** The browser's own text-to-speech (works offline; sounds more robotic). */
function speakWithBrowser(clean: string, opts: SpeakOpts): void {
  if (!canSpeak()) {
    opts.onEnd?.();
    return;
  }
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-US';
    const voice = pickVoice(synth.getVoices());
    if (voice) u.voice = voice;
    u.rate = 1;
    u.pitch = 1;
    u.onstart = () => {
      opts.onStart?.();
      onVoiceUsed?.('browser', voice?.name ?? 'browser voice');
    };
    u.onend = () => opts.onEnd?.();
    u.onerror = () => opts.onEnd?.();
    synth.speak(u);
  } catch {
    opts.onEnd?.();
  }
}

export function stopSpeaking(): void {
  generation++;
  if (playing) {
    playing.pause();
    playing = undefined;
  }
  const end = pendingEnd;
  pendingEnd = undefined;
  if (canSpeak()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
  end?.();
}

// ── Wake word ──

/** "Alexa" and what browsers commonly hear instead of it. */
const WAKE_WORD = /\b(?:alexa|alexia|alexis|alexus|elexa|a lexa)\b[\s,.!?:;-]*/i;

/**
 * "Alexa, is this call real?" → { woke: true, command: 'Is this call real?' }.
 * "Alexa" alone → { woke: true, command: '' } (listen for the next sentence).
 */
export function extractCommand(transcript: string): { woke: boolean; command: string } {
  const m = WAKE_WORD.exec(transcript);
  if (!m) return { woke: false, command: '' };
  const command = transcript
    .slice(m.index + m[0].length)
    .replace(/^[\s,.!?:;-]+/, '')
    .trim();
  return { woke: true, command: command ? command.charAt(0).toUpperCase() + command.slice(1) : '' };
}

export type WakeStep =
  | { kind: 'command'; text: string }
  | { kind: 'wake'; heard: string }
  | { kind: 'heard'; heard: string }
  | { kind: 'ignore' };

/**
 * One recognised phrase while hands-free is on. `awake` is true for a few seconds after a bare
 * "Alexa". Interim text only updates the screen; a final phrase sends a request or wakes up.
 */
export function wakeStep(transcript: string, isFinal: boolean, awake: boolean): WakeStep {
  const text = transcript.trim();
  const { woke, command } = extractCommand(text);
  if (!isFinal) {
    if (woke) return { kind: 'wake', heard: command };
    return awake ? { kind: 'heard', heard: text } : { kind: 'ignore' };
  }
  const said = woke ? command : awake ? text : '';
  if (said) return { kind: 'command', text: said };
  return woke ? { kind: 'wake', heard: '' } : { kind: 'ignore' };
}

/** Warm up the voice list (Chrome loads voices asynchronously). */
export function primeVoices(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());
  } catch {
    /* ignore */
  }
}

// ── Speech recognition (Web Speech API) ──

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Split a recognition event into the final transcript so far and the interim tail. */
export function transcriptsOf(e: SpeechRecognitionEventLike): { final: string; interim: string } {
  let final = '';
  let interim = '';
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i]!;
    const t = r[0]?.transcript ?? '';
    if (r.isFinal) final += t;
    else interim += t;
  }
  return { final: final.trim(), interim: interim.trim() };
}

export function recognitionErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. You can type instead.';
    case 'no-speech':
      return "I didn't hear anything. Try again, or type below.";
    case 'audio-capture':
      return 'No microphone was found. You can type instead.';
    case 'network':
      return 'Speech recognition needs a network connection. You can type instead.';
    case 'aborted':
      return '';
    default:
      return 'Speech recognition stopped. You can type instead.';
  }
}
