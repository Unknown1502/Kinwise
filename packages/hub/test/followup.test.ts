import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth/identity.js';
import { loadConfig } from '../src/config.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { RESEND_AFTER_MS } from '../src/services/kinwise.js';
import { KinwiseService, type FollowUpScheduler } from '../src/services/kinwise.js';
import { EventBridgeFollowUp, MultiNotifier, OutboxNotifier } from '../src/services/notifier.js';
import { makeHandler } from '../src/handler.js';
import { MemoryStore } from '../src/store/memory.js';
import { followUpKey, signFollowUp, verifyFollowUp } from '../src/services/ackLink.js';

const HH = DEMO_HOUSEHOLD_ID;
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };
const meera: Identity = { userId: 'priya', householdId: HH, role: 'caregiver', name: 'Meera', scopes: [] };
const MIN = 60_000;

class FakeScheduler implements FollowUpScheduler {
  readonly calls: Array<{ householdId: string; callId: string; at: Date }> = [];
  fail = false;
  async schedule(householdId: string, callId: string, at: Date) {
    if (this.fail) throw new Error('scheduler down');
    this.calls.push({ householdId, callId, at });
  }
}

function setup() {
  const clock = { t: new Date('2026-10-14T10:00:00Z'), now() { return this.t; } };
  const outbox = new OutboxNotifier(() => {});
  const scheduler = new FakeScheduler();
  const service = new KinwiseService({ store: new MemoryStore(), notifier: new MultiNotifier([outbox, { notify: async () => true }]), clock, followUp: scheduler });
  return { clock, outbox, scheduler, service };
}

async function pressCall(ctx: ReturnType<typeof setup>) {
  await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
  const { alertId } = await ctx.service.ingestVisitor(HH, {
    eventId: 'e1', deviceId: 'd', occurredAt: ctx.clock.now().toISOString(), source: 'demo', unscheduled: true, ringEventType: 'button_press',
    perception: { personPresent: true, peopleCount: 1, description: 'a person' },
  } as any);
  return ctx.service.respondToAlert(tv, alertId!, 'call_family');
}

describe('the follow-up no longer depends on the TV being on', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => void (ctx = setup()));
  const requests = () => ctx.outbox.outbox.filter((n) => n.kind === 'call_request');

  it('schedules exactly one follow-up when Call Meera is pressed, just after the re-send is due', async () => {
    await pressCall(ctx);
    expect(ctx.scheduler.calls).toHaveLength(1);
    const call = ctx.scheduler.calls[0]!;
    expect(call.householdId).toBe(HH);
    expect(call.callId).toBe(requests()[0]!.callId);
    expect(call.at.getTime() - ctx.clock.t.getTime()).toBeGreaterThan(RESEND_AFTER_MS);
    expect(call.at.getTime() - ctx.clock.t.getTime()).toBeLessThanOrEqual(RESEND_AFTER_MS + 30_000);
  });

  it('schedules nothing for the other answers', async () => {
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
    const { alertId } = await ctx.service.ingestVisitor(HH, {
      eventId: 'e2', deviceId: 'd', occurredAt: ctx.clock.now().toISOString(), source: 'demo', unscheduled: true, ringEventType: 'button_press',
      perception: { personPresent: true, peopleCount: 1, description: 'a person' },
    } as any);
    await ctx.service.respondToAlert(tv, alertId!, 'dismiss');
    expect(ctx.scheduler.calls).toHaveLength(0);
  });

  it('a scheduler that fails never fails the call, and the TV poll still covers it', async () => {
    ctx.scheduler.fail = true;
    const orig = console.error;
    console.error = () => {};
    const res = await pressCall(ctx);
    console.error = orig;
    expect(res.delivered).toBe(true);
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 2.5 * MIN);
    await ctx.service.tvState(tv);
    expect(requests()).toHaveLength(2);
  });

  it('followUp() sends the second message when due, with nobody polling the TV, and only once', async () => {
    await pressCall(ctx);
    const callId = requests()[0]!.callId!;
    await ctx.service.followUp(HH, callId); // too early
    expect(requests()).toHaveLength(1);
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 2.2 * MIN);
    await Promise.all([ctx.service.followUp(HH, callId), ctx.service.followUp(HH, callId)]);
    await ctx.service.followUp(HH, callId);
    expect(requests()).toHaveLength(2);
    expect(requests()[0]!.title).toMatch(/still waiting/i);
  });

  it('followUp() only acts for the call the timer was set for, never for a different or newer one', async () => {
    await pressCall(ctx);
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 2.5 * MIN);
    await ctx.service.followUp(HH, 'call_some_other_one');
    expect(requests()).toHaveLength(1);
    await ctx.service.followUp(HH, requests()[0]!.callId!);
    expect(requests()).toHaveLength(2);
  });

  it('followUp() does nothing once Meera has confirmed, or for a household that does not exist', async () => {
    await pressCall(ctx);
    await ctx.service.acknowledgeCall(meera, requests()[0]!.callId!);
    ctx.clock.t = new Date(ctx.clock.t.getTime() + 3 * MIN);
    await ctx.service.followUp(HH, requests()[0]!.callId!);
    expect(requests()).toHaveLength(1);
    await expect(ctx.service.followUp('hh-nobody', 'call_1')).resolves.toBeUndefined();
  });
});

