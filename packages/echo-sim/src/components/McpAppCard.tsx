import type { CallToolResult } from '@modelcontextprotocol/client';
import type { McpUiDisplayMode } from '@modelcontextprotocol/ext-apps/app-bridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CardHost, type BridgeEvent, type CardStatus } from '../lib/cardHost';
import { cardTitle, type CardSpec } from '../lib/cards';
import { resultText } from '../lib/concierge';
import { describeMcpError, type McpSession } from '../lib/mcpSession';
import { toolLabel } from '../lib/format';

interface Props {
  spec: CardSpec;
  session: McpSession;
  prominent: boolean;
  onBridgeEvent: (spec: CardSpec, e: BridgeEvent) => void;
  onCardToolResult: (spec: CardSpec, name: string, args: Record<string, unknown>, result: CallToolResult) => void;
  onMessage: (spec: CardSpec, text: string) => void;
  onClose: (spec: CardSpec) => void;
}

const SOURCE_LABEL: Record<CardSpec['source'], string> = {
  concierge: 'via concierge',
  direct: 'direct MCP call',
  doorbell: 'doorbell',
};

/**
 * One MCP Apps card: fetches the ui:// resource with the persona's MCP client,
 * then hosts it in a sandboxed iframe through AppBridge (see lib/cardHost.ts).
 */
export function McpAppCard({ spec, session, prominent, onBridgeEvent, onCardToolResult, onMessage, onClose }: Props) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<CardHost | null>(null);
  const [status, setStatus] = useState<CardStatus>('loading');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<McpUiDisplayMode>('inline');
  const [closing, setClosing] = useState(false);
  const title = cardTitle(spec.uiResourceUri);

  // Keep the latest callbacks without re-creating the iframe.
  const cb = useRef({ onBridgeEvent, onCardToolResult, onMessage });
  useEffect(() => {
    cb.current = { onBridgeEvent, onCardToolResult, onMessage };
  });

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    let cancelled = false;
    let host: CardHost | null = null;
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const [client, html] = await Promise.all([session.getClient(), session.readUiHtml(spec.uiResourceUri)]);
        if (cancelled) return;
        host = new CardHost({
          container: slot,
          html,
          client,
          title: `Kinwise ${title} card (MCP App ${spec.uiResourceUri})`,
          toolName: spec.toolName,
          arguments: spec.arguments,
          result: spec.result,
          onStatus: (s, message) => {
            if (cancelled) return;
            setStatus(s);
            if (message) setError(message);
          },
          onDisplayModeRequest: (m) => {
            setMode(m);
            return m;
          },
          onEvent: (e) => cb.current.onBridgeEvent(spec, e),
          onCardToolResult: (name, args, result) => cb.current.onCardToolResult(spec, name, args, result),
          onMessage: (text) => cb.current.onMessage(spec, text),
        });
        hostRef.current = host;
        await host.start();
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(describeMcpError(err, session.hubUrl));
      }
    })();
    return () => {
      cancelled = true;
      hostRef.current = null;
      void host?.dispose();
    };
  }, [spec, session, title]);

  const setDisplayMode = useCallback((m: McpUiDisplayMode) => {
    setMode(m);
    hostRef.current?.setDisplayMode(m);
  }, []);

  useEffect(() => {
    if (mode !== 'fullscreen') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDisplayMode('inline');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setDisplayMode]);

  const close = async () => {
    setClosing(true);
    await hostRef.current?.dispose({ graceful: true });
    onClose(spec);
  };

  const fallback = resultText(spec.result);

  return (
    <article
      className={`card-shell${prominent ? ' prominent' : ' older'}${mode === 'fullscreen' ? ' is-fullscreen' : ''}${closing ? ' closing' : ''}`}
      aria-label={`${title} card`}
      data-card-uri={spec.uiResourceUri}
      data-card-status={status}
    >
      <header className="card-chrome">
        <span className="card-chip" title="MCP Apps UI resource rendered through AppBridge">
          <span className="dot" aria-hidden="true" /> MCP App
        </span>
        <span className="card-uri">{spec.uiResourceUri}</span>
        <span className="card-tool">
          {toolLabel(spec.toolName)} · {SOURCE_LABEL[spec.source]}
        </span>
        <span className="card-actions">
          {mode === 'fullscreen' ? (
            <button type="button" className="chrome-btn" onClick={() => setDisplayMode('inline')}>
              Exit full screen
            </button>
          ) : (
            <button type="button" className="chrome-btn" onClick={() => setDisplayMode('fullscreen')} aria-label={`Show ${title} full screen`}>
              Expand
            </button>
          )}
          <button type="button" className="chrome-btn icon" onClick={() => void close()} aria-label={`Close ${title} card`}>
            ×
          </button>
        </span>
      </header>
      <div className="card-slot">
        {/* The iframe is appended here imperatively by CardHost; React never renders into this node. */}
        <div className="card-frame-host" ref={slotRef} />
        {status === 'loading' && (
          <div className="card-loading" aria-hidden="true">
            <span className="shimmer" />
          </div>
        )}
      </div>
      {status === 'error' && (
        <div className="card-fallback" role="note">
          <p className="card-fallback-title">{fallback || `The ${title} card couldn't be shown.`}</p>
          {error && <p className="card-fallback-hint">{error}</p>}
        </div>
      )}
    </article>
  );
}
