import { describe, expect, it } from 'vitest';
import { ASHA_SUGGESTIONS, DEFAULT_HUB_URL, PRIYA_SUGGESTIONS, greetingFor, loadConfig, maskToken, newSessionId, normaliseHubUrl } from './personas';

describe('loadConfig', () => {
  it('uses the dev defaults', () => {
    const c = loadConfig({});
    expect(c.hubUrl).toBe(DEFAULT_HUB_URL);
    expect(c.personas.asha).toMatchObject({ token: 'dev-asha', role: 'resident', deviceName: "Asha's kitchen Echo Show" });
    expect(c.personas.priya).toMatchObject({ token: 'dev-priya', role: 'caregiver', deviceName: "Priya's Echo Show" });
  });

  it('reads Vite env overrides', () => {
    const c = loadConfig({ VITE_HUB_URL: 'https://hub.example.com/', VITE_ASHA_TOKEN: ' tok-a ', VITE_PRIYA_TOKEN: 'tok-p' });
    expect(c.hubUrl).toBe('https://hub.example.com');
    expect(c.personas.asha.token).toBe('tok-a');
    expect(c.personas.priya.token).toBe('tok-p');
  });

  it('ignores blank tokens', () => {
    expect(loadConfig({ VITE_ASHA_TOKEN: '  ' }).personas.asha.token).toBe('dev-asha');
  });

  it('carries the demo script chips', () => {
    const c = loadConfig({});
    expect(c.personas.asha.suggestions).toBe(ASHA_SUGGESTIONS);
    expect(c.personas.priya.suggestions).toBe(PRIYA_SUGGESTIONS);
    expect(ASHA_SUGGESTIONS).toHaveLength(5);
    expect(PRIYA_SUGGESTIONS).toHaveLength(4);
    expect(ASHA_SUGGESTIONS[1]).toMatch(/FTC/);
  });
});

describe('helpers', () => {
  it('normalises hub URLs', () => {
    expect(normaliseHubUrl('http://localhost:8787///')).toBe('http://localhost:8787');
    expect(normaliseHubUrl('ftp://x')).toBe(DEFAULT_HUB_URL);
    expect(normaliseHubUrl('not a url')).toBe(DEFAULT_HUB_URL);
    expect(normaliseHubUrl(undefined)).toBe(DEFAULT_HUB_URL);
  });

  it('masks tokens', () => {
    expect(maskToken('dev-asha')).toBe('dev-a…');
    expect(maskToken('abc')).toBe('•••');
  });

  it('creates distinct session ids', () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it('greets by time of day', () => {
    expect(greetingFor(new Date(2026, 9, 5, 9))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 9, 5, 14))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 9, 5, 20))).toBe('Good evening');
  });
});
