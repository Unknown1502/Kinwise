import { useEffect, useState } from 'react';
import { useNotices } from '../hooks';
import { clockTime } from '../lib/format';
import { confirmCall, loadContacts, noticeKey, saveContacts, type Notice } from '../lib/hubApi';

const KIND_ICON: Record<string, string> = { pause: '⏸', call_request: '📞', risk_high: '!' };
const KIND_LABEL: Record<string, string> = { pause: 'Pause shown', call_request: 'Call request', risk_high: 'Warning signs' };

/** "Meera's phone": the caregiver's notifications (polls the hub's dev outbox). */
export function PhonePanel({ hubUrl, token }: { hubUrl: string; token?: string }) {
  const state = useNotices(hubUrl, token, 2000);
  const [confirmed, setConfirmed] = useState<Record<string, 'done' | string>>({});
  const confirm = async (callId: string) => {
    const out = await confirmCall(hubUrl, callId, undefined, token);
    setConfirmed((c) => ({ ...c, [callId]: out.ok ? 'done' : out.message }));
  };
  if (state?.status === 'unavailable') return null; // dev route absent → hide
  const notices: Notice[] = state?.status === 'ok' ? state.notices : [];
  return (
    <section className="phone" aria-label="Meera's phone (simulated notifications)">
      <div className="phone-notch" aria-hidden="true" />
      <header className="phone-head">
        <span className="phone-title">Meera's phone</span>
        <span className="phone-sub">Kinwise notifications · dev view</span>
      </header>
      <div className="phone-body" aria-live="polite">
        {state === undefined && <p className="phone-empty">Connecting…</p>}
        {state?.status === 'offline' && <p className="phone-empty">Hub offline — notifications will appear when it's back.</p>}
        {state?.status === 'ok' && notices.length === 0 && (
          <p className="phone-empty">No alerts. Kinwise only sends Meera signals — never recordings or transcripts.</p>
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
              {n.callId && (
                <div className="notice-actions">
                  {confirmed[n.callId] === 'done' ? (
                    <span className="notice-done">✓ Asha's TV now says you're calling</span>
                  ) : (
                    <button type="button" className="notice-button" onClick={() => void confirm(n.callId!)}>
                      I'm calling now
                    </button>
                  )}
                  {confirmed[n.callId] && confirmed[n.callId] !== 'done' && <span className="notice-error">{confirmed[n.callId]}</span>}
                </div>
              )}
            </li>
          ))}
        </ol>
        <ContactsForm hubUrl={hubUrl} token={token} />
      </div>
    </section>
  );
}

/** Where Kinwise reaches Meera: her own e-mail, SMS and WhatsApp number (E.164). */
function ContactsForm({ hubUrl, token }: { hubUrl: string; token?: string }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({ email: '', sms: '', whatsapp: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!open) return;
    void loadContacts(hubUrl, undefined, token).then((out) => {
      if (out.ok) setVals({ email: out.data.email ?? '', sms: out.data.sms ?? '', whatsapp: out.data.whatsapp ?? '' });
    });
  }, [open, hubUrl, token]);
  const save = async () => {
    setMsg('Saving…');
    const out = await saveContacts(hubUrl, vals, undefined, token);
    if (!out.ok) return setMsg(out.message);
    setMsg(out.data.email === 'confirmation_sent' ? 'Saved. Check your e-mail for AWS’s “Confirm subscription” message.' : out.data.email === 'failed' ? 'Saved your numbers, but the e-mail could not be set up.' : 'Saved.');
  };
  return (
    <details className="contacts" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Where should Kinwise reach Meera?</summary>
      {(['email', 'sms', 'whatsapp'] as const).map((k) => (
        <label key={k} className="contact-row">
          <span>{k === 'email' ? 'E-mail' : k === 'sms' ? 'SMS number' : 'WhatsApp number'}</span>
          <input
            value={vals[k]}
            onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
            placeholder={k === 'email' ? 'meera@example.com' : '+919876543210'}
            inputMode={k === 'email' ? 'email' : 'tel'}
            autoComplete="off"
          />
        </label>
      ))}
      <button type="button" className="notice-button" onClick={() => void save()}>
        Save
      </button>
      {msg && <p className="contact-msg" role="status">{msg}</p>}
    </details>
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
