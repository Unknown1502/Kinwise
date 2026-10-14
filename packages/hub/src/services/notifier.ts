import {
  ListSubscriptionsByTopicCommand,
  PublishCommand,
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
  type Subscription,
} from '@aws-sdk/client-sns';
import { CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import type { Contacts } from '../domain/types.js';

/** Where Kinwise reaches a caregiver, looked up per notice. */
export type ContactLookup = (householdId: string, caregiverId: string) => Promise<Contacts | undefined>;

/**
 * Privacy rule 2: a caregiver notice carries a signal, never content. No
 * transcripts, frames or reminder text ever go into a notice.
 */
export interface CaregiverNotice {
  householdId: string;
  caregiverId: string;
  caregiverName: string;
  kind: 'pause' | 'call_request' | 'risk_high';
  title: string;
  body: string;
  at: string;
  /** Set on a call request: the call the "I'm calling now" button confirms. */
  callId?: string;
}

export interface Notifier {
  /** A stand-in for the caregiver's phone (the demo panel). It never counts as delivery on its own unless it is the only channel. */
  readonly simulated?: boolean;
  /** True when the notice reached the caregiver's channel. */
  notify(notice: CaregiverNotice): Promise<boolean>;
}

/** Local/dev notifier: logs and keeps a short outbox the demo UI can show as "Meera's phone". */
export class OutboxNotifier implements Notifier {
  readonly simulated = true;
  readonly outbox: CaregiverNotice[] = [];

  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}

  async notify(notice: CaregiverNotice): Promise<boolean> {
    this.outbox.unshift(notice);
    this.outbox.splice(50);
    this.log(`📣 [to ${notice.caregiverName}] ${notice.title} — ${notice.body}`);
    return true;
  }
}

/** E-mail (and any other SNS subscriber). A call request carries the signed "I'm calling now" link. */
export class SnsNotifier implements Notifier {
  constructor(
    private readonly topicArn: string,
    private readonly ackUrl: (notice: CaregiverNotice) => string | undefined = () => undefined,
    private readonly client = new SNSClient({}),
  ) {}

  async notify(notice: CaregiverNotice): Promise<boolean> {
    const needsAnswer = notice.kind === 'call_request';
    const ack = needsAnswer ? this.ackUrl(notice) : undefined;
    // One call sends up to three e-mails within seconds; only one needs the caregiver to do something, so say which.
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: `${needsAnswer ? 'Kinwise, action needed' : 'Kinwise'}: ${notice.title}`.slice(0, 99),
        Message: [
          notice.title,
          notice.body,
          ...(ack ? [`Tap to tell them you are calling: ${ack}`] : []),
          ...(needsAnswer ? [] : ['No action needed now. If they ask you to call, you will get a separate e-mail with a button.']),
          '— Kinwise (signals only: no recordings or transcripts are ever shared)',
        ].join('"""+NL+NL+"""'),
        MessageAttributes: {
          kind: { DataType: 'String', StringValue: notice.kind },
          householdId: { DataType: 'String', StringValue: notice.householdId },
          // A caregiver's own e-mail subscription filters on this, so each caregiver gets only their notices.
          caregiverId: { DataType: 'String', StringValue: notice.caregiverId },
        },
      }),
    );
    return true;
  }
}

/** A text message to the caregiver's own number through Amazon SNS (SMS). Carries the signal and the confirm link, nothing else. */
export class SmsNotifier implements Notifier {
  constructor(
    private readonly opts: {
      lookup: ContactLookup;
      ackUrl: (notice: CaregiverNotice) => string | undefined;
      client?: SNSClient;
    },
  ) {}

  async notify(notice: CaregiverNotice): Promise<boolean> {
    const number = (await this.opts.lookup(notice.householdId, notice.caregiverId))?.sms;
    if (!number) return false; // this caregiver has no number: not a failure of the service, simply nothing to send
    const ack = notice.kind === 'call_request' ? this.opts.ackUrl(notice) : undefined;
    const text = [`Kinwise: ${notice.title}.`, notice.kind === 'call_request' ? 'Please call now.' : '', ack ? `Tap to say you are calling: ${ack}` : '']
      .filter(Boolean)
      .join(' ');
    try {
      await (this.opts.client ?? (this.opts.client = new SNSClient({}))).send(
        new PublishCommand({
          PhoneNumber: number,
          Message: text,
          MessageAttributes: { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' } },
        }),
      );
      return true;
    } catch (err) {
      // The number is personal data: log what went wrong, never to whom.
      console.error('[sms] message failed:', err instanceof Error ? err.message.replace(/\+\d{6,}/g, '+***') : 'unknown error');
      return false;
    }
  }
}

/** Keeps a caregiver's e-mail subscribed to the alert topic with a filter on their own id. */
export class SnsContactSync {
  constructor(
    private readonly topicArn: string,
    private readonly client: SNSClient = new SNSClient({}),
  ) {}

  async syncEmail(_householdId: string, memberId: string, oldEmail: string | undefined, newEmail: string | undefined): Promise<void> {
    if (oldEmail) {
      for (const sub of await this.list()) {
        // A subscription still waiting for confirmation has no ARN to remove; AWS drops it after three days.
        if (sub.Protocol === 'email' && sub.Endpoint === oldEmail && sub.SubscriptionArn?.startsWith('arn:')) {
          await this.client.send(new UnsubscribeCommand({ SubscriptionArn: sub.SubscriptionArn }));
        }
      }
    }
    if (newEmail) {
      await this.client.send(
        new SubscribeCommand({
          TopicArn: this.topicArn,
          Protocol: 'email',
          Endpoint: newEmail,
          Attributes: { FilterPolicy: JSON.stringify({ caregiverId: [memberId] }) },
          ReturnSubscriptionArn: true,
        }),
      );
    }
  }

