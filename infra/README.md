# Kinwise on AWS (CDK)

One stack, `Kinwise`, in `us-east-1`:

| Resource | Purpose |
|---|---|
| Lambda (Node 22, ARM64, X-Ray) + API Gateway HTTP API | The hub: MCP server at `/mcp`, Fire TV API, signed Ring ingestion, simulator bridge. Throttled at 25 rps / burst 50 |
| DynamoDB (PITR, encrypted) | One item per household, with optimistic concurrency |
| Cognito user pool + resource server `kinwise` | The Alexa+ two-tier OAuth: `alexa-plus-service` (client_credentials → `mcp:service`), `alexa-plus-account-linking` (auth code + secret), `kinwise-echo-simulator` (public, auth code + PKCE) |
| Secrets Manager | The Ring → hub HMAC ingest secret, and the seed for hosted-demo tokens |
| SNS | Caregiver alerts (optional e-mail subscription) |
| Secrets Manager (`WhatsAppTwilio`) | Twilio WhatsApp credentials and the caregiver's number (you fill it in once) |
| Secrets Manager (`NtfyTopic`) | The random ntfy topic that carries the push to the caregiver's phone |
| Bedrock AgentCore Runtime + Memory | The concierge (Strands agent, Nova 2 Lite), deployed as a Python code asset |
| Amazon Polly (neural, voice `Joanna`) | The natural voice for the TV and the Echo simulator. The hub may only call `polly:SynthesizeSpeech`; settings `SPEECH`, `POLLY_VOICE`, `POLLY_ENGINE` |

## Prerequisites

- AWS credentials for the target account (`aws sts get-caller-identity`). The CDK must be bootstrapped once: `npx cdk bootstrap`.
- Bedrock model access to **Amazon Nova 2 Lite** in `us-east-1`. Anthropic models also need a valid payment method, because they're subscribed through AWS Marketplace.
- `node scripts/setup.mjs` has been run at the repo root.
- **X-Ray Transaction Search** must be on, because the concierge's AgentCore tracing writes spans to CloudWatch Logs. It is a one-time account setting:
  ```bash
  aws logs put-resource-policy --policy-name TransactionSearchXRayAccess --policy-document file://xray-logs-policy.json
  aws xray update-trace-segment-destination --destination CloudWatchLogs
  ```
  The policy allows `xray.amazonaws.com` to `logs:PutLogEvents` on `aws/spans` and `/aws/application-signals/data`. Alternatively, deploy with `-c tracing=false`.

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

Context options: `authDomainPrefix`, `callbackUrls`, `allowedOrigins`, `caregiverEmail`, `phonePush` (default `true`), `whatsapp` (default `true`), `ntfyServer` (default `https://ntfy.sh`), `conciergeModelId` (default `us.amazon.nova-2-lite-v1:0`), `demoTimezone`, `devRoutes` (default `true`; the demo helpers still require a household token when hosted).

## After deploying

### Telling the caregiver: what works today

When Asha presses **Call Meera**, the hub tries every channel that is set up and reports back to the TV whether a real one accepted the
notice. If none did, the TV says "We couldn't reach Meera" instead of promising a call.

| Channel | Status | What it needs |
|---|---|---|
| **E-mail** (SNS) | works, used for the demo | subscribe an address once (below) |
| Phone push (ntfy) | works | the free ntfy app and the topic below |
| WhatsApp (Twilio) | built, **blocked on a Twilio trial account** | a paid Twilio account, or a rewrite for Meta's Cloud API ([friction log #15](../docs/friction-log.md)) |
| SMS | not built | |

Every message carries only the title and body of the notice, and a call request carries a signed link that expires after an hour.
Opening it shows one button; pressing **I'm calling now** puts a note from Meera on Asha's TV. "Delivered" means a channel accepted the
message, not that a person read it. Not built: re-sending after a few minutes, a second caregiver, escalation.

#### E-mail (the demo route)

