import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { spokenDay, spokenMessages } from '../src/services/views.js';
import { MAX_SPEECH_CHARS, signSpeech, speechKey, speechText, verifySpeech, type SpeechSynth } from '../src/speech/speech.js';

type App = Awaited<ReturnType<typeof bootstrap>>['app'];

/** Stands in for Amazon Polly: "audio" is the text's bytes, and every call is recorded. */
class FakeVoice implements SpeechSynth {
  readonly voice = 'Joanna';
  readonly said: string[] = [];
  async synthesize(text: string): Promise<Uint8Array> {
    this.said.push(text);
    return new TextEncoder().encode(`MP3:${text}`);
  }
}

async function makeApp(speech?: SpeechSynth) {
  const config = loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv);
  return bootstrap(config, { speech });
}

const post = (app: App, path: string, body: unknown, token?: string) =>
  app.fetch(
    new Request(`http://kinwise.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

async function connect(app: App, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL('http://kinwise.test/mcp'), {
    fetch: async (url, init) => app.fetch(new Request(url, init)),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'kinwise-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('speech links', () => {
  const key = speechKey('test-secret');
  const now = Date.parse('2026-10-08T12:00:00Z');

  it('round-trips the text inside a signed token', () => {
    const token = signSpeech(key, 'Calling Priya now.', now);
    expect(verifySpeech(key, token, now + 60_000)).toBe('Calling Priya now.');
  });

  it('rejects tampered, foreign, malformed and expired tokens', () => {
    const token = signSpeech(key, 'Hello', now);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ t: 'Send money', e: now / 1000 + 900 })).toString('base64url');
    expect(verifySpeech(key, `${forged}.${sig}`, now)).toBeUndefined();
    expect(verifySpeech(speechKey('other-secret'), token, now)).toBeUndefined();
    expect(verifySpeech(key, `${payload}`, now)).toBeUndefined();
    expect(verifySpeech(key, `${token}.extra`, now)).toBeUndefined();
    expect(verifySpeech(key, token, now + 16 * 60_000)).toBeUndefined();
  });

  it('makes text comfortable to speak and keeps it short', () => {
    expect(speechText('  **Hello** 👋  Asha\n\nhow are you? ')).toBe('Hello Asha how are you?');
    const long = 'This is a sentence. '.repeat(60);
    const out = speechText(long);
    expect(out.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
    expect(out.endsWith('.')).toBe(true);
  });
});

describe('POST /speech and GET /speech/:token', () => {
  it('needs a household token, and says so when speech is off', async () => {
    const { app } = await makeApp();
    expect((await post(app, '/speech', { text: 'Hi' })).status).toBe(401);
    expect((await post(app, '/speech', { text: 'Hi' }, 'dev-service')).status).toBe(403);
    const off = await post(app, '/speech', { text: 'Hi' }, 'dev-asha');
    expect(off.status).toBe(503);
    expect((await off.json()).error).toBe('speech_unavailable');
  });

  it('hands out a link the TV can play without an auth header', async () => {
    const voice = new FakeVoice();
    const { app } = await makeApp(voice);
    const res = await post(app, '/speech', { text: 'Someone is at the door.' }, 'dev-tv');
    expect(res.status).toBe(200);
    const { url, voice: name } = (await res.json()) as { url: string; voice: string };
    expect(name).toBe('Joanna');
    expect(url).toMatch(/^http:\/\/localhost:8787\/speech\/[\w-]+\.[\w-]+\.mp3$/);

    const audio = await app.fetch(new Request(`http://kinwise.test${new URL(url).pathname}`));
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    expect(new TextDecoder().decode(await audio.arrayBuffer())).toBe('MP3:Someone is at the door.');
    expect(voice.said).toEqual(['Someone is at the door.']);
  });

  it('refuses a link whose text was changed', async () => {
    const { app } = await makeApp(new FakeVoice());
    const { url } = (await (await post(app, '/speech', { text: 'Hello' }, 'dev-asha')).json()) as { url: string };
    const [payload, rest] = new URL(url).pathname.replace('/speech/', '').split('.');
    const other = Buffer.from(JSON.stringify({ t: 'Goodbye', e: 9_999_999_999 })).toString('base64url');
    const res = await app.fetch(new Request(`http://kinwise.test/speech/${other}.${rest}.mp3`));
    expect(payload).not.toBe(other);
    expect(res.status).toBe(403);
  });

  it('rejects empty text', async () => {
    const { app } = await makeApp(new FakeVoice());
    expect((await post(app, '/speech', { text: '  ' }, 'dev-asha')).status).toBe(400);
  });
});

describe('Alexa → TV: kinwise_read_on_tv', () => {
  it('is a resident tool that queues a cue the TV picks up', async () => {
    const { app } = await makeApp();
    const priyaTools = (await (await connect(app, 'dev-priya')).listTools()).tools.map((t) => t.name);
    expect(priyaTools).not.toContain('kinwise_read_on_tv');

    const priya = await connect(app, 'dev-priya');
    await priya.callTool({ name: 'kinwise_send_family_message', arguments: { text: 'Dinner at 6?' } });

    const asha = await connect(app, 'dev-asha');
    const tool = (await asha.listTools()).tools.find((t) => t.name === 'kinwise_read_on_tv')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });

    const r = await asha.callTool({ name: 'kinwise_read_on_tv', arguments: { topic: 'messages' } });
    expect(r.isError).toBeFalsy();
    expect((r.content as Array<{ text: string }>)[0]!.text).toMatch(/reading your messages on the TV/i);
    expect(r.structuredContent).toMatchObject({ topic: 'messages', deliveredTo: "Asha's TV" });

    const tv = await (await app.fetch(new Request('http://kinwise.test/tv/state', { headers: { authorization: 'Bearer dev-tv' } }))).json();
    expect(tv.cue).toMatchObject({ topic: 'messages' });
    expect(tv.cue.text).toMatch(/Priya, at .*: Dinner at 6\?/);
  });
});

describe('spoken summaries', () => {
  it('reads messages newest first, at most three', () => {
    const m = (n: number) => ({ id: `m${n}`, from: 'Priya', text: `Note ${n}`, timeLabel: `${n}:00 PM`, unread: true });
    expect(spokenMessages({ messages: [] })).toBe('There are no messages from family today.');
    expect(spokenMessages({ messages: [m(1)] })).toBe('You have one message. Priya, at 1:00 PM: Note 1');
    expect(spokenMessages({ messages: [m(4), m(3), m(2), m(1)] })).toMatch(/^You have 4 messages\. Here are the latest 3\. Priya, at 4:00 PM: Note 4/);
  });

  it('reads the day as visits, then reminders', () => {
    expect(spokenDay({ visits: [], reminders: [] })).toBe('Nothing is planned for today.');
    expect(
      spokenDay({
        visits: [{ id: 'v', label: 'Maria (home-health aide)', timeLabel: '2:00 PM–3:00 PM' }],
        reminders: [{ id: 'r', text: 'call the pharmacy', timeLabel: '4:30 PM', flagged: false }],
      }),
    ).toBe("Here's your day. Maria (home-health aide) is expected from 2:00 PM to 3:00 PM. At 4:30 PM: Call the pharmacy.");
  });
});