  private async list(): Promise<Subscription[]> {
    const out: Subscription[] = [];
    let next: string | undefined;
    do {
      const page = await this.client.send(new ListSubscriptionsByTopicCommand({ TopicArn: this.topicArn, NextToken: next }));
      out.push(...(page.Subscriptions ?? []));
      next = page.NextToken;
    } while (next);
    return out;
  }
}

/** One-time EventBridge Scheduler schedules that invoke the hub itself, then delete themselves. */
export class EventBridgeFollowUp {
  private readonly client: SchedulerClient;
  constructor(private readonly opts: { roleArn: string; targetArn: string; client?: SchedulerClient }) {
    this.client = opts.client ?? new SchedulerClient({});
  }

  async schedule(householdId: string, callId: string, at: Date): Promise<void> {
    // Scheduler names allow only letters, digits, - _ . ; refuse anything else rather than let a bad id through.
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(callId)) throw new Error('call id is not a valid schedule name');
    await this.client.send(
      new CreateScheduleCommand({
        Name: `kinwise-followup-${callId}`,
        ScheduleExpression: `at(${at.toISOString().slice(0, 19)})`,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: { Arn: this.opts.targetArn, RoleArn: this.opts.roleArn, Input: JSON.stringify({ source: 'kinwise.followup', householdId }) },
      }),
    );
  }
}

export interface NtfyOptions {
  server: string;
  topic: string;
  /** The signed "I'm calling now" link for a call request, or undefined when the hub has no public address. */
  ackUrl: (notice: CaregiverNotice) => string | undefined;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Push to the caregiver's phone through ntfy (https://ntfy.sh, or a server you host). The app on the
 * phone shows it at once; a call request is "urgent" (priority 5), which can ring through Do Not Disturb
 * when the person allows that for the topic. Only the title and body of the notice leave the hub.
 */
export class NtfyNotifier implements Notifier {
  constructor(private readonly opts: NtfyOptions) {}

  async notify(notice: CaregiverNotice): Promise<boolean> {
    const ack = notice.kind === 'call_request' ? this.opts.ackUrl(notice) : undefined;
    const body = {
      topic: this.opts.topic,
      title: notice.title,
      message: notice.body,
      priority: notice.kind === 'call_request' ? 5 : 4,
      tags: [notice.kind === 'call_request' ? 'telephone_receiver' : 'warning'],
      ...(ack ? { actions: [{ action: 'http', label: "I'm calling now", url: ack, method: 'POST', clear: true }] } : {}),
    };
    try {
      const res = await (this.opts.fetch ?? fetch)(this.opts.server, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      if (!res.ok) console.error(`[ntfy] push refused: HTTP ${res.status}`);
      return res.ok;
    } catch (err) {
      console.error('[ntfy] push failed:', err instanceof Error ? err.message : 'unknown error');
      return false;
    }
  }
}

export interface WhatsAppOptions {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  /** The signed "I'm calling now" link for a call request, or undefined when the hub has no public address. */
  ackUrl: (notice: CaregiverNotice) => string | undefined;
  /** The caregiver's own WhatsApp number wins over the shared `to`. */
  lookup?: ContactLookup;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * WhatsApp to the caregiver through Twilio. A call request carries the signed confirm link; opening it shows
 * one button. Twilio's sandbox only delivers free text within 24 hours of the caregiver last writing to it
 * (error 63016 otherwise); a production number would use a Meta-approved template instead.
 */
export class WhatsAppNotifier implements Notifier {
  constructor(private readonly opts: WhatsAppOptions) {}

  async notify(notice: CaregiverNotice): Promise<boolean> {
    const ack = notice.kind === 'call_request' ? this.opts.ackUrl(notice) : undefined;
    const text = [notice.title, notice.body, ...(ack ? [`Tap to tell them you are calling: ${ack}`] : [])].join('\n\n');
    const own = (await this.opts.lookup?.(notice.householdId, notice.caregiverId))?.whatsapp;
    const to = own ? `whatsapp:${own}` : this.opts.to;
    try {
      const res = await (this.opts.fetch ?? fetch)(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64')}`,
        },
        body: new URLSearchParams({ From: this.opts.from, To: to, Body: text }).toString(),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
      });
      if (!res.ok) {
        // Only Twilio's error code is logged: never the number, the token or the message.
        const code = await res.json().then((j: { code?: unknown }) => j.code, () => undefined);
        console.error(`[whatsapp] message refused: HTTP ${res.status}${code ? `, Twilio code ${String(code)}` : ''}`);
      }
      return res.ok;
    } catch (err) {
      console.error('[whatsapp] message failed:', err instanceof Error ? err.message : 'unknown error');
      return false;
    }
  }
}

/**
 * Fan out to several notifiers; one failing channel never blocks the others. The answer is whether the
 * caregiver was really reached: a real channel succeeded (or, in the local demo with no real channel, the simulated phone did).
 */
export class MultiNotifier implements Notifier {
  constructor(private readonly targets: Notifier[]) {}

  async notify(notice: CaregiverNotice): Promise<boolean> {
    const results = await Promise.allSettled(this.targets.map((t) => t.notify(notice)));
    let real = 0;
    let realOk = 0;
    let simulatedOk = 0;
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error('notifier failed', r.reason);
      const ok = r.status === 'fulfilled' && r.value;
      if (this.targets[i]!.simulated) simulatedOk += ok ? 1 : 0;
      else {
        real++;
        realOk += ok ? 1 : 0;
      }
    });
    return real > 0 ? realOk > 0 : simulatedOk > 0;
  }
}
