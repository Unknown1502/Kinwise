import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

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

export class SnsNotifier implements Notifier {
  constructor(
    private readonly topicArn: string,
    private readonly client = new SNSClient({}),
  ) {}

  async notify(notice: CaregiverNotice): Promise<boolean> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: `Kinwise: ${notice.title}`.slice(0, 99),
        Message: `${notice.title}\n\n${notice.body}\n\n— Kinwise (signals only: no recordings or transcripts are ever shared)`,
        MessageAttributes: {
          kind: { DataType: 'String', StringValue: notice.kind },
          householdId: { DataType: 'String', StringValue: notice.householdId },
        },
      }),
    );
    return true;
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
