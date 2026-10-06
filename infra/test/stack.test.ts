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
