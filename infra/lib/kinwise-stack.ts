import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface KinwiseStackProps extends StackProps {
  /** Repository root (contains packages/ and agents/). */
  repoRoot: string;
  /** Cognito hosted-domain prefix (must be globally unique). */
  authDomainPrefix: string;
  /** OAuth redirect URIs for the account-linking and Echo simulator clients. */
  callbackUrls: string[];
  /** Browser origins allowed to call the hub (Echo simulator, TV preview). */
  allowedOrigins: string[];
  /** Optional e-mail subscribed to caregiver alerts. */
  caregiverEmail?: string;
  /** Push the caregiver's phone through ntfy (a random topic is generated into Secrets Manager). Default true. */
  phonePush?: boolean;
  /** Wake the hub with one-time EventBridge Scheduler schedules for the 2-minute re-send, so it works with the TV off. Default true. */
  followUp?: boolean;
  /** Send text messages (Amazon SNS SMS) to the numbers caregivers set. Off by default: it needs sns:Publish on every resource, which phone numbers force, and costs money per message. */
  sms?: boolean;
  /** Create the secret that holds Twilio WhatsApp credentials for caregiver messages (you fill it in). Default true. */
  whatsapp?: boolean;
  /** ntfy server, https only. Default https://ntfy.sh. */
  ntfyServer?: string;
  conciergeModelId: string;
  demoTimezone: string;
  /** Keep the auth-protected demo helpers (/dev/*) enabled for the judges' walkthrough. */
  devRoutes: boolean;
  /**
   * AgentCore Runtime tracing (X-Ray → CloudWatch). Requires X-Ray "Transaction Search" in the account
   * (trace segment destination = CloudWatch Logs); see infra/README.md. Default true.
   */
  tracing?: boolean;
}

/**
 * Kinwise on AWS:
 *  - hub (Alexa+ MCP server, Fire TV API, event ingestion) on Lambda (ARM64) behind an HTTP API
 *  - DynamoDB household state, SNS caregiver alerts, Secrets Manager for the ingest secret and demo-token seed
 *  - Cognito with Alexa+'s two-tier OAuth: client_credentials (mcp:service) + auth code/PKCE (mcp:tools, mcp:resources)
 *  - the concierge (Strands agent) on Bedrock AgentCore Runtime, with AgentCore Memory, calling Nova 2 Lite
 */
export class KinwiseStack extends Stack {
  constructor(scope: Construct, id: string, props: KinwiseStackProps) {
    super(scope, id, props);

    // ── State, alerts, secrets ──
    const table = new dynamodb.Table(this, 'HouseholdState', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY, // hackathon demo data only
    });

    const alerts = new sns.Topic(this, 'CaregiverAlerts', { displayName: 'Kinwise caregiver alerts' });
    if (props.caregiverEmail) alerts.addSubscription(new subs.EmailSubscription(props.caregiverEmail));

