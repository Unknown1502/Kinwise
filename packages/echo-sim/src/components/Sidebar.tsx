import { useState } from 'react';
import { useNotices } from '../hooks';
import { clockTime } from '../lib/format';
import { noticeKey, type Notice } from '../lib/hubApi';

const KIND_ICON: Record<string, string> = { pause: '⏸', call_request: '📞', risk_high: '!' };
const KIND_LABEL: Record<string, string> = { pause: 'Pause shown', call_request: 'Call request', risk_high: 'Warning signs' };

/** "Priya's phone": the caregiver's notifications (polls the hub's dev outbox). */
export function PhonePanel({ hubUrl }: { hubUrl: string }) {
  const state = useNotices(hubUrl, 2000);
  if (state?.status === 'unavailable') return null; // dev route absent → hide
  const notices: Notice[] = state?.status === 'ok' ? state.notices : [];
  return (
    <section className="phone" aria-label="Priya's phone (simulated notifications)">
      <div className="phone-notch" aria-hidden="true" />
      <header className="phone-head">
        <span className="phone-title">Priya's phone</span>
        <span className="phone-sub">Kinwise notifications · dev view</span>
      </header>
      <div className="phone-body" aria-live="polite">
        {state === undefined && <p className="phone-empty">Connecting…</p>}
        {state?.status === 'offline' && <p className="phone-empty">Hub offline — notifications will appear when it's back.</p>}
        {state?.status === 'ok' && notices.length === 0 && (
          <p className="phone-empty">No alerts. Kinwise only sends Priya signals — never recordings or transcripts.</p>
        )}
        <ol className="notices">
          {notices.map((n) => (
            <li key={noticeKey(n)} className={`notice kind-${n.kind}`}>
              <div className="notice-top">
                <span className="notice-app">
                  <span className="notice-icon" aria-hidden="true">
                    {KIND_ICON[n.kind] ?? '•'}
                  </span>
                  KINWISE · {KIND_LABEL[n.kind] ?? n.kind}
                </span>
                <time dateTime={n.at}>{Number.isNaN(Date.parse(n.at)) ? '' : clockTime(Date.parse(n.at))}</time>
              </div>
              <p className="notice-title">{n.title}</p>
              {n.body && <p className="notice-body">{n.body}</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

interface DemoProps {
  onReset: () => Promise<string>;
  onRing: (personPresent: boolean, showOnEcho: boolean) => Promise<string>;
}

/** Collapsible dev controls for recording the demo. */
export function DemoControls({ onReset, onRing }: DemoProps) {
  const [personPresent, setPersonPresent] = useState(true);
  const [showOnEcho, setShowOnEcho] = useState(true);
  const [busy, setBusy] = useState<'' | 'reset' | 'ring'>('');
  const [msg, setMsg] = useState('');

  const run = async (kind: 'reset' | 'ring') => {
    setBusy(kind);
    setMsg('');
    try {
      setMsg(kind === 'reset' ? await onReset() : await onRing(personPresent, showOnEcho));
    } finally {
      setBusy('');
    }
  };

  return (
    <details className="demo-controls" open>
      <summary>Demo controls (dev)</summary>
      <div className="demo-body">
        <button type="button" className="small-btn" onClick={() => void run('reset')} disabled={!!busy}>
          {busy === 'reset' ? 'Resetting…' : 'Reset demo'}
        </button>
        <div className="demo-ring">
          <button type="button" className="small-btn primary" onClick={() => void run('ring')} disabled={!!busy}>
            {busy === 'ring' ? 'Ringing…' : '🔔 Ring the doorbell'}
          </button>
          <label className="check">
            <input type="checkbox" checked={personPresent} onChange={(e) => setPersonPresent(e.target.checked)} /> Person visible
          </label>
          <label className="check">
            <input type="checkbox" checked={showOnEcho} onChange={(e) => setShowOnEcho(e.target.checked)} /> Show the alert on Asha's Echo
          </label>
        </div>
        {msg && (
          <p className="demo-msg" role="status">
            {msg}
          </p>
        )}
      </div>
    </details>
  );
}
