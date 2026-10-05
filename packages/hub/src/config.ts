import { DEMO_HOUSEHOLD_ID } from './seed.js';

export interface HubConfig {
  port: number;
  publicBaseUrl: string;
  authMode: 'dev' | 'cognito';
  cognito?: { userPoolId: string; clientIds: string[]; issuer: string };
  /** username → household member, used in cognito mode. */
  userDirectory: Record<string, { householdId: string; role: 'resident' | 'caregiver'; name: string; memberId?: string }>;
  /** Fire TV device tokens → household (cognito mode; dev mode uses `dev-tv`). */
  deviceTokens: Record<string, { householdId: string; deviceId: string; name: string }>;
  ingestSecret: string;
  store: 'memory' | 'file' | 'dynamo';
  tableName?: string;
  dataFile: string;
  snsTopicArn?: string;
  allowedOrigins: string[];
  wwwAuthenticate: boolean;
  conciergeUrl?: string;
  conciergeRuntimeArn?: string;
  devRoutes: boolean;
  seedDemo: boolean;
  demoHouseholdId: string;
  demoTimezone: string;
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

  const ingestSecret = env.INGEST_SECRET ?? (authMode === 'dev' ? 'dev-ingest-secret' : '');
  if (!ingestSecret) throw new Error('INGEST_SECRET is required outside dev mode');

  return {
    port,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    authMode,
    cognito,
    userDirectory: json(env.USER_DIRECTORY, {}),
    deviceTokens: json(env.DEVICE_TOKENS, {}),
    ingestSecret,
    store: (env.STORE ?? (env.TABLE_NAME ? 'dynamo' : 'file')) as HubConfig['store'],
    tableName: env.TABLE_NAME,
    dataFile: env.DATA_FILE ?? '.kinwise-data/state.json',
    snsTopicArn: env.SNS_TOPIC_ARN,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    wwwAuthenticate: env.MCP_WWW_AUTHENTICATE === 'on',
    conciergeUrl: env.CONCIERGE_URL ?? (authMode === 'dev' ? 'http://localhost:8080' : undefined),
    conciergeRuntimeArn: env.CONCIERGE_RUNTIME_ARN,
    devRoutes: env.DEV_ROUTES ? env.DEV_ROUTES === 'true' : authMode === 'dev',
    seedDemo: env.SEED_DEMO ? env.SEED_DEMO === 'true' : true,
    demoHouseholdId: env.DEMO_HOUSEHOLD_ID ?? DEMO_HOUSEHOLD_ID,
    demoTimezone: env.DEMO_TIMEZONE ?? 'America/New_York',
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}
