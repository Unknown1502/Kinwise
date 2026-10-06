import { describe, expect, it } from 'vitest';
import { formatMs, localIsoAt, modelLabel, prettyJson, sampleArgs, toolLabel } from './format';

describe('prettyJson', () => {
  it('pretty-prints and shortens long strings', () => {
    const out = prettyJson({ html: 'x'.repeat(700), n: 1 }, 10);
    expect(out).toContain('"html": "xxxxxxxxxx… (700 chars)"');
    expect(out).toContain('"n": 1');
    expect(prettyJson(undefined)).toBe('—');
  });
});

describe('formatMs', () => {
  it('formats durations', () => {
    expect(formatMs(12.4)).toBe('12 ms');
    expect(formatMs(1234)).toBe('1.2 s');
    expect(formatMs(undefined)).toBe('—');
  });
});

describe('localIsoAt', () => {
  it('builds an ISO date-time with the local offset', () => {
    const iso = localIsoAt(new Date(2026, 9, 5, 9, 30), 14);
    expect(iso).toMatch(/^2026-10-05T14:00:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getHours()).toBe(14);
  });
});

describe('labels and samples', () => {
  it('labels tools and models', () => {
    expect(toolLabel('kinwise_respond_to_alert')).toBe('respond to alert');
    expect(modelLabel('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Claude Haiku 4.5');
    expect(modelLabel('offline-router')).toMatch(/offline/);
  });

  it('provides demo sample arguments', () => {
    expect(sampleArgs('kinwise_check_call').description).toMatch(/FTC/);
    expect(sampleArgs('kinwise_add_expected_visit')).toMatchObject({ weekday: 'tuesday', start: '14:00' });
    expect(sampleArgs('kinwise_get_today')).toEqual({});
  });
});
