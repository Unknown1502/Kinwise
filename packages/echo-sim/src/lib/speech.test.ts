import { describe, expect, it } from 'vitest';
import { pickVoice, recognitionErrorMessage, speakableText, transcriptsOf } from './speech';

describe('pickVoice', () => {
  it('prefers a natural en-US voice', () => {
    const voices = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US' },
      { name: 'Google UK English Female', lang: 'en-GB' },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
    ];
    expect(pickVoice(voices)?.name).toContain('Aria');
  });

  it('falls back to any en-US, then any English, then anything', () => {
    expect(pickVoice([{ name: 'Fred', lang: 'en_US' }, { name: 'X', lang: 'fr-FR' }])?.name).toBe('Fred');
    expect(pickVoice([{ name: 'Daniel', lang: 'en-GB' }, { name: 'X', lang: 'fr-FR' }])?.name).toBe('Daniel');
    expect(pickVoice([{ name: 'X', lang: 'fr-FR' }])?.name).toBe('X');
    expect(pickVoice([])).toBeUndefined();
  });
});

describe('speakableText', () => {
  it('drops emoji and markdown and collapses whitespace', () => {
    expect(speakableText('Sent. Dinner Sunday? ❤️  **Done**')).toBe('Sent. Dinner Sunday? Done');
    expect(speakableText('👨‍👩‍👧 Family')).toBe('Family');
  });
});

describe('transcriptsOf', () => {
  it('splits final and interim results', () => {
    const results = Object.assign(
      [
        Object.assign([{ transcript: 'what is ' }], { isFinal: true }),
        Object.assign([{ transcript: 'happening today' }], { isFinal: false }),
      ],
      {},
    );
    expect(transcriptsOf({ resultIndex: 0, results })).toEqual({ final: 'what is', interim: 'happening today' });
  });
});

describe('recognitionErrorMessage', () => {
  it('explains common errors and stays quiet on abort', () => {
    expect(recognitionErrorMessage('not-allowed')).toMatch(/blocked/);
    expect(recognitionErrorMessage('aborted')).toBe('');
  });
});
