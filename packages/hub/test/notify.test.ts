import { describe, expect, it } from 'vitest';
import { loadConfig, parseWhatsApp } from '../src/config.js';
import { ackKey, signAck, verifyAck } from '../src/services/ackLink.js';
import { MultiNotifier, NtfyNotifier, OutboxNotifier, SnsNotifier, WhatsAppNotifier, type CaregiverNotice, type Notifier } from '../src/services/notifier.js';

const notice = (over: Partial<CaregiverNotice> = {}): CaregiverNotice => ({
  householdId: 'hh-asha',
  caregiverId: 'priya',
  caregiverName: 'Meera',
  kind: 'call_request',
  title: 'Asha wants to talk to you now',
  body: 'Asha chose "Call Meera" on the TV during a Kinwise Pause. Please call now.',
  at: '2026-10-13T14:00:00.000Z',
  callId: 'call_1',
  ...over,
});

type Sent = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
function fakeFetch(status = 200) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response('{}', { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

describe('NtfyNotifier (phone push)', () => {
  const topic = 'kw-test-topic-0123456789';

  it('sends an urgent push with a tap-to-confirm button, and nothing but the signal', async () => {
    const { sent, fetch } = fakeFetch();
    const ntfy = new NtfyNotifier({ server: 'https://ntfy.example', topic, ackUrl: (n) => `https://hub.example/ack/${n.callId}`, fetch });
    expect(await ntfy.notify(notice())).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://ntfy.example');
    expect(sent[0]!.body).toMatchObject({
      topic,
      title: 'Asha wants to talk to you now',
      priority: 5,
      actions: [{ action: 'http', label: "I'm calling now", url: 'https://hub.example/ack/call_1', method: 'POST' }],
    });
    expect(String(sent[0]!.body.message)).toContain('Please call now');
  });

  it('is high priority, not urgent, for a Pause or a warning, and has no button without a call to confirm', async () => {
    const { sent, fetch } = fakeFetch();
    const ntfy = new NtfyNotifier({ server: 'https://ntfy.example', topic, ackUrl: () => undefined, fetch });
    await ntfy.notify(notice({ kind: 'pause', callId: undefined }));
    await ntfy.notify(notice({ kind: 'risk_high', callId: undefined }));
    expect(sent.map((s) => s.body.priority)).toEqual([4, 4]);
    expect(sent.every((s) => s.body.actions === undefined)).toBe(true);
  });

  it('reports failure (false) when the push service refuses or is unreachable', async () => {
    const refused = new NtfyNotifier({ server: 'https://ntfy.example', topic, ackUrl: () => undefined, fetch: fakeFetch(429).fetch });
    expect(await refused.notify(notice())).toBe(false);
    const down = new NtfyNotifier({
      server: 'https://ntfy.example',
      topic,
      ackUrl: () => undefined,
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof globalThis.fetch,
    });
    expect(await down.notify(notice())).toBe(false);
  });
});

describe('MultiNotifier: "delivered" means a real channel got it', () => {
  const ok: Notifier = { notify: async () => true };
  const no: Notifier = { notify: async () => false };
  const boom: Notifier = {
    notify: async () => {
      throw new Error('boom');
    },
  };
  const quiet = new OutboxNotifier(() => {});
  const silenced = () => {
    const orig = console.error;
    console.error = () => {};
    return () => (console.error = orig);
  };

  it('is delivered when any real channel succeeds, even if another fails', async () => {
    const restore = silenced();
    expect(await new MultiNotifier([quiet, boom, ok]).notify(notice())).toBe(true);
    restore();
  });

  it('is NOT delivered when only the simulated phone got it but a real channel failed', async () => {
    const restore = silenced();
    expect(await new MultiNotifier([quiet, no]).notify(notice())).toBe(false);
    expect(await new MultiNotifier([quiet, boom]).notify(notice())).toBe(false);
    restore();
  });

  it('counts the simulated phone only when it is the only channel (the local demo)', async () => {
    expect(await new MultiNotifier([quiet]).notify(notice())).toBe(true);
  });
});

describe('signed confirm links', () => {
  const key = ackKey('test-secret');
  const now = Date.parse('2026-10-13T14:00:00Z');

  it('round-trips household and call, and expires', () => {
    const token = signAck(key, { householdId: 'hh-asha', callId: 'call_1' }, now);
    expect(verifyAck(key, token, now + 60_000)).toEqual({ householdId: 'hh-asha', callId: 'call_1' });
    expect(verifyAck(key, token, now + 61 * 60_000)).toBeUndefined();
  });

  it('rejects a link signed with another key, edited, or cut short', () => {
    const token = signAck(key, { householdId: 'hh-asha', callId: 'call_1' }, now);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ h: 'hh-other', k: 'call_1', e: now / 1000 + 600 })).toString('base64url');
    expect(verifyAck(ackKey('other'), token, now)).toBeUndefined();
    expect(verifyAck(key, `${forged}.${sig}`, now)).toBeUndefined();
    expect(verifyAck(key, payload!, now)).toBeUndefined();
    expect(verifyAck(key, `${token}.x`, now)).toBeUndefined();
  });

  it('is not interchangeable with a speech link', async () => {
    const { speechKey, signSpeech } = await import('../src/speech/speech.js');
    expect(verifyAck(ackKey('s'), signSpeech(speechKey('s'), 'hi', now), now)).toBeUndefined();
  });
});

