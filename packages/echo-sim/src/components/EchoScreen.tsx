import type { CallToolResult } from '@modelcontextprotocol/client';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { SpeechInput } from '../hooks';
import { useNow } from '../hooks';
import type { BridgeEvent } from '../lib/cardHost';
import { prominentCardIds, type CardSpec } from '../lib/cards';
import { clockTime, formatMs, modelLabel } from '../lib/format';
import type { McpSession } from '../lib/mcpSession';
import { greetingFor, type Persona } from '../lib/personas';
import type { PersonaState, Turn, TurnSource } from '../state';
import { McpAppCard } from './McpAppCard';

export const SIM_LABEL = 'Simulated Alexa+ surface · Kinwise add-on (real MCP server)';

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface DoorbellBanner {
  id: number;
  text: string;
}

interface Props {
  persona: Persona;
  state: PersonaState;
  session: McpSession;
  active: boolean;
  phase: Phase;
  speech: SpeechInput;
  doorbell?: DoorbellBanner | null;
  onSubmit: (text: string, source: TurnSource) => void;
  onHome: () => void;
  onBridgeEvent: (spec: CardSpec, e: BridgeEvent) => void;
  onCardToolResult: (spec: CardSpec, name: string, args: Record<string, unknown>, result: CallToolResult) => void;
  onCardMessage: (spec: CardSpec, text: string) => void;
  onCardClose: (spec: CardSpec) => void;
}

export function EchoScreen(props: Props) {
  const { persona, state, session, active, phase, speech, doorbell } = props;
  const latest = state.turns[0];
  const hasCards = state.cards.length > 0;
  const showHome = state.view === 'home';

  return (
    <div className={`screen phase-${phase}`} hidden={!active} data-persona={persona.id}>
      <StatusBar persona={persona} session={session} showClock={!showHome} onHome={props.onHome} />

      {doorbell && (
        <div className="doorbell-banner" role="alert" key={doorbell.id}>
          <span className="doorbell-icon" aria-hidden="true">
            🔔
          </span>
          <span>{doorbell.text}</span>
        </div>
      )}

      <div className={`screen-body${showHome ? ' is-home' : ''}${hasCards ? ' has-cards' : ''}`}>
        {showHome && <Home persona={persona} hint={persona.suggestions[persona.id === 'asha' ? 2 : 0] ?? ''} />}
        {!showHome && <Conversation turn={latest} phase={phase} interim={active && speech.listening ? speech.interim : ''} />}
        <CardColumn {...props} hidden={showHome || !hasCards} />
      </div>

      <InputBar persona={persona} phase={phase} speech={speech} active={active} onSubmit={props.onSubmit} />
      <div className="light-bar" aria-hidden="true" />
    </div>
  );
}

function StatusBar({ persona, session, showClock, onHome }: { persona: Persona; session: McpSession; showClock: boolean; onHome: () => void }) {
  const now = useNow(1000);
  const status = useSyncExternalStore(session.subscribe, session.getStatus);
  const pill =
    status.state === 'connected'
      ? { cls: 'ok', text: `MCP ${status.protocolVersion ?? ''}`.trim(), title: `Connected to ${status.serverName ?? 'the Kinwise MCP server'} ${status.serverVersion ?? ''} over Streamable HTTP` }
      : status.state === 'error'
        ? { cls: 'warn', text: 'MCP offline · retry', title: status.message }
        : { cls: 'idle', text: 'MCP connecting…', title: 'Connecting to the Kinwise MCP server' };

  return (
    <div className="status-bar">
      <button type="button" className="home-btn" onClick={onHome} aria-label="Home screen">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" fill="currentColor" />
        </svg>
      </button>
      <span className="device-name">{persona.deviceName}</span>
      <span className="status-clock" aria-hidden={!showClock}>
        {showClock ? clockTime(now) : ''}
      </span>
      <span className="status-right">
        <button
          type="button"
          className={`mcp-pill ${pill.cls}`}
          title={pill.title}
          onClick={() => void session.connect().catch(() => undefined)}
          aria-label={`${pill.text}. ${pill.title}`}
        >
          <span className="dot" aria-hidden="true" />
          {pill.text}
        </button>
        <span className="sim-badge">{SIM_LABEL}</span>
      </span>
    </div>
  );
}

function Home({ persona, hint }: { persona: Persona; hint: string }) {
  const now = useNow(1000);
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)$/, '');
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <section className="home" aria-label="Home screen">
      <p className="home-greeting">
        {greetingFor(now)}, {persona.personName}
      </p>
      <p className="home-time">
        {time}
        <span className="home-ampm">{ampm}</span>
      </p>
      <p className="home-date">{date}</p>
      <div className="home-tile">
        <span className="shield" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <path d="M32 6l20 8v15c0 14-9 23-20 28C21 52 12 43 12 29V14z" fill="currentColor" />
            <path d="M23 32l6 6 12-13" stroke="#14261b" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>
          <strong>Kinwise is on</strong>
          <span className="home-tile-sub">{persona.role === 'resident' ? 'Your second opinion — you own every switch.' : 'Signals only. Never recordings or transcripts.'}</span>
        </span>
      </div>
      {hint && <p className="home-hint">Try “{hint}”</p>}
    </section>
  );
}

