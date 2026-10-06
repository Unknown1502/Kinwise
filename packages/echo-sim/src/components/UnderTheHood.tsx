import type { Tool } from '@modelcontextprotocol/client';
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { formatMs, logTime, modelLabel, prettyJson, sampleArgs } from '../lib/format';
import type { McpSession } from '../lib/mcpSession';
import type { Persona, PersonaId } from '../lib/personas';
import type { WireEntry, WireLogStore } from '../lib/wireLog';
import type { Turn } from '../state';

type Tab = 'concierge' | 'wire' | 'run';

interface Props {
  open: boolean;
  personas: Record<PersonaId, Persona>;
  activePersona: PersonaId;
  sessions: Record<PersonaId, McpSession>;
  turns: Turn[];
  wire: WireLogStore;
  onRunTool: (persona: PersonaId, name: string, args: Record<string, unknown>) => Promise<string>;
}

export function UnderTheHood({ open, personas, activePersona, sessions, turns, wire, onRunTool }: Props) {
  const [tab, setTab] = useState<Tab>('concierge');
  if (!open) return null;
  const tabs: Array<[Tab, string]> = [
    ['concierge', 'Concierge tool calls'],
    ['wire', 'MCP wire traffic'],
    ['run', 'Run a tool directly'],
  ];
  return (
    <section className="drawer" aria-label="Under the hood">
      <div className="drawer-head">
        <h2>Under the hood</h2>
        <div className="tabs" role="tablist" aria-label="Under the hood views">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              className={`tab${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <ProtocolSummary personas={personas} sessions={sessions} />
      </div>
      <div className="drawer-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'concierge' && <ConciergeLog turns={turns} personas={personas} />}
        {tab === 'wire' && <WireLog wire={wire} personas={personas} />}
        {tab === 'run' && <RunTool persona={personas[activePersona]} session={sessions[activePersona]} onRunTool={onRunTool} />}
      </div>
    </section>
  );
}

function ProtocolSummary({ personas, sessions }: { personas: Record<PersonaId, Persona>; sessions: Record<PersonaId, McpSession> }) {
  return (
    <div className="protocol-summary">
      {(Object.keys(sessions) as PersonaId[]).map((id) => (
        <SessionBadge key={id} persona={personas[id]} session={sessions[id]} />
      ))}
    </div>
  );
}

function SessionBadge({ persona, session }: { persona: Persona; session: McpSession }) {
  const s = useSyncExternalStore(session.subscribe, session.getStatus);
  return (
    <span className={`session-badge ${s.state}`} title={s.state === 'error' ? s.message : undefined}>
      <b>{persona.personName}</b>{' '}
      {s.state === 'connected'
        ? `protocol ${s.protocolVersion ?? '?'} · ${s.serverName ?? 'server'} ${s.serverVersion ?? ''} · ${s.toolCount ?? '…'} tools`
        : s.state === 'error'
          ? 'not connected'
          : 'connecting…'}
    </span>
  );
}

function ConciergeLog({ turns, personas }: { turns: Turn[]; personas: Record<PersonaId, Persona> }) {
  if (!turns.length) {
    return <p className="empty">No turns yet. Ask something on the Echo — the concierge's MCP tool calls appear here.</p>;
  }
  return (
    <ol className="log-list">
      {turns.map((t) => (
        <li key={t.id} className={`log-item status-${t.status}`}>
          <details>
            <summary>
              <span className="log-time">{logTime(t.at)}</span>
              <span className={`persona-tag ${t.persona}`}>{personas[t.persona].personName}</span>
              <span className="log-main">“{t.utterance}”</span>
              <span className="log-meta">
                {t.status === 'pending'
                  ? 'waiting…'
                  : t.status === 'error'
                    ? (t.failure?.kind ?? 'error')
                    : t.response
                      ? `${t.response.toolCalls.length} tool call${t.response.toolCalls.length === 1 ? '' : 's'} · ${formatMs(t.response.latencyMs)} · ${modelLabel(t.response.model)}`
                      : t.source}
              </span>
            </summary>
            {t.failure && (
              <p className="log-failure">
                {t.failure.title} — {t.failure.hint}
              </p>
            )}
            {t.response && (
              <div className="log-detail">
                <p className="kv">
                  <span>model</span> <code>{t.response.model}</code> <span>agent latency</span> <code>{formatMs(t.response.latencyMs)}</code>{' '}
                  <span>round trip</span> <code>{formatMs(t.clientMs)}</code> <span>session</span> <code>{t.response.sessionId || '—'}</code>
                </p>
                {t.response.toolCalls.length === 0 && <p className="empty">No tools were called for this turn.</p>}
                {t.response.toolCalls.map((c, i) => (
                  <div className={`tool-call${c.result.isError ? ' is-error' : ''}`} key={`${c.name}-${i}`}>
                    <p className="tool-call-head">
                      <code className="tool-name">{c.name}</code>
                      {c.uiResourceUri && <code className="tool-ui">{c.uiResourceUri}</code>}
                      <span className="tool-lat">{formatMs(c.latencyMs)}</span>
                      {c.result.isError && <span className="tool-err">isError</span>}
                    </p>
                    <div className="json-pair">
                      <div>
                        <span className="json-label">arguments</span>
                        <pre>{prettyJson(c.arguments)}</pre>
                      </div>
                      <div>
                        <span className="json-label">result</span>
                        <pre>{prettyJson(c.result)}</pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!t.response && t.reply && <p className="log-failure">{t.reply}</p>}
          </details>
        </li>
      ))}
    </ol>
  );
}

function WireLog({ wire, personas }: { wire: WireLogStore; personas: Record<PersonaId, Persona> }) {
  const entries = useSyncExternalStore(wire.subscribe, wire.getSnapshot);
  const [filter, setFilter] = useState<'all' | PersonaId>('all');
  const shown = useMemo(() => (filter === 'all' ? entries : entries.filter((e) => e.persona === filter)), [entries, filter]);
  return (
    <div>
      <div className="wire-toolbar">
        <label>
          Show{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | PersonaId)}>
            <option value="all">both devices</option>
            {(Object.keys(personas) as PersonaId[]).map((id) => (
              <option value={id} key={id}>
                {personas[id].deviceName}
              </option>
            ))}
          </select>
        </label>
        <span className="wire-note">
          This simulator's own MCP client (Streamable HTTP) and its AppBridge ↔ card postMessage traffic. Newest first.
        </span>
        <button type="button" className="small-btn" onClick={wire.clear}>
          Clear
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="empty">No traffic yet.</p>
      ) : (
        <ol className="log-list wire">
          {shown.map((e) => (
            <WireRow key={e.id} e={e} personas={personas} />
          ))}
        </ol>
      )}
    </div>
  );
}

function WireRow({ e, personas }: { e: WireEntry; personas: Record<PersonaId, Persona> }) {
  const failed = !!e.error || (e.status !== undefined && e.status >= 400 && !(e.verb === 'GET' && e.status === 405));
  return (
    <li className={`log-item${e.kind === 'bridge' ? ' bridge' : ''}${failed ? ' status-error' : ''}`}>
      <details>
        <summary>
          <span className="log-time">{logTime(e.at)}</span>
          <span className={`persona-tag ${e.persona}`}>{personas[e.persona].personName}</span>
          <span className="verb">{e.verb}</span>
          <span className="log-main">
            <code>{e.rpcMethods.join(', ') || '(no JSON-RPC body)'}</code>
            {e.detail && <span className="detail"> {e.detail}</span>}
          </span>
          <span className="log-meta">
            {e.pending ? 'pending…' : e.error ? `failed: ${e.error}` : e.status !== undefined ? `HTTP ${e.status}` : ''}
            {e.serverTimingMs !== undefined && ` · hub ${formatMs(e.serverTimingMs)}`}
            {e.clientMs !== undefined && ` · rtt ${formatMs(e.clientMs)}`}
          </span>
        </summary>
        <div className="log-detail">
          {e.note && <p className="kv">{e.note}</p>}
          {e.requestHeaders && (
            <p className="kv">
              {Object.entries(e.requestHeaders).map(([k, v]) => (
                <span key={k} className="hdr">
                  <span>{k}</span> <code>{v}</code>
                </span>
              ))}
            </p>
          )}
          <div className="json-pair">
            <div>
              <span className="json-label">{e.kind === 'bridge' ? 'message' : 'request'}</span>
              <pre>{prettyJson(e.request)}</pre>
            </div>
            <div>
              <span className="json-label">response</span>
              <pre>{prettyJson(e.response)}</pre>
            </div>
          </div>
        </div>
      </details>
    </li>
  );
}

function RunTool({
  persona,
  session,
  onRunTool,
}: {
  persona: Persona;
  session: McpSession;
  onRunTool: (persona: PersonaId, name: string, args: Record<string, unknown>) => Promise<string>;
}) {
  const [tools, setTools] = useState<Tool[]>(() => session.listCachedTools());
  const [name, setName] = useState('');
  const [args, setArgs] = useState('{}');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');

  useEffect(() => {
    let alive = true;
    session
      .refreshTools()
      .then((t) => {
        if (!alive) return;
        setTools(t);
        setName((n) => (n && t.some((x) => x.name === n) ? n : (t.find((x) => x.name === 'kinwise_get_today')?.name ?? t[0]?.name ?? '')));
      })
      .catch(() => {
        if (alive) setOut(`Could not list tools: ${session.getStatus().state === 'error' ? (session.getStatus() as { message: string }).message : 'MCP not connected'}`);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  useEffect(() => {
    if (name) setArgs(JSON.stringify(sampleArgs(name), null, 2));
  }, [name]);

  const tool = tools.find((t) => t.name === name);
  const uiUri = name ? session.uiUriForTool(name) : undefined;

  const run = async (e: FormEvent) => {
    e.preventDefault();
    let parsed: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(args || '{}');
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Arguments must be a JSON object');
      parsed = v as Record<string, unknown>;
    } catch (err) {
      setOut(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setBusy(true);
    setOut('');
    try {
      setOut(await onRunTool(persona.id, name, parsed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="run-tool" onSubmit={run}>
      <p className="wire-note">
        Dev aid: calls a tool with <b>{persona.deviceName}</b>'s own MCP client (no concierge) and renders its MCP Apps card exactly like a concierge tool call.
      </p>
      <div className="run-row">
        <label>
          Tool{' '}
          <select value={name} onChange={(e) => setName(e.target.value)} disabled={!tools.length}>
            {tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <span className="run-meta">
          {tool?.annotations?.readOnlyHint ? 'read-only' : tool ? 'writes' : ''}
          {uiUri ? ` · UI ${uiUri}` : tool ? ' · no UI' : ''}
        </span>
        <button type="submit" className="small-btn primary" disabled={!name || busy}>
          {busy ? 'Running…' : 'Run tool'}
        </button>
      </div>
      {tool?.description && <p className="run-desc">{tool.description}</p>}
      <label className="run-args">
        <span>Arguments (JSON)</span>
        <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={5} spellCheck={false} />
      </label>
      {out && (
        <p className="run-out" role="status">
          {out}
        </p>
      )}
    </form>
  );
}
