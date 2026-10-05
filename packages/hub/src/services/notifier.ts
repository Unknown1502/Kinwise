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
}

export interface Notifier {
  notify(notice: CaregiverNotice): Promise<void>;
}

/** Local/dev notifier: logs and keeps a short outbox the demo UI can show as "Priya's phone". */
export class OutboxNotifier implements Notifier {
  readonly outbox: CaregiverNotice[] = [];

  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}

  async notify(notice: CaregiverNotice): Promise<void> {
    this.outbox.unshift(notice);
    this.outbox.splice(50);
    this.log(`📣 [to ${notice.caregiverName}] ${notice.title} — ${notice.body}`);
  }
}

export class SnsNotifier implements Notifier {
  constructor(
    private readonly topicArn: string,
    private readonly client = new SNSClient({}),
  ) {}

  async notify(notice: CaregiverNotice): Promise<void> {
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
  }
}

/** Fan out to several notifiers; one failing channel never blocks the others. */
export class MultiNotifier implements Notifier {
  constructor(private readonly targets: Notifier[]) {}

  async notify(notice: CaregiverNotice): Promise<void> {
    const results = await Promise.allSettled(this.targets.map((t) => t.notify(notice)));
    for (const r of results) if (r.status === 'rejected') console.error('notifier failed', r.reason);
  }
}