function sourceLabel(source: TurnSource): string {
  switch (source) {
    case 'voice':
      return 'You said';
    case 'card':
      return 'On the card';
    case 'direct':
      return 'Direct MCP call';
    case 'doorbell':
      return 'Front door';
    default:
      return 'You asked';
  }
}

function Conversation({ turn, phase, interim }: { turn?: Turn; phase: Phase; interim: string }) {
  const listening = phase === 'listening';
  const toolCount = turn?.response?.toolCalls.length ?? 0;
  return (
    <section className="conversation" aria-label="Conversation">
      {listening ? (
        <div className="utterance listening">
          <span className="utterance-label">Listening…</span>
          <p className="utterance-text interim">{interim || ' '}</p>
        </div>
      ) : (
        turn && (
          <div className="utterance">
            <span className="utterance-label">{sourceLabel(turn.source)}</span>
            <p className={`utterance-text${turn.utterance.length > 140 ? ' is-long' : ''}`}>“{turn.utterance}”</p>
          </div>
        )
      )}

      <div className="reply" aria-live="polite" aria-atomic="true">
        {turn?.status === 'pending' && !listening && (
          <p className="thinking">
            <span className="visually-hidden">Alexa is thinking</span>
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
        )}
        {turn?.status === 'done' && turn.reply && <p className={`reply-text${turn.reply.length > 180 ? ' is-long' : ''}`}>{turn.reply}</p>}
        {turn?.status === 'error' && turn.failure && (
          <div className="reply-failure">
            <p className="reply-text">{turn.failure.title}</p>
            <p className="failure-hint">
              <span className="failure-hint-label">For the demo team</span>
              {turn.failure.hint}
            </p>
          </div>
        )}
      </div>

      {turn?.notes?.map((n, i) => (
        <p className="tool-note" key={`${n.toolName}-${i}`}>
          <span className="tool-note-label">Kinwise</span>
          {n.text}
        </p>
      ))}

      {turn?.status === 'done' && turn.response && (
        <p className="reply-meta">
          Answered in {formatMs(turn.clientMs ?? turn.response.latencyMs)} · {toolCount} Kinwise tool{toolCount === 1 ? '' : 's'} via MCP ·{' '}
          {modelLabel(turn.response.model)}
        </p>
      )}
    </section>
  );
}

function CardColumn(props: Props & { hidden: boolean }) {
  const { state, session, hidden } = props;
  const prominent = prominentCardIds(state.cards);
  const colRef = useRef<HTMLDivElement | null>(null);
  const newest = state.cards[0]?.id;
  useEffect(() => {
    colRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [newest]);

  let shownEarlier = false;
  return (
    <div className="card-column" ref={colRef} hidden={hidden} aria-label="Kinwise cards">
      {state.cards.map((spec) => {
        const isProminent = prominent.has(spec.id);
        const divider = !isProminent && !shownEarlier;
        if (divider) shownEarlier = true;
        return (
          <div key={spec.id} className="card-wrap">
            {divider && <p className="earlier-label">Earlier</p>}
            <McpAppCard
              spec={spec}
              session={session}
              prominent={isProminent}
              onBridgeEvent={props.onBridgeEvent}
              onCardToolResult={props.onCardToolResult}
              onMessage={props.onCardMessage}
              onClose={props.onCardClose}
            />
          </div>
        );
      })}
    </div>
  );
}

function InputBar({
  persona,
  phase,
  speech,
  active,
  onSubmit,
}: {
  persona: Persona;
  phase: Phase;
  speech: SpeechInput;
  active: boolean;
  onSubmit: (text: string, source: TurnSource) => void;
}) {
  const [text, setText] = useState('');
  const listening = active && speech.listening;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSubmit(t, 'text');
    setText('');
  };

  return (
    <div className="input-area">
      <div className="chips" role="list" aria-label={`Suggestions for ${persona.personName}`}>
        {persona.suggestions.map((s) => (
          <span role="listitem" key={s}>
            <button type="button" className="chip" title={s} onClick={() => onSubmit(s, 'chip')} disabled={phase === 'thinking'}>
              {s}
            </button>
          </span>
        ))}
      </div>
      <form className="input-bar" onSubmit={submit}>
        <button
          type="button"
          className={`mic${listening ? ' is-listening' : ''}`}
          aria-pressed={listening}
          aria-label={listening ? 'Stop listening' : speech.supported ? 'Start listening' : 'Voice input unavailable in this browser'}
          title={speech.supported ? (listening ? 'Stop listening' : 'Talk to Alexa') : 'Voice input needs Chrome or Edge'}
          disabled={!speech.supported}
          onClick={() => (listening ? speech.stop() : speech.start())}
        >
          <span className="mic-ring" aria-hidden="true" />
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" fill="currentColor" />
            <path d="M18 11a6 6 0 0 1-12 0M12 17v4m-3 0h6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        <label className="visually-hidden" htmlFor={`ask-${persona.id}`}>
          Ask Alexa
        </label>
        <input
          id={`ask-${persona.id}`}
          className="ask-input"
          type="text"
          autoComplete="off"
          placeholder={listening ? 'Listening…' : `Type to ask Alexa, ${persona.personName}…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
        />
        <button type="submit" className="send" disabled={!text.trim()}>
          Ask
        </button>
      </form>
      {active && speech.error && (
        <p className="speech-error" role="status">
          {speech.error}
        </p>
      )}
    </div>
  );
}
