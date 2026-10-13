import { DEMO_HOUSEHOLD_ID } from './seed.js';

/** Twilio WhatsApp credentials. `to` is the caregiver's own WhatsApp number, so they are personal data and live in Secrets Manager. */
export interface WhatsAppCreds {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
}

export interface HubConfig {
  port: number;
  /** Public origin of this hub. When unset (e.g. on Lambda behind API Gateway), it is derived per request. */
  publicBaseUrl?: string;
  authMode: 'dev' | 'cognito';
  cognito?: { userPoolId: string; clientIds: string[]; issuer: string };
  /** username → household member, used in cognito mode. */
  userDirectory: Record<string, { householdId: string; role: 'resident' | 'caregiver'; name: string; memberId?: string }>;
  /** Fire TV device tokens → household. */
  deviceTokens: Record<string, { householdId: string; deviceId: string; name: string }>;
  ingestSecret: string;
  /** Secrets Manager ARN holding the ingest secret (resolved at cold start; overrides ingestSecret). */
  ingestSecretArn?: string;
  /** Secrets Manager ARN holding a seed from which demo persona tokens are derived (hosted demo for judges). */
  demoTokenSeedArn?: string;
  store: 'memory' | 'file' | 'dynamo';
  tableName?: string;
  dataFile: string;
  snsTopicArn?: string;
  /** Phone push to the caregiver through ntfy. The topic is the secret that routes the push, so it must be long. */
  ntfy?: { server: string; topic?: string; /** Secrets Manager ARN holding the topic (resolved at cold start). */ topicSecretArn?: string };
  /** WhatsApp to the caregiver through Twilio: credentials directly (local) or a Secrets Manager ARN (hosted). */
  whatsapp?: { creds?: WhatsAppCreds; secretArn?: string };
  allowedOrigins: string[];
  wwwAuthenticate: boolean;
  conciergeUrl?: string;
  conciergeRuntimeArn?: string;
  devRoutes: boolean;
  seedDemo: boolean;
  demoHouseholdId: string;
  demoTimezone: string;
  /** Absolute URL of the caregiver's recorded Pause message (optional). */
  demoPauseVideoUrl?: string;
  /** Natural voice for the Echo simulator and the TV: Amazon Polly, or off (clients fall back or stay silent). */
  speech: { provider: 'polly' | 'off'; voice: string; engine: 'neural' | 'standard' | 'generative'; region: string };
}

