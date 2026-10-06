import type { CallToolResult } from '@modelcontextprotocol/client';
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { DemoControls, PhonePanel } from './components/Sidebar';
import { EchoScreen, SIM_LABEL, type DoorbellBanner, type Phase } from './components/EchoScreen';
import { UnderTheHood } from './components/UnderTheHood';
import { useFitScale, useSpeechRecognition } from './hooks';
import type { BridgeEvent } from './lib/cardHost';
import { cardsFromToolCalls, toolErrorNotes, type CardSource, type CardSpec } from './lib/cards';
import { resultText, spokenFailure, toolCallSchema, type ToolCall } from './lib/concierge';
import { prettyJson, toolLabel } from './lib/format';
import { askConcierge, describeDecision, resetDemo, ringDoorbell } from './lib/hubApi';
import { McpSession, describeMcpError } from './lib/mcpSession';
import { PERSONA_IDS, loadConfig, type PersonaId } from './lib/personas';
import { primeVoices, speak, stopSpeaking } from './lib/speech';
import { WireLogStore, nextWireId, type WireEntry } from './lib/wireLog';
import { initialState, reducer, turnId, type Turn, type TurnSource } from './state';

// ── singletons: config, wire log, one real MCP client per persona ──
const config = loadConfig(import.meta.env as unknown as Record<string, string | undefined>);
const wire = new WireLogStore();
const sessions: Record<PersonaId, McpSession> = {
  asha: new McpSession(config.hubUrl, config.personas.asha, wire.upsert),
  priya: new McpSession(config.hubUrl, config.personas.priya, wire.upsert),
};

const SCREEN_W = 1280;
const SCREEN_H = 800;
const BEZEL = 26;

/** Map an AppBridge event to a wire-log row ("card ↔ host" postMessage traffic). */
function bridgeEntry(spec: CardSpec, e: BridgeEvent): WireEntry {
  const base = { id: nextWireId(), persona: spec.persona, kind: 'bridge' as const, at: Date.now(), rpcIds: [], pending: false };
  const card = spec.uiResourceUri.replace('ui://kinwise/', '');
  switch (e.type) {
    case 'initialized':
      return { ...base, verb: 'card → host', rpcMethods: ['ui/initialize', 'ui/notifications/initialized'], detail: `${e.app ?? card} ready` };
    case 'tool-input':
      return { ...base, verb: 'host → card', rpcMethods: ['ui/notifications/tool-input'], detail: `${card} ← ${e.toolName} arguments`, request: spec.arguments };
    case 'tool-result':
      return { ...base, verb: 'host → card', rpcMethods: ['ui/notifications/tool-result'], detail: `${card} ← ${e.toolName} result`, request: spec.result };
    case 'card-tool-call':
      return { ...base, verb: 'card → host', rpcMethods: ['tools/call'], detail: `${e.name} (forwarded to the hub by AppBridge)`, request: e.arguments };
    case 'card-tool-result':
      return {
        ...base,
        verb: 'host → card',
        rpcMethods: ['tools/call result'],
        detail: `${e.name}${e.isError ? ' · isError' : ''}`,
        clientMs: e.ms,
        response: e.result,
      };
    case 'display-mode':
      return { ...base, verb: 'card ↔ host', rpcMethods: ['ui/request-display-mode'], detail: e.mode };
    case 'open-link':
      return { ...base, verb: 'card → host', rpcMethods: ['ui/open-link'], detail: `${e.url}${e.allowed ? '' : ' (blocked)'}` };
    case 'message':
      return { ...base, verb: 'card → host', rpcMethods: ['ui/message'], detail: e.text };
    case 'log':
      return { ...base, verb: 'card → host', rpcMethods: ['notifications/message'], detail: e.level, request: e.data };
    case 'teardown':
      return { ...base, verb: 'card → host', rpcMethods: ['ui/notifications/request-teardown'], detail: card };
  }
}