```bash
# subscribe once; AWS sends a confirmation e-mail, click "Confirm subscription"
aws sns subscribe --region us-east-1 --protocol email --notification-endpoint you@example.com   --topic-arn $(aws cloudformation describe-stack-resources --stack-name Kinwise --region us-east-1       --query "StackResources[?ResourceType=='AWS::SNS::Topic'].PhysicalResourceId" --output text)
```

Or deploy with `-c caregiverEmail=you@example.com` (then pass it on every later deploy, or CloudFormation removes the subscription).
Check the spam folder for the confirmation. The e-mail comes from AWS Notifications and has an unsubscribe link at the bottom.

### WhatsApp for the caregiver (Twilio sandbox: blocked on a trial account)

The hub can message the caregiver on WhatsApp through [Twilio's WhatsApp sandbox](https://www.twilio.com/docs/whatsapp/sandbox).
The message carries the "Tap to tell them you are calling" link; opening it shows one button.

1. Make a free Twilio account. In the console open **Messaging, Try it out, Send a WhatsApp message**.
2. From the caregiver's WhatsApp, send the sandbox number the **`join <two words>`** message the console shows.
3. Put your credentials into the secret (run it yourself, from a file so the shell cannot mangle the quotes; a stray quote once left the token's closing quote out and the hub reported the secret as not filled in):
   ```bash
   aws secretsmanager put-secret-value --region us-east-1 --secret-id <WhatsAppTwilio secret ARN> --secret-string      '{"accountSid":"AC...","authToken":"...","from":"whatsapp:+14155238886","to":"whatsapp:+91XXXXXXXXXX"}'
   ```
   The `to` number is the caregiver's own WhatsApp number. The hub reads the secret when it starts, so make a
   running hub restart once:
   ```bash
   aws lambda update-function-configuration --region us-east-1 --function-name <hub function name> --description "reload secrets"
   ```
4. Press **Call Meera**. **On a Twilio trial account this fails with error 21654 ("ContentSid Required")**, and creating the required template is refused (20003). A paid account is needed; this path is not verified end to end. If Twilio answers with error **63016**, the sandbox 24-hour window has closed: send `join ...` again.

What leaves the hub: the notice title and body, the signed link and the caregiver's number (to Twilio and Meta). Nothing from
recordings, transcripts or reminders. A production setup would use a Meta-approved message template instead of free text.

### Get Meera's phone to ring (push notifications)

When Asha presses **Call Meera**, the hub pushes to the caregiver's phone through [ntfy](https://ntfy.sh): a free app for
Android and iPhone, with no account. A call request is sent as **urgent**, with an **I'm calling now** button. Pressing it puts a
note from Meera on Asha's TV. If the push cannot be sent, the TV says so and tells Asha to call Meera herself.

```bash
# the topic is generated by the stack and kept in Secrets Manager; read it once
aws secretsmanager get-secret-value --secret-id <NtfyTopic secret ARN from the stack> --query SecretString --output text
```

1. Install the **ntfy** app on the caregiver's phone and **Subscribe to topic** with that value (server `ntfy.sh`).
2. To let urgent pushes ring through Do Not Disturb: Android, ntfy settings, notification channel for priority **Urgent**,
   enable "Override Do Not Disturb". iPhone, enable Time Sensitive notifications for ntfy.
3. Press **Call Meera** in the demo and watch the phone.

What leaves the hub: the title and body of the notice (for example "Asha wants to talk to you now"), and a signed
button link that expires after an hour. Never recordings, transcripts or reminder text. Anyone who knows the topic can read the
push on the public ntfy.sh, so keep it private, or host your own ntfy and set `-c ntfyServer=https://ntfy.example.org`.
Not built yet: re-sending after a few minutes, a second caregiver, SMS.

```bash
node ../scripts/demo-tokens.mjs        # prints the hub URL plus Asha / Meera / TV demo tokens
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
