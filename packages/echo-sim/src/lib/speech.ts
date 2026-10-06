/**
 * Speech helpers: text-to-speech for Alexa's replies (speechSynthesis) and the
 * Web Speech API recogniser for the mic button. Voice choice and text clean-up
 * are pure and unit-tested.
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

/** Speak a reply, cancelling anything still being spoken. Never throws. */
export function speak(text: string, opts: { onStart?: () => void; onEnd?: () => void } = {}): void {
  if (!canSpeak()) return;
  const clean = speakableText(text);
  if (!clean) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-US';
    const voice = pickVoice(synth.getVoices());
    if (voice) u.voice = voice;
    u.rate = 1;
    u.pitch = 1;
    u.onstart = () => opts.onStart?.();
    u.onend = () => opts.onEnd?.();
    u.onerror = () => opts.onEnd?.();
    synth.speak(u);
  } catch {
    opts.onEnd?.();
  }
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
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
