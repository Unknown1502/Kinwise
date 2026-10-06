/** Persona + environment configuration for the simulator (pure, unit-tested). */

export type PersonaId = 'asha' | 'priya';

export interface Persona {
  id: PersonaId;
  /** The name of the simulated device, shown in the switcher and status bar. */
  deviceName: string;
  /** The person using it. */
  personName: string;
  role: 'resident' | 'caregiver';
  /** Bearer token sent to the hub (dev token in AUTH_MODE=dev). */
  token: string;
  /** Demo-script suggestion chips. */
  suggestions: string[];
}

export interface SimConfig {
  hubUrl: string;
  personas: Record<PersonaId, Persona>;
}

export const PERSONA_IDS: readonly PersonaId[] = ['asha', 'priya'];

export const DEFAULT_HUB_URL = 'http://localhost:8787';

export const ASHA_SUGGESTIONS = [
  'Remind me at 2 PM: courier from the bank is picking up a package',
  "A man from the FTC called. He said my accounts are compromised, I should withdraw my savings as gold, a courier will come, and I shouldn't tell my family. Is that real?",
  "What's happening today?",
  'Why did my TV pause?',
  'Give me an hour of privacy',
];

export const PRIYA_SUGGESTIONS = [
  "How's Mom's day going?",
  'Why did Kinwise alert?',
  'Add Maria the nurse on Tuesday from 2 to 3 PM as an expected visitor',
  'Send Mom a message: Dinner Sunday? ❤️',
];

type EnvLike = Record<string, string | boolean | undefined>;

function str(env: EnvLike, key: string, fallback: string): string {
  const v = env[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

/** Normalise a hub base URL: trim, drop trailing slashes, require http(s). */
export function normaliseHubUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return DEFAULT_HUB_URL;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_HUB_URL;
    return value;
  } catch {
    return DEFAULT_HUB_URL;
  }
}

export function loadConfig(env: EnvLike): SimConfig {
  return {
    hubUrl: normaliseHubUrl(typeof env.VITE_HUB_URL === 'string' ? env.VITE_HUB_URL : undefined),
    personas: {
      asha: {
        id: 'asha',
        deviceName: "Asha's kitchen Echo Show",
        personName: 'Asha',
        role: 'resident',
        token: str(env, 'VITE_ASHA_TOKEN', 'dev-asha'),
        suggestions: ASHA_SUGGESTIONS,
      },
      priya: {
        id: 'priya',
        deviceName: "Priya's Echo Show",
        personName: 'Priya',
        role: 'caregiver',
        token: str(env, 'VITE_PRIYA_TOKEN', 'dev-priya'),
        suggestions: PRIYA_SUGGESTIONS,
      },
    },
  };
}

/** Mask a bearer token for display in the wire log ("dev-asha" → "dev-a…"). */
export function maskToken(token: string): string {
  if (token.length <= 6) return '•'.repeat(token.length);
  return `${token.slice(0, 5)}…`;
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for very old engines; not security-sensitive.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
