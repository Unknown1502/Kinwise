import { pushCards, removeCard, type CardSpec } from './lib/cards';
import type { AskFailure, ConciergeResponse } from './lib/concierge';
import { PERSONA_IDS, newSessionId, type PersonaId } from './lib/personas';

export type TurnSource = 'voice' | 'text' | 'chip' | 'card' | 'direct' | 'doorbell';

export interface Turn {
  id: string;
  persona: PersonaId;
  source: TurnSource;
  utterance: string;
  status: 'pending' | 'done' | 'error';
  at: number;
  reply?: string;
  failure?: AskFailure;
  response?: ConciergeResponse;
  notes?: Array<{ toolName: string; text: string }>;
  clientMs?: number;
}

export interface PersonaState {
  sessionId: string;
  turns: Turn[]; // newest first
  cards: CardSpec[]; // newest first
  view: 'home' | 'conversation';
}

export type SimState = Record<PersonaId, PersonaState>;

export type Action =
  | { type: 'turn-start'; turn: Turn }
  | { type: 'turn-update'; persona: PersonaId; id: string; patch: Partial<Turn> }
  | { type: 'cards-add'; persona: PersonaId; cards: CardSpec[] }
  | { type: 'card-remove'; persona: PersonaId; id: string }
  | { type: 'view'; persona: PersonaId; view: PersonaState['view'] }
  | { type: 'reset-all' };

const MAX_TURNS = 40;

export function initialPersonaState(): PersonaState {
  return { sessionId: newSessionId(), turns: [], cards: [], view: 'home' };
}

export function initialState(): SimState {
  return Object.fromEntries(PERSONA_IDS.map((id) => [id, initialPersonaState()])) as SimState;
}

export function reducer(state: SimState, action: Action): SimState {
  switch (action.type) {
    case 'turn-start': {
      const p = state[action.turn.persona];
      return { ...state, [action.turn.persona]: { ...p, view: 'conversation', turns: [action.turn, ...p.turns].slice(0, MAX_TURNS) } };
    }
    case 'turn-update': {
      const p = state[action.persona];
      return { ...state, [action.persona]: { ...p, turns: p.turns.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)) } };
    }
    case 'cards-add': {
      if (!action.cards.length) return state;
      const p = state[action.persona];
      return { ...state, [action.persona]: { ...p, view: 'conversation', cards: pushCards(p.cards, action.cards).stack } };
    }
    case 'card-remove': {
      const p = state[action.persona];
      return { ...state, [action.persona]: { ...p, cards: removeCard(p.cards, action.id) } };
    }
    case 'view': {
      const p = state[action.persona];
      return { ...state, [action.persona]: { ...p, view: action.view } };
    }
    case 'reset-all':
      return initialState();
    default:
      return state;
  }
}

let turnSeq = 0;
export function turnId(): string {
  turnSeq += 1;
  return `turn-${Date.now().toString(36)}-${turnSeq}`;
}
