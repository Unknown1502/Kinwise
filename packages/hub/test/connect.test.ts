import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import type { Identity } from '../src/auth/identity.js';
import type { VisitorEvent } from '../src/domain/types.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { KinwiseService } from '../src/services/kinwise.js';
import { OutboxNotifier } from '../src/services/notifier.js';
import { MemoryStore } from '../src/store/memory.js';

// covers: R1, R2, R3 (see .aqg/code-construction/connect-the-dots.md)

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };
const priya: Identity = { userId: 'priya', householdId: HH, role: 'caregiver', name: 'Meera', scopes: [] };
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };

// Thursday 2026-10-08 in New York (UTC-4).
const local = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00-04:00`);

function setup() {
  const clock = { t: local('10:00'), now() { return this.t; } };
  const service = new KinwiseService({ store: new MemoryStore(), notifier: new OutboxNotifier(() => {}), clock });
  return { clock, service };
}

const visitor = (id: string, hhmm: string): VisitorEvent => ({
  eventId: id,
  deviceId: 'front-door',
  occurredAt: local(hhmm).toISOString(),
  source: 'demo',
  ringEventType: 'button_press',
  perception: { personPresent: true, peopleCount: 1, carrying: 'a small box', description: 'A person at the front door holding a small box' },
});

const CALL = 'A man from the FTC said my accounts are compromised and I should withdraw it as gold. Do not tell my family.';

describe('the Pause says where its warning came from', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.service.createHousehold(demoHousehold(ctx.clock.now()));
  });

  it('S1.1: names the call she asked about', async () => {
    const { service, clock } = ctx;
    clock.t = local('10:20');
    await service.checkCall(asha, { description: CALL });
    clock.t = local('12:00');
    await service.ingestVisitor(HH, visitor('v1', '12:00'));

    const alert = (await service.tvState(tv)).activeAlert!;
    expect(alert.kind).toBe('pause');
    expect(alert.because).toBe('At 10:20 AM you asked Kinwise about a call, and it matched courier-scam warning signs.');
  });

  it('S1.2: names both a saved reminder and a call check', async () => {
    const { service, clock } = ctx;
    clock.t = local('10:15');
    await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    clock.t = local('10:20');
    await service.checkCall(asha, { description: CALL });
    clock.t = local('12:00');
    await service.ingestVisitor(HH, visitor('v2', '12:00'));

    const alert = (await service.tvState(tv)).activeAlert!;
    expect(alert.because).toBe(
      'At 10:15 AM a reminder you saved, and at 10:20 AM a call you asked about, matched courier-scam warning signs.',
    );
  });

  it('does not repeat a time when the reminder and the call share a minute', async () => {
    const { service, clock } = ctx;
    clock.t = local('10:20');
    await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    await service.checkCall(asha, { description: CALL });
    clock.t = local('12:00');
    await service.ingestVisitor(HH, visitor('v6', '12:00'));
    expect((await service.tvState(tv)).activeAlert!.because).toBe(
      'At 10:20 AM a reminder you saved and a call you asked about matched courier-scam warning signs.',
    );
  });

  it('S2.1: never repeats the words that were said', async () => {
    const { service, clock } = ctx;
    clock.t = local('10:20');
    await service.checkCall(asha, { description: CALL });
    await service.addReminder(asha, { text: 'Gold courier from the FTC at two', at: local('14:00').toISOString() });
    clock.t = local('12:00');
    await service.ingestVisitor(HH, visitor('v3', '12:00'));

    const because = (await service.tvState(tv)).activeAlert!.because!;
    expect(because).not.toMatch(/FTC|gold|courier at|Do not tell/i);
  });

  it('has no origin line on a gentle (no-risk) visitor card', async () => {
    const { service, clock } = ctx;
    clock.t = local('12:00');
    await service.ingestVisitor(HH, visitor('v4', '12:00'));
    const alert = (await service.tvState(tv)).activeAlert!;
    expect(alert.kind).toBe('gentle');
    expect(alert.because).toBeUndefined();
  });

  it('S3.1: family members never see it (reminders are the resident\'s)', async () => {
    const { service, clock } = ctx;
    clock.t = local('10:15');
    await service.addReminder(asha, { text: 'Courier from the bank picking up a package', at: local('14:00').toISOString() });
    clock.t = local('12:00');
    await service.ingestVisitor(HH, visitor('v5', '12:00'));

    expect((await service.getToday(priya)).activeAlert?.because).toBeUndefined();
    expect((await service.explainLastAlert(priya)).alert?.because).toBeUndefined();
    // The resident still gets it.
    expect((await service.getToday(asha)).activeAlert?.because).toMatch(/reminder you saved/);
  });
});

describe('MCP tools still match their output schema with the origin line', () => {
  it('serves `because` to the resident and withholds it from the caregiver, through a real MCP client', async () => {
    // A fixed Wednesday morning, so the story does not depend on when it runs (the seed expects visitors Tuesday 2-3 PM and Thursday 10-11 AM New York).
    const fixed = new Date('2026-10-07T10:00:00-04:00');
    const { app, service } = await bootstrap(loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv), {
      clock: { now: () => fixed },
    });
    const now = fixed.getTime();
    await service.checkCall(asha, { description: CALL });
    await service.ingestVisitor(HH, { ...visitor('mcp1', '12:00'), occurredAt: new Date(now).toISOString() });

    const connect = async (token: string) => {
      const transport = new StreamableHTTPClientTransport(new URL('http://kinwise.test/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: 'kinwise-test', version: '1.0.0' });
      await client.connect(transport);
      return client;
    };
    const ashaCall = await (await connect('dev-asha')).callTool({ name: 'kinwise_explain_last_alert', arguments: {} });
    expect(ashaCall.isError).toBeFalsy();
    expect((ashaCall.structuredContent as { alert: { because?: string } }).alert.because).toMatch(/you asked Kinwise about a call/);

    const priyaCall = await (await connect('dev-priya')).callTool({ name: 'kinwise_explain_last_alert', arguments: {} });
    expect(priyaCall.isError).toBeFalsy();
    expect((priyaCall.structuredContent as { alert: { because?: string } }).alert.because).toBeUndefined();
  });
});
