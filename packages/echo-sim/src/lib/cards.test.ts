import { describe, expect, it } from 'vitest';
import type { ToolCall } from './concierge';
import { cardTitle, cardsFromToolCalls, isUiResourceUri, prominentCardIds, pushCards, removeCard, toolErrorNotes, type CardSpec } from './cards';

const call = (name: string, uri?: string, extra: Partial<ToolCall> = {}): ToolCall => ({
  name,
  arguments: {},
  result: { content: [{ type: 'text', text: `${name} ok` }], structuredContent: { n: name } },
  uiResourceUri: uri,
  ...extra,
});

const ctx = { persona: 'asha' as const, source: 'concierge' as const, turnId: 't1', now: 1000 };

describe('cardsFromToolCalls', () => {
  it('keeps only calls with a ui:// resource', () => {
    const cards = cardsFromToolCalls([call('kinwise_set_privacy_hour'), call('kinwise_get_today', 'ui://kinwise/today')], ctx);
    expect(cards.map((c) => c.toolName)).toEqual(['kinwise_get_today']);
    expect(cards[0]).toMatchObject({ persona: 'asha', source: 'concierge', turnId: 't1', uiResourceUri: 'ui://kinwise/today' });
  });

  it('skips error results (the host shows their text instead)', () => {
    const cards = cardsFromToolCalls([call('kinwise_check_call', 'ui://kinwise/screening', { result: { isError: true, content: [] } })], ctx);
    expect(cards).toEqual([]);
  });

  it('keeps one card per resource per turn: the last call wins', () => {
    const cards = cardsFromToolCalls(
      [
        call('kinwise_add_reminder', 'ui://kinwise/screening'),
        call('kinwise_get_today', 'ui://kinwise/today'),
        call('kinwise_check_call', 'ui://kinwise/screening'),
      ],
      ctx,
    );
    expect(cards.map((c) => c.toolName)).toEqual(['kinwise_get_today', 'kinwise_check_call']);
  });

  it('falls back to the tool metadata resolver when uiResourceUri is missing', () => {
    const cards = cardsFromToolCalls([call('kinwise_explain_last_alert')], {
      ...ctx,
      resolveUri: (n) => (n === 'kinwise_explain_last_alert' ? 'ui://kinwise/pause' : undefined),
    });
    expect(cards[0]?.uiResourceUri).toBe('ui://kinwise/pause');
  });
});

describe('stack management', () => {
  const mk = (id: string, turnId: string): CardSpec => ({
    id,
    persona: 'asha',
    source: 'concierge',
    turnId,
    toolName: id,
    arguments: {},
    result: {},
    uiResourceUri: `ui://kinwise/${id}`,
    createdAt: 0,
  });

  it('puts the newest turn on top (last call first) and evicts beyond the cap', () => {
    const first = pushCards([], [mk('a', 't1'), mk('b', 't1')], 3);
    expect(first.stack.map((c) => c.id)).toEqual(['b', 'a']);
    const second = pushCards(first.stack, [mk('c', 't2'), mk('d', 't2')], 3);
    expect(second.stack.map((c) => c.id)).toEqual(['d', 'c', 'b']);
    expect(second.evicted.map((c) => c.id)).toEqual(['a']);
  });

  it('shows at most two cards of the newest turn prominently', () => {
    const { stack } = pushCards(pushCards([], [mk('a', 't1')]).stack, [mk('b', 't2'), mk('c', 't2'), mk('d', 't2')]);
    expect([...prominentCardIds(stack)]).toEqual(['d', 'c']);
    expect(prominentCardIds([]).size).toBe(0);
  });

  it('removes a card by id', () => {
    expect(removeCard([mk('a', 't'), mk('b', 't')], 'a').map((c) => c.id)).toEqual(['b']);
  });
});

describe('helpers', () => {
  it('validates ui:// uris', () => {
    expect(isUiResourceUri('ui://kinwise/today')).toBe(true);
    expect(isUiResourceUri('https://x')).toBe(false);
    expect(isUiResourceUri(undefined)).toBe(false);
  });

  it('collects calm notes for error results', () => {
    const notes = toolErrorNotes([
      call('kinwise_respond_to_alert', undefined, { result: { isError: true, content: [{ type: 'text', text: 'That alert is already closed.' }] } }),
      call('kinwise_get_today', 'ui://kinwise/today'),
      call('x', undefined, { result: { isError: true } }),
    ]);
    expect(notes).toEqual([
      { toolName: 'kinwise_respond_to_alert', text: 'That alert is already closed.' },
      { toolName: 'x', text: 'That did not work this time.' },
    ]);
  });

  it('titles cards', () => {
    expect(cardTitle('ui://kinwise/pause')).toBe('The Pause');
    expect(cardTitle('ui://kinwise/other')).toBe('other');
  });
});
