import type { Identity } from './auth/identity.js';
import { demoTokenIdentities, readSecret } from './auth/secrets.js';
import { ChainVerifier, CognitoTokenVerifier, StaticTokenVerifier, devTokens, type TokenVerifier } from './auth/verify.js';
import { checkNtfyTopic, parseWhatsApp, type HubConfig } from './config.js';
import { AgentCoreConcierge, HttpConcierge, type ConciergeClient } from './http/concierge.js';
import { createApp } from './http/app.js';
import { demoHousehold } from './seed.js';
import { KinwiseService, type Clock } from './services/kinwise.js';
import { PollySynth, type SpeechSynth } from './speech/speech.js';
import { ackKey, signAck } from './services/ackLink.js';
import { MultiNotifier, NtfyNotifier, OutboxNotifier, SnsNotifier, WhatsAppNotifier, type Notifier } from './services/notifier.js';
import { DynamoStore } from './store/dynamo.js';
import { MemoryStore } from './store/memory.js';
import type { Store } from './store/store.js';

/** Resolve Secrets Manager references once per cold start. */
async function resolveSecrets(config: HubConfig): Promise<{ config: HubConfig; demoIdentities: Record<string, Identity> }> {
  const resolved = { ...config };
  if (config.ingestSecretArn) resolved.ingestSecret = await readSecret(config.ingestSecretArn);
  if (config.ntfy?.topicSecretArn) resolved.ntfy = { ...config.ntfy, topic: checkNtfyTopic(await readSecret(config.ntfy.topicSecretArn)) };
  if (config.whatsapp?.secretArn) {
    let creds;
    try {
      creds = parseWhatsApp(JSON.parse(await readSecret(config.whatsapp.secretArn)));
    } catch {
      creds = undefined;
    }
    // A placeholder or half-filled secret leaves WhatsApp off; the hub still starts and the TV stays honest.
    if (!creds) console.warn('[whatsapp] secret is not filled in yet: WhatsApp is off');
    resolved.whatsapp = { ...config.whatsapp, creds };
  }
  const demoIdentities = config.demoTokenSeedArn
    ? demoTokenIdentities(await readSecret(config.demoTokenSeedArn), config.demoHouseholdId)
    : {};
  return { config: resolved, demoIdentities };
}

/** `inject` lets tests swap in a fake voice instead of calling Amazon Polly, and a fake network for the phone push, and a fixed clock so a test does not depend on the time of day. */
export async function bootstrap(input: HubConfig, inject: { speech?: SpeechSynth; fetch?: typeof globalThis.fetch; clock?: Clock } = {}) {
  const { config, demoIdentities } = await resolveSecrets(input);

  const store: Store =
    config.store === 'dynamo'
      ? new DynamoStore(config.tableName ?? (() => { throw new Error('TABLE_NAME is required for STORE=dynamo'); })())
      : new MemoryStore(config.store === 'file' ? config.dataFile : undefined);

  const outbox = new OutboxNotifier();
  const channels: Notifier[] = [outbox];
  const ackKeyValue = ackKey(config.ingestSecret);
  // Without a public address a message still goes out, just without the confirm link.
  const ackUrl = (n: { callId?: string; householdId: string }) =>
    n.callId && config.publicBaseUrl ? `${config.publicBaseUrl}/ack/${signAck(ackKeyValue, { householdId: n.householdId, callId: n.callId }, Date.now())}` : undefined;
  if (config.snsTopicArn) channels.push(new SnsNotifier(config.snsTopicArn, ackUrl));
  if (config.ntfy?.topic) {
    channels.push(new NtfyNotifier({ server: config.ntfy.server, topic: config.ntfy.topic, fetch: inject.fetch, ackUrl }));
  }
  if (config.whatsapp?.creds) channels.push(new WhatsAppNotifier({ ...config.whatsapp.creds, fetch: inject.fetch, ackUrl }));
  const notifier: Notifier = channels.length > 1 ? new MultiNotifier(channels) : outbox;
  const service = new KinwiseService({ store, notifier, clock: inject.clock });

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
    const fresh = demoHousehold(inject.clock?.now() ?? new Date(), config.demoTimezone, config.demoPauseVideoUrl);
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
