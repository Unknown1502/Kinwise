import { describe, expect, it } from 'vitest';
import type { CardSpec } from './lib/cards';
import { initialState, reducer, type Turn } from './state';

const turn = (id: string, persona: 'asha' | 'priya' = 'asha'): Turn => ({ id, persona, source: 'text', utterance: id, status: 'pending', at: 0 });
const card = (id: string, turnId = 't'): CardSpec => ({
  id,
  persona: 'asha',
  source: 'concierge',
  turnId,
  toolName: 'kinwise_get_today',
  arguments: {},
  result: {},
  uiResourceUri: 'ui://kinwise/today',
  createdAt: 0,
});

describe('reducer', () => {
  it('keeps a separate session id, transcript and cards per persona', () => {
    let s = initialState();
    expect(s.asha.sessionId).not.toBe(s.priya.sessionId);
    s = reducer(s, { type: 'turn-start', turn: turn('a1') });
    s = reducer(s, { type: 'cards-add', persona: 'asha', cards: [card('c1')] });
    expect(s.asha.view).toBe('conversation');
    expect(s.asha.turns.map((t) => t.id)).toEqual(['a1']);
    expect(s.priya.turns).toEqual([]);
    expect(s.priya.cards).toEqual([]);
  });

  it('updates a turn in place and removes cards', () => {
    let s = reducer(initialState(), { type: 'turn-start', turn: turn('a1') });
    s = reducer(s, { type: 'turn-update', persona: 'asha', id: 'a1', patch: { status: 'done', reply: 'Okay.' } });
    expect(s.asha.turns[0]).toMatchObject({ status: 'done', reply: 'Okay.' });
    s = reducer(s, { type: 'cards-add', persona: 'asha', cards: [card('c1'), card('c2')] });
    s = reducer(s, { type: 'card-remove', persona: 'asha', id: 'c1' });
    expect(s.asha.cards.map((c) => c.id)).toEqual(['c2']);
  });

  it('reset clears everything and issues new session ids', () => {
    let s = reducer(initialState(), { type: 'turn-start', turn: turn('a1') });
    const before = s.asha.sessionId;
    s = reducer(s, { type: 'reset-all' });
    expect(s.asha.turns).toEqual([]);
    expect(s.asha.view).toBe('home');
    expect(s.asha.sessionId).not.toBe(before);
  });
});
