import { createHmac, timingSafeEqual } from 'node:crypto';
import { PollyClient, SynthesizeSpeechCommand, type Engine, type VoiceId } from '@aws-sdk/client-polly';

/**
 * Natural speech for the Echo simulator and the Fire TV, synthesized by Amazon Polly.
 *
 * Clients ask POST /speech for a URL and play GET /speech/<token>.mp3. The text travels inside
 * the token, HMAC-signed and short-lived, so any Lambda instance can serve it and Vega's
 * AudioPlayer (which cannot send an Authorization header) can still play it.
 */

export const MAX_SPEECH_CHARS = 600;
export const SPEECH_URL_TTL_S = 15 * 60;

export interface SpeechSynth {
  readonly voice: string;
  synthesize(text: string): Promise<Uint8Array>;
}

const CACHE_SIZE = 64;

export class PollySynth implements SpeechSynth {
  private readonly client: PollyClient;
  /** Recent phrases ("Calling Priya now…") repeat a lot; keep their audio per container. */
  private readonly cache = new Map<string, Uint8Array>();

  constructor(
    readonly voice: string,
    private readonly engine: Engine,
    region: string,
  ) {
    this.client = new PollyClient({ region });
  }

  async synthesize(text: string): Promise<Uint8Array> {
    const hit = this.cache.get(text);
    if (hit) {
      this.cache.delete(text);
      this.cache.set(text, hit);
      return hit;
    }
    const out = await this.client.send(
      new SynthesizeSpeechCommand({
        Text: text,
        TextType: 'text',
        OutputFormat: 'mp3',
        SampleRate: '24000',
        VoiceId: this.voice as VoiceId,
        Engine: this.engine,
      }),
    );
    if (!out.AudioStream) throw new Error('Polly returned no audio');
    const audio = await out.AudioStream.transformToByteArray();
    this.cache.set(text, audio);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return audio;
  }
}

/** Make text comfortable to speak: no emoji or markdown, single spaces, at most 600 characters. */
export function speechText(raw: string): string {
  const clean = raw
    .replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= MAX_SPEECH_CHARS) return clean;
  const cut = clean.slice(0, MAX_SPEECH_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > MAX_SPEECH_CHARS / 2 ? cut.slice(0, end + 1) : cut;
}

/** The signing key for speech URLs, derived from the hub's ingest secret. */
export function speechKey(secret: string): string {
  return createHmac('sha256', secret).update('kinwise-speech-url').digest('hex');
}

function mac(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url').slice(0, 32);
}

/** Text → "<payload>.<signature>", valid for `ttlS` seconds. */
export function signSpeech(key: string, text: string, nowMs: number, ttlS = SPEECH_URL_TTL_S): string {
  const payload = Buffer.from(JSON.stringify({ t: text, e: Math.floor(nowMs / 1000) + ttlS })).toString('base64url');
  return `${payload}.${mac(key, payload)}`;
}

/** The text a token carries, or undefined if it is forged, malformed or expired. */
export function verifySpeech(key: string, token: string, nowMs: number): string | undefined {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return undefined;
  const expected = mac(key, payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
  try {
    const { t, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { t?: unknown; e?: unknown };
    if (typeof t !== 'string' || typeof e !== 'number' || e * 1000 < nowMs) return undefined;
    return t;
  } catch {
    return undefined;
  }
}
