import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth/identity.js';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { DEMO_HOUSEHOLD_ID, demoHousehold } from '../src/seed.js';
import { KinwiseService } from '../src/services/kinwise.js';
import { OutboxNotifier } from '../src/services/notifier.js';
import { MemoryStore } from '../src/store/memory.js';

// covers: R6 (see .aqg/code-construction/watch-consent.md): a spoken "turn on" cannot start the watch

const HH = DEMO_HOUSEHOLD_ID;
const asha: Identity = { userId: 'asha', householdId: HH, role: 'resident', name: 'Asha', scopes: [] };
const tv: Identity = { userId: 'tv-living-room', householdId: HH, role: 'device', name: 'Living room TV', scopes: [] };
const local = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00-04:00`);
const CALL = 'A man from the FTC said my accounts are compromised and I should withdraw it as gold. Do not tell my family.';

describe('only the authenticated TV can start the watch; a voice cannot be verified as hers', () => {
  let clock: { t: Date; now(): Date };
  let store: MemoryStore;
  let notifier: OutboxNotifier;
  let service: KinwiseService;
  beforeEach(async () => {
    clock = { t: local('10:20'), now() { return this.t; } };
    store = new MemoryStore();
    notifier = new OutboxNotifier(() => {});
    service = new KinwiseService({ store, notifier, clock });
    await service.createHousehold(demoHousehold(clock.now()));
  });

  it('V1: "turn on" through a resident (voice/Echo/MCP) token starts nothing, sends nothing and writes nothing', async () => {
    const { watch } = await service.checkCall(asha, { description: CALL });
    const before = (await store.load(HH))!.version;
    const r = await service.respondToWatch(asha, watch.offer!.id, 'turn_on');

    expect(r.needsTv).toBe(true);
    expect(r.message).toMatch(/TV/);
    expect(r.watch.state).toBe('offered'); // the question is still open, now waiting on the TV
    expect(r.riskWindow.level).toBe('none');
    expect(notifier.outbox).toEqual([]);
    const s = (await store.load(HH))!;
    expect(s.version).toBe(before);
    expect(s.riskWindow).toBeUndefined();
    expect(s.lastWatchAnswer).toBeUndefined();
  });

  it('V2: the same question then answered on the authenticated TV starts the watch once', async () => {
    const { watch } = await service.checkCall(asha, { description: CALL });
    await service.respondToWatch(asha, watch.offer!.id, 'turn_on'); // she said it aloud first
    const r = await service.respondToWatch(tv, watch.offer!.id, 'turn_on');
    expect(r.needsTv).toBeUndefined();
    expect(r.watch.state).toBe('on');
    expect(r.riskWindow.level).toBe('high');
    expect(notifier.outbox.map((n) => n.kind)).toEqual(['risk_high']);
    expect((await store.load(HH))!.riskWindow?.consentedAt).toBeDefined();
  });

  it('V3: by voice she can still say not now and review privacy; both are safe and change nothing dangerous', async () => {
    const { watch } = await service.checkCall(asha, { description: CALL });
    const review = await service.respondToWatch(asha, watch.offer!.id, 'review_privacy');
    expect(review.privacy!.join(' ')).toMatch(/press Turn on on your TV/); // it also says where the real choice is made
    expect(review.privacy!.join(' ')).toMatch(/at most 30 minutes, and it deletes them the next time Kinwise runs/); // the pending labels are disclosed, not hidden
    expect(review.watch.state).toBe('offered');
    const no = await service.respondToWatch(asha, watch.offer!.id, 'not_now');
    expect(no.watch.state).toBe('declined');
    expect(notifier.outbox).toEqual([]);
  });

  it('V4: a voice "turn on" for a question that has run out is refused like any other', async () => {
    const { watch } = await service.checkCall(asha, { description: CALL });
    clock.t = local('11:00');
    await expect(service.respondToWatch(asha, watch.offer!.id, 'turn_on')).rejects.toThrow(/run out/);
  });

  it('V5: Alexa says the truth about where to confirm, aloud and in the card data', async () => {
    const fixed = new Date('2026-10-07T10:00:00-04:00');
    const boot = await bootstrap(loadConfig({ AUTH_MODE: 'dev', STORE: 'memory', CONCIERGE_URL: '' } as NodeJS.ProcessEnv), { clock: { now: () => fixed } });
    const transport = new StreamableHTTPClientTransport(new URL('http://kinwise.test/mcp'), {
      fetch: async (url, init) => boot.app.fetch(new Request(url, init)),
      requestInit: { headers: { authorization: 'Bearer dev-asha' } },
    });
    const alexa = new Client({ name: 'kinwise-test', version: '1.0.0' });
    await alexa.connect(transport);

    const asked = await alexa.callTool({ name: 'kinwise_check_call', arguments: { description: CALL } });
    expect((asked.content as Array<{ text: string }>)[0]!.text).toMatch(/on your TV/i);
    const said = await alexa.callTool({ name: 'kinwise_set_safety_watch', arguments: { choice: 'turn_on' } });
    expect((said.content as Array<{ text: string }>)[0]!.text).toMatch(/can't tell.*TV/is);
    expect((await boot.service.tvState(tv)).watch.state).toBe('offered');
  });
});
