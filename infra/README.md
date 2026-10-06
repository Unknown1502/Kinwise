# Kinwise on AWS (CDK)

One stack, `Kinwise`, in `us-east-1`:

| Resource | Purpose |
|---|---|
| Lambda (Node 22, ARM64, X-Ray) + API Gateway HTTP API | The hub: MCP server at `/mcp`, Fire TV API, signed Ring ingestion, simulator bridge. Throttled at 25 rps / burst 50 |
| DynamoDB (PITR, encrypted) | One item per household, with optimistic concurrency |
| Cognito user pool + resource server `kinwise` | The Alexa+ two-tier OAuth: `alexa-plus-service` (client_credentials → `mcp:service`), `alexa-plus-account-linking` (auth code + secret), `kinwise-echo-simulator` (public, auth code + PKCE) |
| Secrets Manager | The Ring → hub HMAC ingest secret, and the seed for hosted-demo tokens |
| SNS | Caregiver alerts (optional e-mail subscription) |
| Bedrock AgentCore Runtime + Memory | The concierge (Strands agent, Nova 2 Lite), deployed as a Python code asset |

## Prerequisites

- AWS credentials for the target account (`aws sts get-caller-identity`). The CDK must be bootstrapped once: `npx cdk bootstrap`.
- Bedrock model access to **Amazon Nova 2 Lite** in `us-east-1`. Anthropic models also need a valid payment method, because they're subscribed through AWS Marketplace.
- `node scripts/setup.mjs` has been run at the repo root.

## Deploy

```bash
# 1. Build the concierge bundle (Linux ARM64 wheels, built on any OS with uv; ~65 MB)
cd agents/concierge && uv run python scripts/package.py

# 2. Deploy (from infra/)
cd ../../infra
npx cdk deploy \
  -c authDomainPrefix=kinwise-<something-unique> \
  -c caregiverEmail=you@example.com \
  -c allowedOrigins=http://localhost:5173,http://localhost:5174
```

If step 1 is skipped, the stack deploys without the AgentCore Runtime (output `ConciergeSkipped`), and `/sim/ask` returns 503 until you deploy again.

Context options: `authDomainPrefix`, `callbackUrls`, `allowedOrigins`, `caregiverEmail`, `conciergeModelId` (default `us.amazon.nova-2-lite-v1:0`), `demoTimezone`, `devRoutes` (default `true`; the demo helpers still require a household token when hosted).

## After deploying

```bash
node ../scripts/demo-tokens.mjs        # prints the hub URL plus Asha / Priya / TV demo tokens
```

Point the local front ends at the hosted hub:

```bash
cd packages/echo-sim && VITE_HUB_URL=<ApiUrl> VITE_ASHA_TOKEN=<asha> VITE_PRIYA_TOKEN=<priya> npm run dev
# TV preview: http://localhost:5174/?hub=<ApiUrl>&token=<tv>
```

Run the conformance check against the hosted MCP endpoint:

```bash
HUB_URL=<ApiUrl> RESIDENT_TOKEN=<asha> CAREGIVER_TOKEN=<priya> SERVICE_TOKEN=<client_credentials token> \
  npm run conformance -w @kinwise/hub
```

Get a **service-tier token** the way Alexa+ would (client credentials):

```bash
CLIENT_ID=<AlexaServiceClientId>
SECRET=$(aws cognito-idp describe-user-pool-client --user-pool-id <UserPoolId> --client-id $CLIENT_ID --query UserPoolClient.ClientSecret --output text)
curl -s -u "$CLIENT_ID:$SECRET" -d "grant_type=client_credentials&scope=kinwise/mcp:service" "<CognitoDomain>/oauth2/token"
```

**Account-linked user tokens** (auth code + PKCE, `mcp:tools mcp:resources`): create users `asha` and `priya` in the pool. The hub maps them to the demo household through `USER_DIRECTORY`.

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username asha --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username asha --password '<12+ chars>' --permanent
```

**Ring worker → hosted hub:** set `HUB_URL=<ApiUrl>`, and set `INGEST_SECRET` to the value in the `IngestSecretArn` secret (field `value`).

## Cost

At demo scale, expect a few dollars a month: Lambda, API Gateway, DynamoDB and SNS stay within the free tier, Cognito M2M token requests are a few cents, and AgentCore Runtime and Memory are billed per use. Nova 2 Lite costs about $0.30 / $2.50 per million input / output tokens. Set an AWS Budget alarm anyway.

## Clean up

```bash
npx cdk destroy
```

The table, user pool and log group are configured to be deleted with the stack (demo data only).

## Tests

```bash
npm test -w @kinwise/infra    # synthesizes the stack and asserts auth tiers, ARM64, PITR, throttling, AgentCore wiring
```
