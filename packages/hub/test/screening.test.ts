import { describe, expect, it } from 'vitest';
import { levelFor, normalize, screen } from '../src/domain/screening.js';
import type { SignalCategory } from '../src/domain/types.js';

describe('normalize', () => {
  it('lowercases, strips punctuation and apostrophes, collapses whitespace', () => {
    expect(normalize("  Don't TELL your   family!! ")).toBe('dont tell your family');
    expect(normalize('pick-up at 2:00 p.m.')).toBe('pick up at 2 00 p m');
    expect(normalize('“Gift-cards”, please')).toBe('gift cards please');
  });
});

describe('screen — single categories', () => {
  const cases: Array<[string, SignalCategory]> = [
    ['This is the fraud department at your bank', 'authority'],
    ['a man from the FTC called', 'authority'],
    ['Social Security office here', 'authority'],
    ['your account has been compromised', 'urgency'],
    ['there is a warrant for your arrest', 'urgency'],
    ['you must act immediately', 'urgency'],
    ["don't tell your family about this", 'secrecy'],
    ['keep this between us', 'secrecy'],
    ['withdraw it as gold bars', 'unusual_payment'],
    ['buy gift cards at the store', 'unusual_payment'],
    ['put the money in a bitcoin ATM', 'unusual_payment'],
    ['move it to a safe account', 'unusual_payment'],
    ['a courier will come to your house', 'courier_pickup'],
    ['someone will come to collect it', 'courier_pickup'],
    ['they are sending a driver', 'courier_pickup'],
    ['he is picking up the package at 2', 'courier_pickup'],
    ['install AnyDesk so I can help', 'remote_access'],
    ['read me the verification code', 'remote_access'],
  ];
  it.each(cases)('%s → %s', (text, category) => {
    expect(screen(text).categories).toContain(category);
  });

  it('ignores everyday requests', () => {
    for (const text of [
      'remind me to pick up groceries at 5',
      'my daughter is visiting on Sunday',
      'what is the weather today',
      'call Priya',
      'add milk to the shopping list',
    ]) {
      expect(screen(text)).toEqual({ level: 'none', categories: [] });
    }
  });
});

describe('levelFor', () => {
  it('none below two categories', () => {
    expect(levelFor([])).toBe('none');
    expect(levelFor(['authority'])).toBe('none');
    expect(levelFor(['courier_pickup'])).toBe('none');
  });
  it('elevated at exactly two', () => {
    expect(levelFor(['authority', 'urgency'])).toBe('elevated');
    expect(levelFor(['authority', 'courier_pickup'])).toBe('elevated');
  });
  it('high at three or more', () => {
    expect(levelFor(['authority', 'urgency', 'secrecy'])).toBe('high');
  });
  it('high for courier + unusual payment even alone', () => {
    expect(levelFor(['courier_pickup', 'unusual_payment'])).toBe('high');
  });
});

describe('screen — the hero scenario', () => {
  it('flags a courier reminder from "the bank" as elevated', () => {
    const r = screen('Courier from the bank picking up a package at 2 p.m.');
    expect(r.level).toBe('elevated');
    expect(r.categories.sort()).toEqual(['authority', 'courier_pickup']);
  });

  it('flags the full courier-scam script as high', () => {
    const r = screen(
      "A man from the FTC said my accounts are compromised, I should withdraw it as gold, a courier will come, and I shouldn't tell my family.",
    );
    expect(r.level).toBe('high');
    expect(r.categories.sort()).toEqual(
      ['authority', 'courier_pickup', 'secrecy', 'unusual_payment', 'urgency'].sort(),
    );
  });

  it('returns categories in a stable canonical order without duplicates', () => {
    const r = screen('bank bank BANK fraud department, gold gold, courier courier');
    expect(r.categories).toEqual(['authority', 'unusual_payment', 'courier_pickup']);
  });
});
