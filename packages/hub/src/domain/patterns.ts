import type { SignalCategory } from './types.js';

/**
 * Scam warning-sign rules. Patterns run against `normalize()`d text (lowercase,
 * no punctuation, no apostrophes), so "Don't" is matched as "dont" and
 * "pick-up" as "pick up". Keep this list data-only so it can be reviewed and
 * extended without touching the engine. Bump PATTERN_VERSION on any change.
 */
export const PATTERN_VERSION = '2026.10.1';

export interface CategoryRule {
  key: SignalCategory;
  /** Short label for chips on cards, e.g. "Bank or agency". */
  label: string;
  /** One sentence for the resident, in plain language. */
  explanation: string;
  patterns: RegExp[];
}

const w = (source: string) => new RegExp(`\\b(?:${source})\\b`);

export const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    key: 'authority',
    label: 'Bank or agency',
    explanation:
      "They said they're from a bank or the government. Real agencies never ask you to move money over the phone.",
    patterns: [
      w('bank|banks|banker'),
      w('fraud (?:department|dept|team|unit|division)'),
      w('ftc|irs|fbi|dea|ssa|cia'),
      w('federal trade commission|internal revenue service|treasury|customs'),
      w('social security|medicare'),
      w('police|sheriff|detective|officer|marshal|federal agent'),
      w('government|court'),
      w('(?:amazon|microsoft|apple|paypal|visa|mastercard) (?:support|security|account|fraud|team)'),
    ],
  },
  {
    key: 'urgency',
    label: 'Pressure to act now',
    explanation:
      'They said your money is in danger right now. Pressure to act fast is the most common scam warning sign.',
    patterns: [
      w('compromised|hacked|frozen|freeze|suspended|locked out'),
      w('arrest|arrested|warrant|jail|lawsuit|legal action|deported'),
      w('immediately|right away|right now|urgent|urgently|today only|within the hour|before it s too late|before its too late'),
      w('identity (?:theft|stolen)|stolen identity'),
      w('(?:fraudulent|suspicious|unauthorized) (?:activity|charges?|transactions?|purchases?)'),
      w('(?:someone|they) (?:stole|is stealing|are stealing|is using)'),
    ],
  },
  {
    key: 'secrecy',
    label: 'Keep it secret',
    explanation:
      'They told you not to tell anyone. Real banks and agencies never ask you to keep secrets from your family.',
    patterns: [
      w('(?:dont|do not|never|shouldnt|should not|must not|cannot|cant) (?:tell|mention|discuss|talk to|call|contact|let)'),
      w('keep (?:this|it) (?:quiet|secret|confidential|private|between us)'),
      w('between (?:you and me|us)'),
      w('confidential|secret|gag order'),
      w('(?:teller|bank staff|bank employees?) (?:is|are|might be|may be) (?:in on it|involved)'),
    ],
  },
  {
    key: 'unusual_payment',
    label: 'Gold, cash or gift cards',
    explanation:
      'They asked for gold, cash, gift cards or crypto. Real organizations never ask for payment this way.',
    patterns: [
      w('gold|gold bars?|gold coins?|bullion|silver bars?'),
      w('gift ?cards?|(?:itunes|apple|google play|amazon|target|steam|ebay) cards?'),
      w('bitcoin|btc|crypto|cryptocurrency|ethereum|tether|usdt|bitcoin atm'),
      w('wire (?:transfer|the money|it)|western union|moneygram|money order'),
      w('safe account|secure account|protected account'),
      w('(?:withdraw|take out) (?:all|cash|the money|your money|my money|\\d+)'),
      w('cash'),
    ],
  },
  {
    key: 'courier_pickup',
    label: 'Someone coming to collect',
    explanation:
      'Someone is coming to collect something. No bank or agency ever sends a courier to pick up money.',
    patterns: [
      w('couriers?|messengers?'),
      w('(?:someone|somebody|a man|a woman|a driver|an agent|an officer|they|he|she) (?:will|is going to|gonna|would|is coming to|are coming to) (?:come|stop by|pick|collect|get)'),
      w('(?:come|coming|stop) (?:by|over|here|to (?:my|your|the) (?:house|home|door)) (?:to|and) (?:pick|collect|get)'),
      w('(?:pick(?:ing)? ?up|collect(?:ing|ion)?) (?:a |the |my |your |our )?(?:package|money|cash|gold|envelope|box|cards?|payment|parcel)'),
      w('send(?:ing)? (?:a |an )?(?:driver|courier|messenger|agent|officer|someone|somebody)'),
      w('(?:hand|give) (?:it|them|the (?:money|gold|cash|package|envelope|box)) (?:over )?to (?:him|her|them|the (?:driver|courier|agent|man|woman|officer))'),
    ],
  },
  {
    key: 'remote_access',
    label: 'Remote access or codes',
    explanation:
      'They asked for a code or to get into your computer or phone. Never share codes or let strangers into your devices.',
    patterns: [
      w('remote (?:access|desktop|control)'),
      w('anydesk|teamviewer|ultraviewer|logmein|screen ?share|screen sharing'),
      w('(?:download|install) (?:this|an|the|a) (?:app|program|software)'),
      w('(?:read|give|tell) (?:me )?(?:the|your) (?:code|pin|password|otp)'),
      w('verification code|one time (?:code|password)|security code'),
    ],
  },
];

/** Canonical order for categories in results and UI chips. */
export const CATEGORY_ORDER: readonly SignalCategory[] = CATEGORY_RULES.map((r) => r.key);

export function ruleFor(key: SignalCategory): CategoryRule {
  const rule = CATEGORY_RULES.find((r) => r.key === key);
  if (!rule) throw new Error(`Unknown category ${key}`);
  return rule;
}
