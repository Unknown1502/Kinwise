import { describe, expect, it } from 'vitest';
import { requestSpeech } from './hubApi';
import { extractCommand, wakeStep } from './speech';

describe('extractCommand (hands-free wake word)', () => {
  it('takes what follows "Alexa" as the request', () => {
    expect(extractCommand('Alexa, is this call real?')).toEqual({ woke: true, command: 'Is this call real?' });
    expect(extractCommand('alexa read my messages on the TV')).toEqual({ woke: true, command: 'Read my messages on the TV' });
    expect(extractCommand('okay Alexa. Give me an hour of privacy')).toEqual({ woke: true, command: 'Give me an hour of privacy' });
  });

  it('wakes on its own and on common mishearings', () => {
    expect(extractCommand('Alexa')).toEqual({ woke: true, command: '' });
    expect(extractCommand('Alexia?')).toEqual({ woke: true, command: '' });
    expect(extractCommand('Alexis what is happening today')).toEqual({ woke: true, command: 'What is happening today' });
  });

  it('ignores speech without the wake word', () => {
    expect(extractCommand('what is happening today')).toEqual({ woke: false, command: '' });
    expect(extractCommand('Alexander came by')).toEqual({ woke: false, command: '' });
  });
});

describe('wakeStep (one phrase while hands-free is on)', () => {
  it('sends "Alexa, …" as soon as the phrase is final', () => {
    expect(wakeStep('Alexa, read my', false, false)).toEqual({ kind: 'wake', heard: 'Read my' });
    expect(wakeStep('Alexa, read my messages on the TV', true, false)).toEqual({ kind: 'command', text: 'Read my messages on the TV' });
  });

  it('after a bare "Alexa", takes the next sentence as the request', () => {
    expect(wakeStep('Alexa', true, false)).toEqual({ kind: 'wake', heard: '' });
    expect(wakeStep('is this call', false, true)).toEqual({ kind: 'heard', heard: 'is this call' });
    expect(wakeStep('is this call real', true, true)).toEqual({ kind: 'command', text: 'is this call real' });
  });

  it('ignores conversation in the room', () => {
    expect(wakeStep('pass the salt please', false, false)).toEqual({ kind: 'ignore' });
    expect(wakeStep('pass the salt please', true, false)).toEqual({ kind: 'ignore' });
  });
});

describe('requestSpeech', () => {
  const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('returns the natural-voice link and voice name', async () => {
    let sent: RequestInit | undefined;
    const out = await requestSpeech('http://hub.test', 'dev-asha', 'Hello', {
      fetchImpl: async (_url, init) => {
        sent = init;
        return ok({ url: 'http://hub.test/speech/a.b.mp3', voice: 'Joanna' })();
      },
    });
    expect(out).toEqual({ url: 'http://hub.test/speech/a.b.mp3', voice: 'Joanna' });
    expect((sent?.headers as Record<string, string>).authorization).toBe('Bearer dev-asha');
    expect(JSON.parse(String(sent?.body))).toEqual({ text: 'Hello' });
  });

  it('falls back (undefined) when the hub has no voice or is unreachable', async () => {
    expect(await requestSpeech('http://hub.test', 't', 'Hi', { fetchImpl: ok({ error: 'speech_unavailable' }, 503) })).toBeUndefined();
    expect(
      await requestSpeech('http://hub.test', 't', 'Hi', {
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    ).toBeUndefined();
  });
});