describe('EventBridgeFollowUp: one-time schedules', () => {
  it('creates a one-time schedule that invokes the hub with the household, then deletes itself', async () => {
    const sent: Array<Record<string, any>> = [];
    const client = { send: async (cmd: { input: Record<string, any> }) => void sent.push(cmd.input) } as any;
    const fu = new EventBridgeFollowUp({ roleArn: 'arn:aws:iam::1:role/r', targetArn: 'arn:aws:lambda:us-east-1:1:function:hub', sign: (h, c) => `sig(${h},${c})`, client });
    await fu.schedule('hh-asha', 'call_9', new Date('2026-10-14T10:02:10.500Z'));
    expect(sent[0]).toMatchObject({
      Name: 'kinwise-followup-call_9',
      ScheduleExpression: 'at(2026-10-14T10:02:10)',
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: { Arn: 'arn:aws:lambda:us-east-1:1:function:hub', RoleArn: 'arn:aws:iam::1:role/r' },
    });
    expect(JSON.parse(sent[0]!.Target.Input)).toEqual({ source: 'kinwise.followup', householdId: 'hh-asha', callId: 'call_9', sig: 'sig(hh-asha,call_9)' });
  });

  it('refuses names that Scheduler would reject', async () => {
    const client = { send: async () => {} } as any;
    const fu = new EventBridgeFollowUp({ roleArn: 'r', targetArn: 't', sign: () => 's', client });
    await expect(fu.schedule('hh', 'call with spaces/../x', new Date())).rejects.toThrow(/call id/i);
  });
});

describe('config: the follow-up target', () => {
  const env = (extra: Record<string, string>) => ({ AUTH_MODE: 'dev', STORE: 'memory', ...extra }) as NodeJS.ProcessEnv;
  it('is off by default; with a role it targets this very function', () => {
    expect(loadConfig(env({})).followUp).toBeUndefined();
    const cfg = loadConfig(env({ FOLLOWUP_ROLE_ARN: 'arn:aws:iam::123456789012:role/sched', AWS_REGION: 'us-east-1', AWS_LAMBDA_FUNCTION_NAME: 'Kinwise-Hub-abc' }));
    expect(cfg.followUp).toEqual({ roleArn: 'arn:aws:iam::123456789012:role/sched', targetArn: 'arn:aws:lambda:us-east-1:123456789012:function:Kinwise-Hub-abc' });
  });
});

describe('signed follow-up events', () => {
  const key = followUpKey('test-secret');
  it('verify only for the exact household and call they were signed for', () => {
    const sig = signFollowUp(key, 'hh-asha', 'call_1');
    expect(verifyFollowUp(key, 'hh-asha', 'call_1', sig)).toBe(true);
    expect(verifyFollowUp(key, 'hh-other', 'call_1', sig)).toBe(false);
    expect(verifyFollowUp(key, 'hh-asha', 'call_2', sig)).toBe(false);
    expect(verifyFollowUp(followUpKey('other'), 'hh-asha', 'call_1', sig)).toBe(false);
    expect(verifyFollowUp(key, 'hh-asha', 'call_1', 'x'.repeat(sig.length))).toBe(false);
    expect(verifyFollowUp(key, 'hh-asha', 'call_1', undefined as any)).toBe(false);
  });
});

describe('the Lambda handler', () => {
  const key = followUpKey('test-secret');
  const fakeApp = async (followed: string[]) => ({
    app: { fetch: async () => new Response('api') },
    service: { followUp: async (h: string, c: string) => void followed.push(`${h}/${c}`) },
    verifyFollowUp: (h: string, c: string, s: string) => verifyFollowUp(key, h, c, s),
  });
  const ev = (over: Record<string, unknown> = {}) => ({ source: 'kinwise.followup', householdId: 'hh-asha', callId: 'call_1', sig: signFollowUp(key, 'hh-asha', 'call_1'), ...over });

  it('runs the follow-up for a Scheduler event, and treats an API request as an API request', async () => {
    const followed: string[] = [];
    const handler = makeHandler(fakeApp(followed) as any);
    const out = await handler(ev() as any, {} as any);
    expect(followed).toEqual(['hh-asha/call_1']);
    expect(out).toEqual({ ok: true });
    // an API Gateway request whose body claims the same thing is still just a request
    const api = await handler({ requestContext: {}, version: '2.0', rawPath: '/x', body: JSON.stringify({ source: 'kinwise.followup', householdId: 'hh-other' }), headers: {} } as any, {} as any).catch(() => undefined);
    expect(followed).toEqual(['hh-asha/call_1']);
    void api;
  });

  it('ignores a Scheduler-shaped event that is unsigned, mis-signed, for another call, or missing parts', async () => {
    const followed: string[] = [];
    const handler = makeHandler(fakeApp(followed) as any);
    for (const bad of [{ sig: undefined }, { sig: 'forged' }, { callId: 'call_2' }, { householdId: 'hh-other' }, { householdId: undefined }, { callId: undefined }]) {
      const out = await handler(ev(bad) as any, {} as any).catch(() => undefined);
      expect(out).toEqual({ ok: false });
    }
    expect(followed).toEqual([]);
  });
});
