import type { Identity } from './auth/identity.js';
import { demoTokenIdentities, readSecret } from './auth/secrets.js';
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

/** Resolve Secrets Manager references once per cold start. */
async function resolveSecrets(config: HubConfig): Promise<{ config: HubConfig; demoIdentities: Record<string, Identity> }> {
  const resolved = { ...config };
  if (config.ingestSecretArn) resolved.ingestSecret = await readSecret(config.ingestSecretArn);
  const demoIdentities = config.demoTokenSeedArn
    ? demoTokenIdentities(await readSecret(config.demoTokenSeedArn), config.demoHouseholdId)
    : {};
  return { config: resolved, demoIdentities };
}

export async function bootstrap(input: HubConfig) {
  const { config, demoIdentities } = await resolveSecrets(input);

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
      new StaticTokenVerifier({ ...deviceTokens, ...demoIdentities }),
      new CognitoTokenVerifier(config.cognito, config.userDirectory, config.demoHouseholdId),
    ]);
  } else {
    verifier = new StaticTokenVerifier({ ...devTokens(config.demoHouseholdId), ...deviceTokens, ...demoIdentities });
  }

  const concierge: ConciergeClient | undefined = config.conciergeRuntimeArn
    ? new AgentCoreConcierge(config.conciergeRuntimeArn)
    : config.conciergeUrl
      ? new HttpConcierge(config.conciergeUrl)
      : undefined;

  const seed = () => {
    const fresh = demoHousehold(new Date(), config.demoTimezone, config.demoPauseVideoUrl);
    return { ...fresh, household: { ...fresh.household, id: config.demoHouseholdId } };
  };
  if (config.seedDemo && !(await service.exists(config.demoHouseholdId))) {
    await service.createHousehold(seed());
  }

  const resetDemo = async () => {
    const current = await store.load(config.demoHouseholdId);
    await store.save({ ...seed(), version: (current?.version ?? 0) + 1 }, current?.version ?? 0);
  };

  const app = createApp({ config, service, verifier, concierge, outbox, resetDemo });
  return { app, service, store, outbox, verifier };
}
