import { SCOPES, type Identity } from './auth/identity.js';
import { ChainVerifier, CognitoTokenVerifier, StaticTokenVerifier, devTokens, type TokenVerifier } from './auth/verify.js';
import type { HubConfig } from './config.js';
import { AgentCoreConcierge, HttpConcierge, type ConciergeClient } from './http/concierge.js';
import { createApp } from './http/app.js';
import { demoHousehold } from './seed.js';
import { KinwiseService } from './services/kinwise.js';
import { MultiNotifier, OutboxNotifier, SnsNotifier, type Notifier } from './services/notifier.js';
import { DynamoStore } from './store/dynamo.js';
import { MemoryStore } from './store/memory.js';
import type { Store } from './store/store.js';

export async function bootstrap(config: HubConfig) {
  const store: Store =
    config.store === 'dynamo'
      ? new DynamoStore(config.tableName ?? (() => { throw new Error('TABLE_NAME is required for STORE=dynamo'); })())
      : new MemoryStore(config.store === 'file' ? config.dataFile : undefined);

  const outbox = new OutboxNotifier();
  const notifier: Notifier = config.snsTopicArn ? new MultiNotifier([outbox, new SnsNotifier(config.snsTopicArn)]) : outbox;
  const service = new KinwiseService({ store, notifier });

  const deviceTokens: Record<string, Identity> = Object.fromEntries(
    Object.entries(config.deviceTokens).map(([token, d]) => [
      token,
      { userId: d.deviceId, householdId: d.householdId, role: 'device' as const, name: d.name, scopes: [] },
    ]),
  );

  let verifier: TokenVerifier;
  if (config.authMode === 'cognito' && config.cognito) {
    verifier = new ChainVerifier([
      new StaticTokenVerifier(deviceTokens),
      new CognitoTokenVerifier(config.cognito, config.userDirectory, config.demoHouseholdId),
    ]);
  } else {
    verifier = new StaticTokenVerifier({ ...devTokens(config.demoHouseholdId), ...deviceTokens });
  }

  const concierge: ConciergeClient | undefined = config.conciergeRuntimeArn
    ? new AgentCoreConcierge(config.conciergeRuntimeArn)
    : config.conciergeUrl
      ? new HttpConcierge(config.conciergeUrl)
      : undefined;

  const seed = () => demoHousehold(new Date(), config.demoTimezone);
  if (config.seedDemo && !(await service.exists(config.demoHouseholdId))) {
    await service.createHousehold({ ...seed(), household: { ...seed().household, id: config.demoHouseholdId } });
  }

  const resetDemo = async () => {
    const fresh = seed();
    const current = await store.load(config.demoHouseholdId);
    const next = { ...fresh, household: { ...fresh.household, id: config.demoHouseholdId }, version: (current?.version ?? 0) + 1 };
    await store.save(next, current?.version ?? 0);
  };

  const app = createApp({ config, service, verifier, concierge, outbox, resetDemo });
  return { app, service, store, outbox, verifier };
}

export { SCOPES };
