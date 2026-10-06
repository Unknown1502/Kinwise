import { describe, expect, it } from 'vitest';
import { START_CONCIERGE_HINT, classifyAskFailure, parseConciergeResponse, resultText, spokenFailure } from './concierge';

const sample = {
  reply: 'This has the warning signs of a scam.',
  toolCalls: [
    {
      name: 'kinwise_check_call',
      arguments: { description: 'FTC said withdraw gold' },
      result: {
        content: [{ type: 'text', text: 'Strong warning signs.' }],
        structuredContent: { level: 'high', signs: [] },
      },
      uiResourceUri: 'ui://kinwise/screening',
      latencyMs: 42,
    },
  ],
  sessionId: 's-1',
  model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  latencyMs: 1234,
};

describe('parseConciergeResponse', () => {
  it('accepts the documented contract', () => {
    const r = parseConciergeResponse(sample);
    expect(r.reply).toBe(sample.reply);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]!.uiResourceUri).toBe('ui://kinwise/screening');
    expect(r.toolCalls[0]!.result.structuredContent).toEqual({ level: 'high', signs: [] });
    expect(r.model).toContain('haiku');
  });

  it('fills defaults for optional fields (offline router)', () => {
    const r = parseConciergeResponse({ reply: 'Okay.' });
    expect(r).toMatchObject({ reply: 'Okay.', toolCalls: [], model: 'unknown', latencyMs: 0, sessionId: '' });
  });

  it('defaults missing arguments/result and keeps unknown fields', () => {
    const r = parseConciergeResponse({ reply: 'x', toolCalls: [{ name: 'kinwise_get_today', extra: 1 }] });
    expect(r.toolCalls[0]).toMatchObject({ name: 'kinwise_get_today', arguments: {}, result: {}, extra: 1 });
  });

  it('tolerates JSON null for optional fields', () => {
    const r = parseConciergeResponse({
      reply: 'x',
      model: null,
      toolCalls: [{ name: 't', arguments: null, uiResourceUri: null, latencyMs: null, result: { content: null, structuredContent: null } }],
    });
    expect(r.model).toBe('unknown');
    expect(r.toolCalls[0]).toMatchObject({ name: 't', arguments: {}, result: {} });
    expect(r.toolCalls[0]!.uiResourceUri).toBeUndefined();
  });

  it('drops a uiResourceUri that is not ui://', () => {
    const r = parseConciergeResponse({ reply: 'x', toolCalls: [{ name: 't', uiResourceUri: 'https://evil.example/card.html' }] });
    expect(r.toolCalls[0]!.uiResourceUri).toBeUndefined();
  });

  it('rejects a body without a reply, naming the field', () => {
    expect(() => parseConciergeResponse({ toolCalls: [] })).toThrow(/reply/);
    expect(() => parseConciergeResponse('nope')).toThrow(/unexpected reply/);
    expect(() => parseConciergeResponse({ reply: 'x', toolCalls: [{ arguments: {} }] })).toThrow(/toolCalls\.0\.name/);
  });
});

describe('resultText', () => {
  it('joins text blocks and ignores other content', () => {
    expect(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image' } as never, { type: 'text', text: 'b' }] })).toBe('a b');
    expect(resultText(undefined)).toBe('');
  });
});

describe('classifyAskFailure', () => {
  it('explains a missing concierge (503) with the start command', () => {
    const f = classifyAskFailure(503, { error: 'concierge_not_configured' });
    expect(f.kind).toBe('concierge_not_configured');
    expect(f.hint).toContain(START_CONCIERGE_HINT);
  });

  it('treats 5xx as the concierge being down', () => {
    const f = classifyAskFailure(500, { error: 'server_error' });
    expect(f.kind).toBe('concierge_down');
    expect(f.hint).toContain('uv run kinwise-concierge');
    expect(spokenFailure(f)).toMatch(/trouble/);
  });

  it('maps 401 and 403', () => {
    expect(classifyAskFailure(401, { error: 'invalid_token' }).kind).toBe('unauthorized');
    expect(classifyAskFailure(403, { error: 'forbidden', error_description: 'Sign in as a household member' }).hint).toBe(
      'Sign in as a household member',
    );
  });

  it('passes through a 400 description', () => {
    expect(classifyAskFailure(400, { error: 'invalid_request', error_description: 'Say something' }).hint).toBe('Say something');
  });
});