function json<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON in environment value: ${raw.slice(0, 40)}…`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const port = Number(env.PORT ?? 8787);
  const authMode = (env.AUTH_MODE ?? 'dev') as HubConfig['authMode'];
  if (authMode !== 'dev' && authMode !== 'cognito') throw new Error('AUTH_MODE must be dev or cognito');

  const region = env.AWS_REGION ?? 'us-east-1';
  const cognito =
    authMode === 'cognito'
      ? {
          userPoolId: required(env, 'COGNITO_USER_POOL_ID'),
          clientIds: required(env, 'COGNITO_CLIENT_IDS').split(',').map((s) => s.trim()),
          issuer:
            env.AUTH_SERVER_URL ?? `https://cognito-idp.${region}.amazonaws.com/${required(env, 'COGNITO_USER_POOL_ID')}`,
        }
      : undefined;

  const ingestSecretArn = env.INGEST_SECRET_ARN || undefined;
  const ingestSecret = env.INGEST_SECRET ?? (authMode === 'dev' ? 'dev-ingest-secret' : '');
  if (!ingestSecret && !ingestSecretArn) throw new Error('INGEST_SECRET or INGEST_SECRET_ARN is required outside dev mode');

  const isLambda = !!env.AWS_LAMBDA_FUNCTION_NAME;
  return {
    port,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? (isLambda ? undefined : `http://localhost:${port}`))?.replace(/\/$/, ''),
    authMode,
    cognito,
    userDirectory: json(env.USER_DIRECTORY, {}),
    deviceTokens: json(env.DEVICE_TOKENS, {}),
    ingestSecret,
    ingestSecretArn,
    demoTokenSeedArn: env.DEMO_TOKEN_SEED_ARN || undefined,
    store: (env.STORE ?? (env.TABLE_NAME ? 'dynamo' : 'file')) as HubConfig['store'],
    tableName: env.TABLE_NAME,
    dataFile: env.DATA_FILE ?? '.kinwise-data/state.json',
    snsTopicArn: env.SNS_TOPIC_ARN,
    ntfy: loadNtfy(env),
    whatsapp: loadWhatsApp(env),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    wwwAuthenticate: env.MCP_WWW_AUTHENTICATE === 'on',
    conciergeUrl: env.CONCIERGE_URL ?? (authMode === 'dev' ? 'http://localhost:8081' : undefined),
    conciergeRuntimeArn: env.CONCIERGE_RUNTIME_ARN || undefined,
    devRoutes: env.DEV_ROUTES ? env.DEV_ROUTES === 'true' : authMode === 'dev',
    seedDemo: env.SEED_DEMO ? env.SEED_DEMO === 'true' : true,
    demoHouseholdId: env.DEMO_HOUSEHOLD_ID ?? DEMO_HOUSEHOLD_ID,
    demoTimezone: env.DEMO_TIMEZONE ?? 'America/New_York',
    demoPauseVideoUrl: env.DEMO_PAUSE_VIDEO_URL || undefined,
    speech: {
      provider: env.SPEECH === 'polly' ? 'polly' : 'off',
      voice: env.POLLY_VOICE ?? 'Joanna',
      engine: (env.POLLY_ENGINE ?? 'neural') as HubConfig['speech']['engine'],
      region,
    },
  };
}

/** On the public ntfy.sh anyone who knows the topic can read it, so a guessable one is refused. */
export function checkNtfyTopic(topic: string): string {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(topic)) throw new Error('NTFY_TOPIC must be 16-64 letters, digits, - or _ (it acts as a password)');
  return topic;
}

function loadNtfy(env: NodeJS.ProcessEnv): HubConfig['ntfy'] {
  const topic = env.NTFY_TOPIC || undefined;
  const topicSecretArn = env.NTFY_TOPIC_SECRET_ARN || undefined;
  if (!topic && !topicSecretArn) return undefined;
  const server = (env.NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/$/, '');
  if (!server.startsWith('https://')) throw new Error('NTFY_SERVER must be an https:// URL');
  return { server, ...(topic ? { topic: checkNtfyTopic(topic) } : {}), ...(topicSecretArn ? { topicSecretArn } : {}) };
}

/** A complete, well-formed credential set, or undefined (a placeholder secret simply leaves WhatsApp off). */
export function parseWhatsApp(raw: unknown): WhatsAppCreds | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const { accountSid, authToken, from, to } = r;
  if (typeof accountSid !== 'string' || !/^AC[0-9a-f]{32}$/i.test(accountSid)) return undefined;
  if (typeof authToken !== 'string' || !authToken) return undefined;
  const number = /^whatsapp:\+\d{8,15}$/;
  if (typeof from !== 'string' || !number.test(from) || typeof to !== 'string' || !number.test(to)) return undefined;
  return { accountSid, authToken, from, to };
}

function loadWhatsApp(env: NodeJS.ProcessEnv): HubConfig['whatsapp'] {
  const secretArn = env.WHATSAPP_SECRET_ARN || undefined;
  const creds = parseWhatsApp({ accountSid: env.WHATSAPP_ACCOUNT_SID, authToken: env.WHATSAPP_AUTH_TOKEN, from: env.WHATSAPP_FROM, to: env.WHATSAPP_TO });
  if (!secretArn && !creds) return undefined;
  return { ...(creds ? { creds } : {}), ...(secretArn ? { secretArn } : {}) };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}