function actionLabel(name: string, args: Record<string, unknown>): string {
  const action = typeof args.action === 'string' ? ` · ${args.action.replace(/_/g, ' ')}` : '';
  return `${toolLabel(name)}${action}`;
}

/** Normalise an MCP CallToolResult into the ConciergeResponse tool-call shape. */
function asToolCall(name: string, args: Record<string, unknown>, result: CallToolResult, uiResourceUri?: string): ToolCall {
  return toolCallSchema.parse({ name, arguments: args, result, uiResourceUri });
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [active, setActive] = useState<PersonaId>('asha');
  const [speakOn, setSpeakOn] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phases, setPhases] = useState<Record<PersonaId, Phase>>({ asha: 'idle', priya: 'idle' });
  const [doorbell, setDoorbell] = useState<DoorbellBanner | null>(null);
  const fit = useFitScale(SCREEN_W + BEZEL * 2, SCREEN_H + BEZEL * 2, 1.4);

  const stateRef = useRef(state);
  const activeRef = useRef(active);
  const speakRef = useRef(speakOn);
  const aborts = useRef<Partial<Record<PersonaId, AbortController>>>({});
  useEffect(() => {
    stateRef.current = state;
    activeRef.current = active;
    speakRef.current = speakOn;
  });

  const setPhase = useCallback((persona: PersonaId, phase: Phase) => {
    setPhases((p) => (p[persona] === phase ? p : { ...p, [persona]: phase }));
  }, []);

  // Connect both MCP clients up front so cards render instantly and the status pill is live.
  useEffect(() => {
    primeVoices();
    for (const s of Object.values(sessions)) void s.connect().catch(() => undefined);
    const retry = setInterval(() => {
      for (const s of Object.values(sessions)) if (s.getStatus().state === 'error') void s.connect().catch(() => undefined);
    }, 10_000);
    return () => clearInterval(retry);
  }, []);

  /** Alexa speaks (only on the device that is in front of the user). */
  const say = useCallback(
    (persona: PersonaId, text: string) => {
      if (!speakRef.current || persona !== activeRef.current) {
        setPhase(persona, 'idle');
        return;
      }
      speak(text, { onStart: () => setPhase(persona, 'speaking'), onEnd: () => setPhase(persona, 'idle') });
    },
    [setPhase],
  );

  const ask = useCallback(
    async (persona: PersonaId, text: string, source: TurnSource) => {
      const utterance = text.trim();
      if (!utterance) return;
      stopSpeaking();
      aborts.current[persona]?.abort();
      const ctrl = new AbortController();
      aborts.current[persona] = ctrl;

      const id = turnId();
      dispatch({ type: 'turn-start', turn: { id, persona, source, utterance, status: 'pending', at: Date.now() } });
      setPhase(persona, 'thinking');
      const session = sessions[persona];
      void session.connect().catch(() => undefined); // warm the MCP client for the cards

      const out = await askConcierge(config.hubUrl, config.personas[persona].token, utterance, stateRef.current[persona].sessionId, {
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return; // superseded by a newer question
      if (out.ok) {
        const r = out.response;
        const cards = cardsFromToolCalls(r.toolCalls, { persona, source: 'concierge', turnId: id, resolveUri: session.uiUriForTool });
        dispatch({
          type: 'turn-update',
          persona,
          id,
          patch: { status: 'done', reply: r.reply, response: r, notes: toolErrorNotes(r.toolCalls), clientMs: out.clientMs },
        });
        dispatch({ type: 'cards-add', persona, cards });
        say(persona, r.reply);
      } else {
        dispatch({ type: 'turn-update', persona, id, patch: { status: 'error', failure: out.failure } });
        say(persona, spokenFailure(out.failure));
      }
    },
    [say, setPhase],
  );

  const speech = useSpeechRecognition((text) => void ask(activeRef.current, text, 'voice'));

  useEffect(() => {
    if (speech.listening) setPhase(active, 'listening');
    else setPhases((p) => (p[active] === 'listening' ? { ...p, [active]: 'idle' } : p));
  }, [speech.listening, active, setPhase]);

  /** Record a turn that did not come from the concierge (card action, direct call, doorbell). */
  const addLocalTurn = useCallback(
    (persona: PersonaId, source: TurnSource, utterance: string, reply: string, calls: ToolCall[], cardSource?: CardSource): Turn => {
      const id = turnId();
      const turn: Turn = { id, persona, source, utterance, status: 'done', at: Date.now(), reply, notes: toolErrorNotes(calls) };
      dispatch({ type: 'turn-start', turn });
      if (cardSource) {
        const cards = cardsFromToolCalls(calls, { persona, source: cardSource, turnId: id, resolveUri: sessions[persona].uiUriForTool });
        dispatch({ type: 'cards-add', persona, cards });
      }
      return turn;
    },
    [],
  );

  // ── card callbacks ──
  const onBridgeEvent = useCallback((spec: CardSpec, e: BridgeEvent) => wire.upsert(bridgeEntry(spec, e)), []);

  const onCardToolResult = useCallback(
    (spec: CardSpec, name: string, args: Record<string, unknown>, result: CallToolResult) => {
      const text = resultText(result) || (result.isError ? 'That did not work this time.' : 'Done.');
      // The card re-renders itself from the result; Alexa voices the outcome.
      const id = turnId();
      dispatch({
        type: 'turn-start',
        turn: { id, persona: spec.persona, source: 'card', utterance: actionLabel(name, args), status: 'done', at: Date.now(), reply: text },
      });
      say(spec.persona, text);
    },
    [say],
  );

  const onCardMessage = useCallback((spec: CardSpec, text: string) => void ask(spec.persona, text, 'card'), [ask]);
  const onCardClose = useCallback((spec: CardSpec) => dispatch({ type: 'card-remove', persona: spec.persona, id: spec.id }), []);

  // ── dev tools ──
  const runTool = useCallback(
    async (persona: PersonaId, name: string, args: Record<string, unknown>): Promise<string> => {
      const session = sessions[persona];
      try {
        const result = await session.callTool(name, args);
        const uri = session.uiUriForTool(name);
        const call = asToolCall(name, args, result, uri);
        const argText = prettyJson(args).replace(/\s+/g, ' ');
        addLocalTurn(persona, 'direct', `${name} ${argText.length > 120 ? `${argText.slice(0, 120)}…` : argText}`, resultText(result) || '(no text content)', [call], 'direct');
        if (result.isError) return `The tool returned isError: ${resultText(result)}`;
        return uri ? `OK — rendered ${uri} through AppBridge.` : 'OK — this tool has no UI resource.';
      } catch (err) {
        return describeMcpError(err, config.hubUrl);
      }
    },
    [addLocalTurn],
  );

  const onReset = useCallback(async () => {
    const out = await resetDemo(config.hubUrl);
    stopSpeaking();
    for (const c of Object.values(aborts.current)) c?.abort();
    aborts.current = {};
    dispatch({ type: 'reset-all' });
    setPhases({ asha: 'idle', priya: 'idle' });
    setDoorbell(null);
    wire.clear();
    return out.ok ? 'Demo reset: hub reseeded; transcripts, cards and logs cleared.' : `${out.message} Local transcript cleared.`;
  }, []);

  const doorbellTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onRing = useCallback(
    async (personPresent: boolean, showOnEcho: boolean) => {
      const out = await ringDoorbell(config.hubUrl, { personPresent });
      if (!out.ok) return out.message;
      const summary = describeDecision(out.data);
      if (!showOnEcho || !personPresent || !out.data.alertId) return summary;

      // Asha's Echo announces the visitor and shows the alert card, via her own MCP client.
      clearTimeout(doorbellTimer.current);
      setDoorbell({ id: Date.now(), text: 'Someone is at the front door' });
      doorbellTimer.current = setTimeout(() => setDoorbell(null), 9000);
      if (activeRef.current === 'asha' && speakRef.current) speak('Someone is at the front door.');
      try {
        const session = sessions.asha;
        const result = await session.callTool('kinwise_explain_last_alert', {});
        const call = asToolCall('kinwise_explain_last_alert', {}, result, session.uiUriForTool('kinwise_explain_last_alert'));
        addLocalTurn('asha', 'doorbell', 'Someone rang the front doorbell', resultText(result), [call], 'doorbell');
        return `${summary} Shown on Asha's Echo.`;
      } catch (err) {
        return `${summary} (Could not show it on the Echo: ${describeMcpError(err, config.hubUrl)})`;
      }
    },
    [addLocalTurn],
  );

  const switchPersona = (id: PersonaId) => {
    if (id === active) return;
    stopSpeaking();
    speech.stop();
    setActive(id);
  };

  const allTurns = [...state.asha.turns, ...state.priya.turns].sort((a, b) => b.at - a.at);

  return (
    <div className={`page${drawerOpen ? ' drawer-open' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <rect width="64" height="64" rx="14" fill="#14532d" />
              <path d="M32 12l16 6v12c0 11-7 18-16 22-9-4-16-11-16-22V18z" fill="#fef3c7" />
              <path d="M25 33l5 5 10-11" stroke="#14532d" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>
            <span className="brand-name">Kinwise</span>
            <span className="brand-sub">Echo Show simulator</span>
          </span>
        </div>
        <p className="sim-label" role="note">
          {SIM_LABEL}
        </p>
        <fieldset className="persona-switch">
          <legend className="visually-hidden">Device</legend>
          {PERSONA_IDS.map((id) => (
            <label key={id} className={`persona-opt${active === id ? ' is-active' : ''}`}>
              <input type="radio" name="persona" value={id} checked={active === id} onChange={() => switchPersona(id)} />
              <span>{config.personas[id].deviceName}</span>
            </label>
          ))}
        </fieldset>
        <div className="top-actions">
          <label className="switch">
            <input
              type="checkbox"
              checked={speakOn}
              onChange={(e) => {
                setSpeakOn(e.target.checked);
                if (!e.target.checked) stopSpeaking();
              }}
            />
            <span>Speak replies</span>
          </label>
          <button type="button" className="toggle-btn" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((o) => !o)}>
            {drawerOpen ? 'Hide' : 'Show'} under the hood
          </button>
        </div>
      </header>

      <main className="workspace">
        <div className="stage" ref={fit.ref}>
          <div className="device" style={{ '--scale': fit.scale } as CSSProperties} aria-label={`${config.personas[active].deviceName} (simulated)`}>
            <span className="camera" aria-hidden="true" />
            {PERSONA_IDS.map((id) => (
              <EchoScreen
                key={id}
                persona={config.personas[id]}
                state={state[id]}
                session={sessions[id]}
                active={active === id}
                phase={phases[id]}
                speech={speech}
                doorbell={id === 'asha' ? doorbell : null}
                onSubmit={(text, source) => void ask(id, text, source)}
                onHome={() => dispatch({ type: 'view', persona: id, view: 'home' })}
                onBridgeEvent={onBridgeEvent}
                onCardToolResult={onCardToolResult}
                onCardMessage={onCardMessage}
                onCardClose={onCardClose}
              />
            ))}
          </div>
        </div>
        <aside className="sidebar" aria-label="Demo companions">
          <PhonePanel hubUrl={config.hubUrl} />
          <DemoControls onReset={onReset} onRing={onRing} />
        </aside>
      </main>

      <UnderTheHood
        open={drawerOpen}
        personas={config.personas}
        activePersona={active}
        sessions={sessions}
        turns={allTurns}
        wire={wire}
        onRunTool={runTool}
      />
    </div>
  );
}