    const ingestSecret = new secrets.Secret(this, 'IngestSecret', {
      description: 'HMAC secret shared by the Ring worker and the hub (/events/visitor)',
      generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'value', passwordLength: 48, excludePunctuation: true },
    });
    const demoSeed = new secrets.Secret(this, 'DemoTokenSeed', {
      description: 'Seed for hosted-demo persona tokens (print them with scripts/demo-tokens.mjs)',
      generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'seed', passwordLength: 48, excludePunctuation: true },
    });

    // The topic that routes the push to Meera's phone is a password on the public ntfy.sh, so the stack
    // generates a long random one and keeps it here; read it once to subscribe the phone (see infra/README.md).
    const ntfyTopic =
      props.phonePush === false
        ? undefined
        : new secrets.Secret(this, 'NtfyTopic', {
            description: 'ntfy topic that carries caregiver push notifications. Subscribe the caregiver phone to it; treat it like a password.',
            generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'value', passwordLength: 32, excludePunctuation: true },
          });

    // Twilio WhatsApp credentials and the caregiver's own number: personal data, so a secret, never an env var.
    // The stack only creates it with a placeholder; fill it in once (infra/README.md). Until then WhatsApp stays off.
    const whatsappSecret =
      props.whatsapp === false
        ? undefined
        : new secrets.Secret(this, 'WhatsAppTwilio', {
            description: 'Twilio WhatsApp credentials and the caregiver number. Replace the placeholder with JSON: accountSid, authToken, from, to.',
            generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'placeholder', passwordLength: 8, excludePunctuation: true },
          });

    // ── Cognito: Alexa+ two-tier OAuth ──
    const userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: 'kinwise-users',
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      passwordPolicy: { minLength: 12, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const domain = userPool.addDomain('Domain', { cognitoDomain: { domainPrefix: props.authDomainPrefix } });

    const mcpScope = (name: string, description: string) => new cognito.ResourceServerScope({ scopeName: name, scopeDescription: description });
    const service = mcpScope('mcp:service', 'Discover Kinwise tools (initialize, tools/list)');
    const tools = mcpScope('mcp:tools', 'Call Kinwise tools on behalf of a household member');
    const resources = mcpScope('mcp:resources', 'Read Kinwise MCP Apps UI resources');
    const rs = userPool.addResourceServer('Mcp', { identifier: 'kinwise', userPoolResourceServerName: 'Kinwise MCP', scopes: [service, tools, resources] });
    const userScopes = [
      cognito.OAuthScope.OPENID,
      cognito.OAuthScope.resourceServer(rs, service),
      cognito.OAuthScope.resourceServer(rs, tools),
      cognito.OAuthScope.resourceServer(rs, resources),
    ];

    const alexaService = userPool.addClient('AlexaServiceClient', {
      userPoolClientName: 'alexa-plus-service',
      generateSecret: true,
      oAuth: { flows: { clientCredentials: true }, scopes: [cognito.OAuthScope.resourceServer(rs, service)] },
      accessTokenValidity: Duration.hours(1),
    });
    const alexaLinking = userPool.addClient('AlexaAccountLinkingClient', {
      userPoolClientName: 'alexa-plus-account-linking',
      generateSecret: true,
      preventUserExistenceErrors: true,
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: userScopes, callbackUrls: props.callbackUrls },
      accessTokenValidity: Duration.hours(1),
    });
    const echoSim = userPool.addClient('EchoSimClient', {
      userPoolClientName: 'kinwise-echo-simulator',
      generateSecret: false, // public client: auth code + PKCE
      preventUserExistenceErrors: true,
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: userScopes, callbackUrls: props.callbackUrls },
      accessTokenValidity: Duration.hours(1),
    });

    // ── Hub on Lambda ──
    const hubLogs = new logs.LogGroup(this, 'HubLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    const hub = new nodejs.NodejsFunction(this, 'Hub', {
      description: 'Kinwise hub: Alexa+ MCP server, Fire TV API, Ring event ingestion',
      entry: join(props.repoRoot, 'packages/hub/src/lambda.ts'),
      handler: 'handler',
      projectRoot: props.repoRoot,
      depsLockFilePath: join(props.repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(29),
      logGroup: hubLogs,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        minify: true,
        sourceMap: true,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        AUTH_MODE: 'cognito',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_IDS: [alexaService, alexaLinking, echoSim].map((c) => c.userPoolClientId).join(','),
        USER_DIRECTORY: JSON.stringify({
          asha: { householdId: 'hh-asha', role: 'resident', name: 'Asha' },
          priya: { householdId: 'hh-asha', role: 'caregiver', name: 'Meera' },
        }),
        STORE: 'dynamo',
        TABLE_NAME: table.tableName,
        SNS_TOPIC_ARN: alerts.topicArn,
        INGEST_SECRET_ARN: ingestSecret.secretArn,
        DEMO_TOKEN_SEED_ARN: demoSeed.secretArn,
        ALLOWED_ORIGINS: props.allowedOrigins.join(','),
        DEV_ROUTES: String(props.devRoutes),
        SEED_DEMO: 'true',
        DEMO_TIMEZONE: props.demoTimezone,
        // Natural voice for the Echo simulator and the Fire TV (Amazon Polly neural).
        SPEECH: 'polly',
        POLLY_VOICE: 'Joanna',
        POLLY_ENGINE: 'neural',
      },
    });
    if (whatsappSecret) {
      hub.addEnvironment('WHATSAPP_SECRET_ARN', whatsappSecret.secretArn);
      whatsappSecret.grantRead(hub);
    }
    if (ntfyTopic) {
      hub.addEnvironment('NTFY_TOPIC_SECRET_ARN', ntfyTopic.secretArn);
      hub.addEnvironment('NTFY_SERVER', props.ntfyServer ?? 'https://ntfy.sh');
      ntfyTopic.grantRead(hub);
    }
    if (props.followUp !== false) {
      // EventBridge Scheduler invokes the hub directly (not through the API) at the moment a follow-up is due.
      const schedulerRole = new iam.Role(this, 'FollowUpSchedulerRole', {
        assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
          conditions: {
            StringEquals: { 'aws:SourceAccount': this.account },
            // Only this app's own follow-up schedules can use the role (confused-deputy protection).
            ArnLike: { 'aws:SourceArn': `arn:aws:scheduler:${this.region}:${this.account}:schedule/default/kinwise-followup-*` },
          },
        }),
        description: 'Lets EventBridge Scheduler invoke the Kinwise hub for the caregiver follow-up',
      });
      hub.grantInvoke(schedulerRole);
      hub.addEnvironment('FOLLOWUP_ROLE_ARN', schedulerRole.roleArn);
      hub.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['scheduler:CreateSchedule'],
          resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/kinwise-followup-*`],
        }),
      );
      hub.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['iam:PassRole'],
          resources: [schedulerRole.roleArn],
          conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
        }),
      );
    }
    table.grantReadWriteData(hub);
    // SynthesizeSpeech has no resource-level permissions, so it can only be granted on "*".
    hub.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
    alerts.grantPublish(hub);
    // A caregiver's e-mail is subscribed to this topic with a filter on their own id.
    hub.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:Subscribe', 'sns:ListSubscriptionsByTopic'], resources: [alerts.topicArn] }));
    // Removing or inspecting a subscription is authorized on the SUBSCRIPTION (the topic ARN plus ":<id>"); a grant on the bare
    // topic ARN is denied (the IAM policy simulator showed it), which would make a confirmed address impossible to change.
    hub.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:Unsubscribe', 'sns:GetSubscriptionAttributes'], resources: [`${alerts.topicArn}:*`] }));
    if (props.sms === true) {
      // Publishing to a phone number has no resource to scope to, so it can only be granted on "*" (like Polly).
      // The account's monthly SMS spend limit is what bounds the cost.
      hub.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['*'] }));
      hub.addEnvironment('SMS_ENABLED', 'true');
    }
    ingestSecret.grantRead(hub);
    demoSeed.grantRead(hub);

    const api = new apigw.HttpApi(this, 'Api', {
      apiName: 'kinwise-hub',
      description: 'Kinwise hub (MCP 2025-11-25 Streamable HTTP at /mcp)',
      defaultIntegration: new integrations.HttpLambdaIntegration('HubIntegration', hub),
    });
    // The "I'm calling now" button in the push links back here, so the hub needs its own address.
    hub.addEnvironment('PUBLIC_BASE_URL', api.apiEndpoint);
    const stage = api.defaultStage?.node.defaultChild as apigw.CfnStage | undefined;
    if (stage) stage.defaultRouteSettings = { throttlingBurstLimit: 50, throttlingRateLimit: 25 };

    // ── Concierge on Bedrock AgentCore Runtime ──
    const bundle = join(props.repoRoot, 'agents/concierge/build/package');
    if (existsSync(join(bundle, 'main.py'))) {
      const memory = new agentcore.Memory(this, 'ConciergeMemory', {
        memoryName: 'kinwise_concierge_memory',
        description: 'Short-term conversation memory for the Kinwise concierge',
        expirationDuration: Duration.days(30),
      });
      const concierge = new agentcore.Runtime(this, 'Concierge', {
        runtimeName: 'kinwise_concierge',
        description: 'Simulated Alexa+ orchestrator (Strands agent) that uses the Kinwise MCP server',
        agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromCodeAsset({
          path: bundle,
          runtime: agentcore.AgentCoreRuntime.PYTHON_3_12,
          entrypoint: ['main.py'],
        }),
        environmentVariables: {
          CONCIERGE_MODE: 'bedrock',
          CONCIERGE_MODEL_ID: props.conciergeModelId,
          PORT: '8080',
          AGENTCORE_MEMORY_ID: memory.memoryId,
        },
        tracingEnabled: props.tracing ?? true,
      });
      concierge.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
        }),
      );
      memory.grantRead(concierge);
      memory.grantWrite(concierge);
      concierge.grantInvoke(hub);
      hub.addEnvironment('CONCIERGE_RUNTIME_ARN', concierge.agentRuntimeArn);
      new CfnOutput(this, 'ConciergeRuntimeArn', { value: concierge.agentRuntimeArn });
      new CfnOutput(this, 'ConciergeMemoryId', { value: memory.memoryId });
    } else {
      new CfnOutput(this, 'ConciergeSkipped', {
        value: 'Run `uv run python scripts/package.py` in agents/concierge, then deploy again to add the AgentCore Runtime',
      });
    }

    // ── Outputs ──
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'McpEndpoint', { value: `${api.apiEndpoint}/mcp` });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'AlexaServiceClientId', { value: alexaService.userPoolClientId });
    new CfnOutput(this, 'AlexaAccountLinkingClientId', { value: alexaLinking.userPoolClientId });
    new CfnOutput(this, 'EchoSimClientId', { value: echoSim.userPoolClientId });
    new CfnOutput(this, 'IngestSecretArn', { value: ingestSecret.secretArn });
    new CfnOutput(this, 'DemoTokenSeedArn', { value: demoSeed.secretArn });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
