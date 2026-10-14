import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { KinwiseStack } from '../lib/kinwise-stack.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasConciergeBundle = existsSync(join(repoRoot, 'agents/concierge/build/package/main.py'));

let t: Template;
beforeAll(() => {
  const app = new App();
  const stack = new KinwiseStack(app, 'Test', {
    env: { account: '123456789012', region: 'us-east-1' },
    repoRoot,
    authDomainPrefix: 'kinwise-test',
    callbackUrls: ['http://localhost:5173/callback'],
    allowedOrigins: ['http://localhost:5173'],
    conciergeModelId: 'us.amazon.nova-2-lite-v1:0',
    demoTimezone: 'America/New_York',
    devRoutes: true,
  });
  t = Template.fromStack(stack);
}, 120_000);

describe('KinwiseStack', () => {
  it('runs the hub on ARM64 Node 22 with Cognito auth and no plaintext secrets', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      TracingConfig: { Mode: 'Active' },
      Environment: {
        Variables: Match.objectLike({
          AUTH_MODE: 'cognito',
          STORE: 'dynamo',
          INGEST_SECRET_ARN: Match.anyValue(),
          DEMO_TOKEN_SEED_ARN: Match.anyValue(),
        }),
      },
    });
    const fns = t.findResources('AWS::Lambda::Function');
    for (const fn of Object.values(fns)) {
      const vars = (fn as any).Properties?.Environment?.Variables ?? {};
      expect(vars).not.toHaveProperty('INGEST_SECRET');
    }
  });

  it('gives the hub a natural voice: Amazon Polly, synthesize only', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ SPEECH: 'polly', POLLY_VOICE: 'Joanna', POLLY_ENGINE: 'neural' }) },
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: 'polly:SynthesizeSpeech', Effect: 'Allow', Resource: '*' })]),
      },
    });
  });

  it('pushes to the caregiver phone: a generated secret topic, the hub reads it, and knows its own address', () => {
    t.hasResourceProperties('AWS::SecretsManager::Secret', {
      Description: Match.stringLikeRegexp('ntfy topic'),
      GenerateSecretString: Match.objectLike({ GenerateStringKey: 'value', PasswordLength: 32, ExcludePunctuation: true }),
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ NTFY_TOPIC_SECRET_ARN: Match.anyValue(), NTFY_SERVER: 'https://ntfy.sh', PUBLIC_BASE_URL: Match.anyValue() }),
      },
    });
    const fns = Object.values(t.findResources('AWS::Lambda::Function')) as any[];
    for (const fn of fns) expect(fn.Properties?.Environment?.Variables ?? {}).not.toHaveProperty('NTFY_TOPIC');
  });

  it('keeps WhatsApp credentials in a secret the hub can read, not in the environment', () => {
    t.hasResourceProperties('AWS::SecretsManager::Secret', { Description: Match.stringLikeRegexp('Twilio WhatsApp') });
    t.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ WHATSAPP_SECRET_ARN: Match.anyValue() }) } });
    for (const fn of Object.values(t.findResources('AWS::Lambda::Function')) as any[]) {
      const vars = fn.Properties?.Environment?.Variables ?? {};
      for (const k of ['WHATSAPP_AUTH_TOKEN', 'WHATSAPP_TO', 'WHATSAPP_ACCOUNT_SID']) expect(vars).not.toHaveProperty(k);
    }
  });

  const statementsOf = (tpl: Template) =>
    (Object.values(tpl.findResources('AWS::IAM::Policy')) as any[]).flatMap((p) => p.Properties.PolicyDocument.Statement as any[]);

  it('lets the hub manage caregiver subscriptions where SNS really checks them: the topic to subscribe and list, the subscriptions to remove and inspect', () => {
    const st = statementsOf(t);
    const onTopic = st.find((x) => JSON.stringify(x.Action) === JSON.stringify(['sns:Subscribe', 'sns:ListSubscriptionsByTopic']));
    expect(JSON.stringify(onTopic.Resource)).toContain('CaregiverAlerts');
    expect(JSON.stringify(onTopic.Resource)).not.toContain(':*"'); // the topic itself
    const onSubs = st.find((x) => JSON.stringify(x.Action) === JSON.stringify(['sns:Unsubscribe', 'sns:GetSubscriptionAttributes']));
    // A subscription's ARN is the topic ARN plus ":<id>"; a policy on the bare topic ARN would deny Unsubscribe (found by the IAM policy simulator).
    expect(JSON.stringify(onSubs.Resource)).toMatch(/CaregiverAlerts[^"]*"[^]*:\*/);
  });

  it('grants SNS publish on every resource (needed for texting a phone number) only when SMS is switched on', () => {
    const publishAll = (tpl: Template) => statementsOf(tpl).some((x) => x.Action === 'sns:Publish' && x.Resource === '*');
    expect(publishAll(t)).toBe(false);
    for (const fn of Object.values(t.findResources('AWS::Lambda::Function')) as any[]) expect(fn.Properties?.Environment?.Variables ?? {}).not.toHaveProperty('SMS_ENABLED');
    const on = Template.fromStack(
      new KinwiseStack(new App(), 'WithSms', {
        env: { account: '123456789012', region: 'us-east-1' },
        repoRoot,
        authDomainPrefix: 'kinwise-test',
        callbackUrls: ['http://localhost:5173/callback'],
        allowedOrigins: ['http://localhost:5173'],
        conciergeModelId: 'us.amazon.nova-2-lite-v1:0',
        demoTimezone: 'America/New_York',
        devRoutes: true,
        sms: true,
      }),
    );
    expect(publishAll(on)).toBe(true);
    on.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ SMS_ENABLED: 'true' }) } });
  }, 120_000);

  it('wakes the hub with one-time schedules: a role that can only invoke the hub, and a hub that can only create kinwise-followup schedules', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Principal: { Service: 'scheduler.amazonaws.com' }, Condition: { StringEquals: { 'aws:SourceAccount': '123456789012' }, ArnLike: { 'aws:SourceArn': Match.stringLikeRegexp('schedule/default/kinwise-followup-[*]$') } } })]) },
    });
    const statements = (Object.values(t.findResources('AWS::IAM::Policy')) as any[]).flatMap((p) => p.Properties.PolicyDocument.Statement as any[]);
    const create = statements.find((x) => x.Action === 'scheduler:CreateSchedule');
    expect(JSON.stringify(create.Resource)).toContain('schedule/default/kinwise-followup-*'); // only its own schedules, not every schedule
    const pass = statements.find((x) => x.Action === 'iam:PassRole');
    expect(pass.Condition).toEqual({ StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } });
    expect(statements.some((x) => x.Action === 'lambda:InvokeFunction' && x.Effect === 'Allow')).toBe(true); // the scheduler role may invoke the hub
    t.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ FOLLOWUP_ROLE_ARN: Match.anyValue() }) } });
  });

  it('can leave phone push out', () => {
    const app = new App();
    const off = Template.fromStack(
      new KinwiseStack(app, 'NoPush', {
        env: { account: '123456789012', region: 'us-east-1' },
        repoRoot,
        authDomainPrefix: 'kinwise-test',
        callbackUrls: ['http://localhost:5173/callback'],
        allowedOrigins: ['http://localhost:5173'],
        conciergeModelId: 'us.amazon.nova-2-lite-v1:0',
        demoTimezone: 'America/New_York',
        devRoutes: true,
        phonePush: false,
      }),
    );
    for (const fn of Object.values(off.findResources('AWS::Lambda::Function')) as any[]) {
      expect(fn.Properties?.Environment?.Variables ?? {}).not.toHaveProperty('NTFY_TOPIC_SECRET_ARN');
    }
  }, 120_000);

  it('implements the Alexa+ two-tier OAuth scopes', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'kinwise',
      Scopes: [
        Match.objectLike({ ScopeName: 'mcp:service' }),
        Match.objectLike({ ScopeName: 'mcp:tools' }),
        Match.objectLike({ ScopeName: 'mcp:resources' }),
      ],
    });
    // The service (client_credentials) client gets the discovery scope only.
    const clients = Object.values(t.findResources('AWS::Cognito::UserPoolClient')) as any[];
    const svc = clients.find((c) => c.Properties.ClientName === 'alexa-plus-service')!;
    expect(svc.Properties).toMatchObject({ AllowedOAuthFlows: ['client_credentials'], GenerateSecret: true });
    const svcScopes = JSON.stringify(svc.Properties.AllowedOAuthScopes);
    expect(svc.Properties.AllowedOAuthScopes).toHaveLength(1);
    expect(svcScopes).toContain('/mcp:service');
    expect(svcScopes).not.toMatch(/mcp:tools|mcp:resources/);
    const linking = clients.find((c) => c.Properties.ClientName === 'alexa-plus-account-linking')!;
    expect(linking.Properties.AllowedOAuthFlows).toEqual(['code']);
    expect(JSON.stringify(linking.Properties.AllowedOAuthScopes)).toMatch(/mcp:tools[\s\S]*mcp:resources/);
    // The Echo simulator is a public client (auth code + PKCE, no secret).
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'kinwise-echo-simulator',
      AllowedOAuthFlows: ['code'],
      GenerateSecret: false,
    });
  });

  it('stores household state in an encrypted table with point-in-time recovery', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it('throttles the public API', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingBurstLimit: 50, ThrottlingRateLimit: 25 },
    });
  });

  it.runIf(hasConciergeBundle)('hosts the concierge on AgentCore Runtime with Memory and wires it to the hub', () => {
    t.resourceCountIs('AWS::BedrockAgentCore::Runtime', 1);
    t.resourceCountIs('AWS::BedrockAgentCore::Memory', 1);
    t.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      EnvironmentVariables: Match.objectLike({ CONCIERGE_MODE: 'bedrock', PORT: '8080' }),
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CONCIERGE_RUNTIME_ARN: Match.anyValue() }) },
    });
  });
});
