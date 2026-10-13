import type { Identity } from './auth/identity.js';
import { demoTokenIdentities, readSecret } from './auth/secrets.js';
import { ChainVerifier, CognitoTokenVerifier, StaticTokenVerifier, devTokens, type TokenVerifier } from './auth/verify.js';
import { checkNtfyTopic, type HubConfig } from './config.js';
import { AgentCoreConcierge, HttpConcierge, type ConciergeClient } from './http/concierge.js';
import { createApp } from './http/app.js';
import { demoHousehold } from './seed.js';
import { KinwiseService } from './services/kinwise.js';
import { PollySynth, type SpeechSynth } from './speech/speech.js';
import { ackKey, signAck } from './services/ackLink.js';
import { MultiNotifier, NtfyNotifier, OutboxNotifier, SnsNotifier, type Notifier } from './services/notifier.js';
import { DynamoStore } from './store/dynamo.js';
import { MemoryStore } from './store/memory.js';
import type { Store } from './store/store.js';

/** Resolve Secrets Manager references once per cold start. */
async function resolveSecrets(config: HubConfig): Promise<{ config: HubConfig; demoIdentities: Record<string, Identity> }> {
  const resolved = { ...config };
  if (config.ingestSecretArn) resolved.ingestSecret = await readSecret(config.ingestSecretArn);
  if (config.ntfy?.topicSecretArn) resolved.ntfy = { ...config.ntfy, topic: checkNtfyTopic(await readSecret(config.ntfy.topicSecretArn)) };
  const demoIdentities = config.demoTokenSeedArn
    ? demoTokenIdentities(await readSecret(config.demoTokenSeedArn), config.demoHouseholdId)
    : {};
  return { config: resolved, demoIdentities };
}

/** `inject` lets tests swap in a fake voice instead of calling Amazon Polly, and a fake network for the phone push. */
export async function bootstrap(input: HubConfig, inject: { speech?: SpeechSynth; fetch?: typeof globalThis.fetch } = {}) {
  const { config, demoIdentities } = await resolveSecrets(input);

  const store: Store =
    config.store === 'dynamo'
      ? new DynamoStore(config.tableName ?? (() => { throw new Error('TABLE_NAME is required for STORE=dynamo'); })())
      : new MemoryStore(config.store === 'file' ? config.dataFile : undefined);

  const outbox = new OutboxNotifier();
  const channels: Notifier[] = [outbox];
  if (config.snsTopicArn) channels.push(new SnsNotifier(config.snsTopicArn));
  if (config.ntfy?.topic) {
    const ntfy = { server: config.ntfy.server, topic: config.ntfy.topic };
    const key = ackKey(config.ingestSecret);
    channels.push(
      new NtfyNotifier({
        ...ntfy,
        fetch: inject.fetch,
        // Without a public address the push still goes out, just without the confirm button.
        ackUrl: (n) => (n.callId && config.publicBaseUrl ? `${config.publicBaseUrl}/ack/${signAck(key, { householdId: n.householdId, callId: n.callId }, Date.now())}` : undefined),
      }),
    );
  }
  const notifier: Notifier = channels.length > 1 ? new MultiNotifier(channels) : outbox;
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

  const speech: SpeechSynth | undefined =
    inject.speech ??
    (config.speech.provider === 'polly' ? new PollySynth(config.speech.voice, config.speech.engine, config.speech.region) : undefined);

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

  const app = createApp({ config, service, verifier, concierge, outbox, resetDemo, speech });
  return { app, service, store, outbox, verifier };
}