describe('config: NTFY_TOPIC is a password', () => {
  const env = (extra: Record<string, string>) => ({ AUTH_MODE: 'dev', STORE: 'memory', ...extra }) as NodeJS.ProcessEnv;

  it('is off by default and read from the environment', () => {
    expect(loadConfig(env({})).ntfy).toBeUndefined();
    expect(loadConfig(env({ NTFY_TOPIC: 'kw-a1b2c3d4e5f6a7b8' })).ntfy).toEqual({ server: 'https://ntfy.sh', topic: 'kw-a1b2c3d4e5f6a7b8' });
    expect(loadConfig(env({ NTFY_TOPIC: 'kw-a1b2c3d4e5f6a7b8', NTFY_SERVER: 'https://push.example.org/' })).ntfy?.server).toBe('https://push.example.org');
  });

  it('refuses a guessable topic or a non-https server', () => {
    expect(() => loadConfig(env({ NTFY_TOPIC: 'meera' }))).toThrow(/NTFY_TOPIC/);
    expect(() => loadConfig(env({ NTFY_TOPIC: 'kw-a1b2c3d4e5f6a7b8', NTFY_SERVER: 'http://push.example.org' }))).toThrow(/NTFY_SERVER/);
  });
});

describe('WhatsAppNotifier (Twilio)', () => {
  const creds = { accountSid: 'AC' + 'a1'.repeat(16), authToken: 'tok-secret-value', from: 'whatsapp:+14155238886', to: 'whatsapp:+919876543210' };
  type Call = { url: string; form: URLSearchParams; auth: string };
  function twilio(status: number, body: unknown = { sid: 'SM1' }) {
    const calls: Call[] = [];
    const fetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, form: new URLSearchParams(init.body), auth: init.headers.authorization! });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetch };
  }

  it('sends the call request as a WhatsApp message with the tap-to-confirm link', async () => {
    const { calls, fetch } = twilio(201);
    const wa = new WhatsAppNotifier({ ...creds, ackUrl: (n) => `https://hub.example/ack/${n.callId}`, fetch });
    expect(await wa.notify(notice())).toBe(true);
    expect(calls[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`);
    expect(calls[0]!.auth).toBe('Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64'));
    expect(calls[0]!.form.get('From')).toBe(creds.from);
    expect(calls[0]!.form.get('To')).toBe(creds.to);
    const text = calls[0]!.form.get('Body')!;
    expect(text).toContain('Asha wants to talk to you now');
    expect(text).toContain('https://hub.example/ack/call_1');
  });

  it('has no link on a Pause or a warning', async () => {
    const { calls, fetch } = twilio(201);
    const wa = new WhatsAppNotifier({ ...creds, ackUrl: () => 'https://hub.example/ack/x', fetch });
    await wa.notify(notice({ kind: 'pause', callId: undefined }));
    expect(calls[0]!.form.get('Body')).not.toContain('https://');
  });

  it('returns false and logs only the Twilio error code, never the number or the token', async () => {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(' '));
    const { fetch } = twilio(400, { code: 63016, message: 'Outside the allowed window' });
    const wa = new WhatsAppNotifier({ ...creds, ackUrl: () => undefined, fetch });
    expect(await wa.notify(notice())).toBe(false);
    const down = new WhatsAppNotifier({ ...creds, ackUrl: () => undefined, fetch: (async () => { throw new Error('offline'); }) as unknown as typeof globalThis.fetch });
    expect(await down.notify(notice())).toBe(false);
    console.error = orig;
    const all = logged.join('\n');
    expect(all).toContain('63016');
    expect(all).not.toContain('919876543210');
    expect(all).not.toContain(creds.authToken);
  });
});

describe('config: WhatsApp credentials', () => {
  const good = { accountSid: 'AC' + 'a1'.repeat(16), authToken: 'tok', from: 'whatsapp:+14155238886', to: 'whatsapp:+919876543210' };

  it('accepts a complete, well-formed set', () => {
    expect(parseWhatsApp(good)).toEqual(good);
  });

  it('turns the channel off (undefined) for placeholders, missing parts, or a number that is not whatsapp:+digits', () => {
    expect(parseWhatsApp({ placeholder: 'x' })).toBeUndefined();
    expect(parseWhatsApp({ ...good, to: '+919876543210' })).toBeUndefined();
    expect(parseWhatsApp({ ...good, accountSid: 'nope' })).toBeUndefined();
    expect(parseWhatsApp({ ...good, authToken: '' })).toBeUndefined();
    expect(parseWhatsApp(null)).toBeUndefined();
  });

  it('is read from WHATSAPP_* variables or a secret ARN', () => {
    const env = (extra: Record<string, string>) => ({ AUTH_MODE: 'dev', STORE: 'memory', ...extra }) as NodeJS.ProcessEnv;
    expect(loadConfig(env({})).whatsapp).toBeUndefined();
    expect(loadConfig(env({ WHATSAPP_SECRET_ARN: 'arn:x' })).whatsapp).toEqual({ secretArn: 'arn:x' });
    expect(
      loadConfig(env({ WHATSAPP_ACCOUNT_SID: good.accountSid, WHATSAPP_AUTH_TOKEN: 'tok', WHATSAPP_FROM: good.from, WHATSAPP_TO: good.to })).whatsapp,
    ).toEqual({ creds: good });
  });
});

describe('SnsNotifier (email to the caregiver)', () => {
  const sendAll = async (n: CaregiverNotice, ackUrl: (n: CaregiverNotice) => string | undefined) => {
    const sent: Array<Record<string, any>> = [];
    const client = { send: async (cmd: { input: Record<string, any> }) => void sent.push(cmd.input) } as any;
    const ok = await new SnsNotifier('arn:aws:sns:us-east-1:1:t', ackUrl, client).notify(n);
    return { ok, sent };
  };

  it('puts the tap-to-confirm link in the email for a call request', async () => {
    const { ok, sent } = await sendAll(notice(), (n) => `https://hub.example/ack/${n.callId}`);
    expect(ok).toBe(true);
    expect(sent[0]!.Subject).toBe('Kinwise, action needed: Asha wants to talk to you now');
    expect(sent[0]!.Message).toContain('Please call now');
    expect(sent[0]!.Message).toContain('https://hub.example/ack/call_1');
  });

  it('marks the e-mail that needs an answer, and tells the others that nothing is needed', async () => {
    const call = await sendAll(notice(), () => undefined);
    expect(call.sent[0]!.Subject).toBe('Kinwise, action needed: Asha wants to talk to you now');
    const fyi = await sendAll(notice({ kind: 'pause', title: 'Kinwise paused a visit at the door', callId: undefined }), () => undefined);
    expect(fyi.sent[0]!.Subject).toBe('Kinwise: Kinwise paused a visit at the door');
    expect(fyi.sent[0]!.Message).toMatch(/No action needed now/);
    expect(fyi.sent[0]!.Message).toMatch(/separate e-?mail with a button/);
    expect(call.sent[0]!.Message).not.toMatch(/No action needed now/);
  });

  it('has no link on a Pause or a warning, and still says only the signal', async () => {
    const { sent } = await sendAll(notice({ kind: 'pause', callId: undefined }), () => 'https://hub.example/ack/x');
    expect(sent[0]!.Message).not.toContain('https://');
    expect(sent[0]!.Message).toContain('signals only');
  });
});
