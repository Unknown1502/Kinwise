/**
 * MCP Apps card model and selection logic (pure, unit-tested).
 *
 * A card is one tool call whose tool declares an MCP Apps UI resource
 * (`ui://kinwise/...`). The Echo screen shows the newest one or two cards
 * prominently; older cards scroll away and the oldest are torn down.
 */
import type { ToolCall, ToolResult } from './concierge';
import type { PersonaId } from './personas';

export type CardSource = 'concierge' | 'direct' | 'doorbell';

export interface CardSpec {
  id: string;
  persona: PersonaId;
  source: CardSource;
  turnId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: ToolResult;
  uiResourceUri: string;
  createdAt: number;
}

/** How many cards stay alive per persona (each is an iframe + AppBridge). */
export const MAX_LIVE_CARDS = 6;
/** How many of the newest cards are shown prominently. */
export const PROMINENT_CARDS = 2;

export function isUiResourceUri(uri: unknown): uri is string {
  return typeof uri === 'string' && /^ui:\/\/[^\s]+$/.test(uri);
}

let seq = 0;
function cardId(): string {
  seq += 1;
  return `card-${Date.now().toString(36)}-${seq}`;
}

export interface CardContext {
  persona: PersonaId;
  source: CardSource;
  turnId: string;
  now?: number;
  /** Fallback when the tool call has no uiResourceUri: look it up from the tool's `_meta.ui`. */
  resolveUri?: (toolName: string) => string | undefined;
}

/**
 * Turn the tool calls of one turn into cards:
 * - only calls with a `ui://` resource (given, or resolved from tool metadata);
 * - error results get no card (the host shows the tool's text calmly instead);
 * - one card per UI resource per turn: the last call wins (it is the freshest view).
 */
export function cardsFromToolCalls(toolCalls: ToolCall[], ctx: CardContext): CardSpec[] {
  const byUri = new Map<string, CardSpec>();
  const now = ctx.now ?? Date.now();
  toolCalls.forEach((call, i) => {
    if (call.result?.isError) return;
    const uri = isUiResourceUri(call.uiResourceUri) ? call.uiResourceUri : ctx.resolveUri?.(call.name);
    if (!isUiResourceUri(uri)) return;
    byUri.delete(uri); // re-insert so Map order follows the last call
    byUri.set(uri, {
      id: cardId(),
      persona: ctx.persona,
      source: ctx.source,
      turnId: ctx.turnId,
      toolName: call.name,
      arguments: call.arguments ?? {},
      result: call.result ?? {},
      uiResourceUri: uri,
      createdAt: now + i,
    });
  });
  return [...byUri.values()];
}

/** The tool results of a turn that failed (isError), as calm notes. */
export function toolErrorNotes(toolCalls: ToolCall[]): Array<{ toolName: string; text: string }> {
  return toolCalls
    .filter((c) => c.result?.isError)
    .map((c) => ({
      toolName: c.name,
      text:
        (c.result.content ?? [])
          .map((b) => (b.type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
          .join(' ')
          .trim() || 'That did not work this time.',
    }));
}

/**
 * Add a turn's cards to a persona's stack (newest first) and cap it.
 * Returns the new stack and the cards that fell off (to be torn down).
 */
export function pushCards(stack: CardSpec[], incoming: CardSpec[], max = MAX_LIVE_CARDS): { stack: CardSpec[]; evicted: CardSpec[] } {
  // Incoming is in call order; newest-first means the last call ends up on top.
  const merged = [...[...incoming].reverse(), ...stack];
  return { stack: merged.slice(0, max), evicted: merged.slice(max) };
}

export function removeCard(stack: CardSpec[], id: string): CardSpec[] {
  return stack.filter((c) => c.id !== id);
}

/** Ids of the cards to show prominently: the newest turn's cards, at most `n`. */
export function prominentCardIds(stack: CardSpec[], n = PROMINENT_CARDS): Set<string> {
  if (!stack.length) return new Set();
  const newestTurn = stack[0]!.turnId;
  const ids = stack.filter((c) => c.turnId === newestTurn).slice(0, n).map((c) => c.id);
  return new Set(ids);
}

/** A friendly label for a card's header strip. */
export function cardTitle(uri: string): string {
  const name = uri.replace(/^ui:\/\/[^/]+\//, '');
  switch (name) {
    case 'screening':
      return 'Second opinion';
    case 'today':
      return 'Today at home';
    case 'pause':
      return 'The Pause';
    case 'timeline':
      return 'Day timeline';
    default:
      return name || uri;
  }
}
