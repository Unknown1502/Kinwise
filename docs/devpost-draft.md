# Devpost draft (edit this into your own words before you submit)

**This is a draft.** It is built only from what is in the repository, the friction log and the tests, so every claim can be checked. The "would you build with it again" answers are marked **[your call]** because they are an opinion. Replace anything that does not sound like you. Do not paste tokens or the hosted persona tokens into any public field.

## Title and tagline

**Kinwise** — a consent-first family safety net that links a suspicious phone call to the visitor at the front door, with Alexa+, Ring and Fire TV.

## Elevator pitch (about 200 characters)

Courier scams need two steps: a scary call, then someone at the door. Kinwise connects them. When a stranger rings after a warning sign, Asha's TV pauses her gently, says why, and one press calls her daughter.

## Inspiration

Courier scams have two steps: a caller posing as a bank or the FTC frightens an older adult, then a "courier" comes to the home for cash or gold. No single device sees both steps. People aged 60 and over reported $7.7 billion in fraud losses in 2025 (about 60% more than 2024, [AARP on the FBI's 2025 data](https://www.aarp.org/money/scams-fraud/fbi-ftc-report-2025-losses/)). In the FBI Boston cases of 2023 to May 2025, roughly 98% of the $26 million lost was reported by people over 60 ([FBI Boston](https://www.fbi.gov/contact-us/field-offices/boston/news/fbi-boston-warns-of-increase-in-gold-bar-and-bulk-cash-courier-scams)). Sixty-three million Americans give care to someone ([AARP 2025](https://www.aarp.org/press/releases/2025-07-24-new-report-reveals-crisis-point-for-americas-63-million-family-caregivers.html)), and Amazon's own Alexa Together page says that service is no longer offered.

## What it does

1. Asha tells Alexa about a reminder or asks "is this call real?". Kinwise matches documented scam warning signs with fixed, explainable rules and keeps **only the category labels**, never the words.
2. It watches the door more closely for six hours, and tells her daughter Meera that there is a warning (a signal, not content).
3. A stranger rings the Ring doorbell. Asha's **Fire TV shows the Pause and speaks it**: "someone is at your door, and no visit is expected right now. At 10:20 AM you asked Kinwise about a call, and it matched courier-scam warning signs." Meera's recorded message appears with captions, and **Call Meera** is focused on the remote.
4. Asha presses it. **Meera is told for real**: an e-mail (and SMS or WhatsApp if she set them up) with an **I'm calling now** link. One button puts "I got your request and I'm calling you now" on Asha's TV, read aloud. If nobody answers, a second message goes out after about 2 minutes and the TV says so plainly. If no real channel could be reached, the TV says "We couldn't reach Meera" instead of promising a call.
5. Meera's own Alexa shows a timeline of **signals, never recordings**. Asha can read, in Settings, every time family looked at her information, and turn anything off.

## How we built it

- **Alexa+**: a self-hosted **MCP server** (spec 2025-11-25, Streamable HTTP, MCP TypeScript SDK v2) with role-scoped tools, structured output and four **MCP Apps** cards, following the published Alexa+ two-tier OAuth contract. The Alexa+ experience itself is a **labelled simulation** (an Echo Show web app that is a real MCP client and MCP Apps host, plus a Strands concierge agent).
- **Ring**: the official **Ring Partner API** and Developer Playground (devices, history, WHEP live view, signed webhooks). Frames stay in memory; Nova 2 Lite describes presence neutrally, never identity.
- **Fire TV**: a **React Native for Vega OS** app (D-pad first, VoiceView, captions, an accessible typeface), run on the **Vega Virtual Device** and in a browser preview from the same source.
- **AWS** (all CDK): Lambda (ARM64) + API Gateway, Cognito, DynamoDB, Secrets Manager, SNS, EventBridge Scheduler, Polly (the TV's voice), X-Ray, **Bedrock AgentCore Runtime + Memory**, **Strands Agents** and **Amazon Nova 2 Lite**.
- **The model never makes a safety decision.** The warning signs, the warning window and the door decision are deterministic rules with named constants and 194 hub tests; the model only talks kindly and describes a camera scene neutrally.
- **Open source**: `alexa-plus-mcp-kit` (Apache-2.0), a library and `alexa-mcp-conformance` CLI that checks any MCP server against the Alexa+ add-on contract.

## Challenges

- The Ring Developer Playground has no "person at the door" scene and no way to choose one, so the real feed correctly shows an empty doorstep and Kinwise stays quiet; the Pause in the demo is shown from our labelled doorbell simulator through the same rules.
- "Delivered" does not mean "read". We had to build the follow-up, an honest failure screen and a one-tap confirmation so the TV never promises help that is not coming.
- A four-vendor audit of our notification code found real flaws (shared-address unsubscribes, late-confirmed subscriptions, an unsigned follow-up event, one wrong IAM grant). We fixed them and wrote down what we accepted and rejected ([`docs/security-review.md`](security-review.md)).
- The Vega SDK is Linux and macOS only; we built and ran it in Ubuntu on WSL2 and documented the path (friction log #12 and #14).

## Accomplishments

- A cross-device story that works end to end on a hosted AWS stack, with every simulated part labelled.
- A measured comparison with a door-only rule ([`docs/evaluation.md`](evaluation.md)): 0 false urgent alerts on harmless visitors, **and one miss that we report** (a courier arriving after the 6-hour window).
- The real Ring API, the real Vega device, a real e-mail and a real follow-up schedule, each run and recorded.

## What we learned

- Consent and dignity are design constraints, not features: the resident owns every switch, family sees signals only, and every family look is logged where she can read it.
- The cheapest way to be trusted is to say what failed.

## What's next

A per-caregiver ntfy topic and SMS outside the AWS sandbox (needs DLT registration for India); a scheduler-backed re-send for several caregivers; a real Ring "person" event when the Playground offers one; user research with older adults and caregivers.

## Built with

TypeScript, React, React Native for Vega OS, Python, MCP (TypeScript SDK v2, MCP Apps), Ring Partner API, AWS CDK, Lambda, API Gateway, DynamoDB, Cognito, SNS, EventBridge Scheduler, Secrets Manager, Polly, X-Ray, Bedrock AgentCore, Strands Agents, Amazon Nova 2 Lite.

## Tracks and mini-challenges

Primary: **Fire TV**, **Alexa+**, **Ring** (one project can win one track prize). Mini-challenges: **AWS Builder**, **Open Source**.

## New or existing project

New. The first commit is dated 2026-10-05, inside the submission window (Aug 31 to Oct 23).

## Open Source mini-challenge fields

- **Contribution URL:** https://github.com/Unknown1502/alexa-plus-mcp-kit
- **Project repository URL:** https://github.com/Unknown1502/Kinwise
- **GitHub username:** Unknown1502
- **What we did, how it works, why it matters:** a new Apache-2.0 library that makes any MCP SDK v2 server follow the Alexa+ add-on auth contract (two-tier OAuth scopes, RFC 9728 protected-resource metadata, a 401 without `WWW-Authenticate`, a 403 on a bad `Origin`), plus an `alexa-mcp-conformance` command that checks a running server (protocol version, scopes, output schemas, annotations, MCP Apps resources, and a 500 ms latency budget). Alexa+ participants cannot reach Amazon's own toolkit (friction log #5), so this gives every team a way to check their server before they submit. Kinwise's hub uses it in production code.

## Product feedback (per tool)

Fill in your own words. Facts to draw on are in [`product-feedback-notes.md`](product-feedback-notes.md) and [`friction-log.md`](friction-log.md).

| Tool | Used for | Worked well | Needs work | Onboarding | Build again? |
|---|---|---|---|---|---|
| Alexa+ MCP contract and MCP TS SDK v2 | the hub's MCP server and cards | `createMcpHandler` serves both protocol eras from one factory; `authInfo` makes role-scoped servers easy; the auth contract was precise | participants cannot reach the MCP Toolkit or simulator (friction #5); MCP Apps cards are about 230 KB each (#9); a stateless server logs a console error in browsers (#10) | the documentation of the auth contract was precise (two-tier scopes, no dynamic client registration, no `WWW-Authenticate`) | **[your call]** |
| Ring Partner API and Developer Playground | device list, WHEP live view, history, image download, webhooks | WHEP over HTTP; a clear HMAC webhook contract | no person scene or scene choice (#13); undocumented image-download body and JSON:API shapes (#8); no AI features for partners (#7); 30-minute tokens | the Playground is a good start; the gaps showed up after the first call | **[your call]** |
| Vega OS SDK, Vega Virtual Device, react-tv-space-navigation | the Fire TV app | the multi-TV sample made a shared React Native codebase realistic; spatial navigation works on the web too | Linux and macOS only (#1, #12); restarts after an unclean stop fail without saying why (#14); no overlay API for a safety notice (#6) | about 90 minutes to a running device under WSL2 (#12) | **[your call]** |
| AWS: Bedrock, AgentCore Runtime and Memory, Strands, Nova 2 Lite | the concierge agent, vision, memory | the CDK L2 constructs made AgentCore a few dozen lines; Nova 2 Lite followed tool schemas | an Anthropic model blocked by payment status with no console hint (#2); the Strands pin on the MCP SDK (#3); ARM64 packaging without Docker (#4); tracing needs an account step (#11) | fast once the account steps were done | **[your call]** |
| AWS: Lambda, API Gateway, Cognito, DynamoDB, SNS, Secrets Manager, Polly, X-Ray, EventBridge Scheduler, CDK | the hub, auth, state, family notices, voice, follow-up | all CDK and live-tested; one-time schedules clean up after themselves | Scheduler fires up to about a minute late with no stated tolerance (#16); SNS has no resource-level permissions for two actions we needed (see `security-review.md`) | **[your words]** | **[your call]** |
| Twilio WhatsApp (optional), ntfy (optional) | extra family channels | ntfy: a one-call publish API (built, but not yet verified on a phone) | a Twilio trial account blocks sending and the reason is hard to find (#15) | the sandbox page gives the join code; sending from code was then refused (#15) | **[your call]** |

**AWS Builder answer (required in this field):** AWS Lambda and API Gateway run the hub; Cognito does the Alexa+ two-tier OAuth; DynamoDB holds household state; Secrets Manager holds the signing secret and optional channel secrets; SNS sends family e-mail; EventBridge Scheduler wakes the hub for the follow-up; Polly speaks on the TV and the Echo simulator; X-Ray traces the hub and the agent; Bedrock AgentCore Runtime and Memory host the concierge, built with Strands Agents on Amazon Nova 2 Lite. See [`infra/`](../infra) and [`docs/security-review.md`](security-review.md).

## Friction log (optional, up to a 10% bonus)

Enter the 17 entries from [`friction-log.md`](friction-log.md) in the form's friction-log fields (task, steps, expected vs actual, severity, workaround, suggestion). A file in the repository is not enough.

## Testing instructions (private field)

1. **Offline, no accounts:** `node scripts/setup.mjs`, then `node scripts/dev.mjs --offline`; open http://localhost:5173 and http://localhost:5174; press **Ring the doorbell** after asking "is this call real?". Or run `node scripts/demo-scenario.mjs`.
2. **Hosted demo:** `https://ujvlrh7vwd.execute-api.us-east-1.amazonaws.com` (MCP endpoint `/mcp`). Persona tokens: run `node scripts/demo-tokens.mjs` and paste its output **here only**.
3. **Conformance:** `npx alexa-mcp-conformance --url <hub>/mcp --token <resident token> --service-token <service token>`.
4. The Alexa+ surface and the Ring "person" moment are simulated and labelled; the Ring worker, the MCP server and the Vega app are real.

## Suggested GitHub "About" text (set it in the GitHub UI on each repo)

- **Kinwise** — Description: "Consent-first family safety net: links a scam call to the visitor at the door with Alexa+, Ring and Fire TV (Vega)." Topics: `alexa-plus` `mcp` `ring` `fire-tv` `vega-os` `react-native` `aws-cdk` `bedrock-agentcore` `strands-agents` `accessibility` `hackathon`.
- **alexa-plus-mcp-kit** — Description: "Make an MCP server follow the Alexa+ add-on auth contract, with a conformance CLI." Topics: `mcp` `alexa-plus` `oauth` `typescript` `conformance`.
