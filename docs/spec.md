# Kinwise — design spec

Status: approved for build (2026-10-05). Owner: Kinwise team. Hackathon: Amazon AppDev 2026 "Build, Ship, Shape".

## 1. Problem and promise

Courier scams follow a two-step pattern. First, a caller posing as a bank, the FTC or the police convinces an older adult that their money is at risk. Then a "courier" comes to the home to collect cash or gold. Adults 60+ reported **$7.7B** in fraud losses to the FBI in 2025. In FBI Boston's courier-pickup cases, **about 98% of victims were over 60**.

No single device sees both steps. Kinwise joins them up. The signal from the conversation comes from what the resident tells Alexa. The signal from the door comes from Ring. When both line up, the resident's TV gently intervenes ("the Pause") and offers a one-press call to family.

Kinwise is **the resident's second opinion, not the caregiver's camera.** The resident owns every switch.

## 2. Personas

- **Asha (resident, 78)** lives alone. She uses an Echo Show (simulated Alexa+) and a Fire TV. A Ring doorbell watches her front door.
- **Priya (caregiver, 46)** is her daughter in another city. She has her own Alexa (simulated) and receives alerts (signals only, never recordings).

## 3. Tracks and how each is used at runtime

| Track | Runtime use in this repo |
|---|---|
| Alexa+ | `packages/hub` serves a self-hosted **MCP server** (spec 2025-11-25, Streamable HTTP, stateless) at `/mcp`. It provides tools with `outputSchema`/`structuredContent`, annotations and icons; **MCP Apps** UI resources (`ui://kinwise/*`); Alexa+-style two-tier OAuth scopes; and RFC 9728 protected-resource metadata. `agents/concierge` is the simulated Alexa+ orchestrator (Strands agent + real MCP client). `packages/echo-sim` is the Echo Show surface that renders MCP Apps through AppBridge. |
| Ring | `agents/ring-worker` calls the **Ring Partner API** (`api.amazonvision.com`): it lists devices, polls event history, grabs frames over a WHEP live-view session, and runs a webhook receiver with HMAC-SHA256 verification. It works against the **Ring Developer Playground** or a linked device. |
| Fire TV | `packages/tv-app` is a **React Native for Vega** app (Vega OS, runs in the Vega Virtual Device). It shows the Today board, the Pause, consent and privacy controls, and the access log, with D-pad-first navigation. |
| AWS Builder | Strands Agents on **Bedrock AgentCore Runtime**, **Nova 2 Lite** (vision + text), Claude Haiku 4.5, DynamoDB, Lambda, API Gateway, Cognito, SNS, EventBridge-style event ingestion, and CDK infrastructure. |

## 4. Components

```
Echo Show sim (web) ──ask──► concierge (Strands, AgentCore) ──MCP──► hub /mcp
        │                                                             │
        └──resources/read (MCP Apps UI) ───────────────────────────► hub /mcp
Ring Playground/API ◄── ring-worker (poll · WHEP frame · webhook) ──signed event──► hub /events/visitor
Fire TV app (Vega) ──poll──► hub /tv/*                hub ──► Notifier (SNS / console) ──► Priya
```

- **hub** (TypeScript, Node 22, Hono). Owns all state and every decision. Runs locally with `npm run dev`, or on AWS Lambda behind API Gateway.
- **concierge** (Python, Strands). Turns natural language into MCP tool calls. It never decides safety outcomes.
- **ring-worker** (Python). Turns Ring activity into neutral visitor events.
- **echo-sim** (React + Vite). A browser stand-in for an Echo Show. It renders MCP Apps cards and shows the JSON-RPC traffic.
- **tv-app** (React Native for Vega) plus **tv-preview** (react-native-web, for development only).
- **infra** (AWS CDK, TypeScript).

## 5. Domain rules (hub, deterministic, unit-tested)

### 5.1 Scam signal categories

| Key | Meaning | Examples |
|---|---|---|
| `authority` | Claims to be an institution | bank, fraud department, FTC, IRS, Social Security, police, sheriff, Amazon, Microsoft, government |
| `urgency` | Threat or time pressure | compromised, frozen, suspended, arrest, warrant, immediately, today only, legal action |
| `secrecy` | Isolation from others | don't tell, keep this between us, confidential, don't tell your family/children/the bank |
| `unusual_payment` | Payment scammers prefer | gold, gold bars, cash, gift card, bitcoin, crypto, wire transfer, money order, "safe account" |
| `courier_pickup` | Someone comes to collect | courier, pick up / pickup, messenger, "someone will come", "send a driver", collect the package |
| `remote_access` | Device or code takeover | remote access, AnyDesk, TeamViewer, download this app, read me the code, verification code |

Matching normalizes case, punctuation and common spelling variants. The rule list is data in `src/domain/patterns.ts` (phrases plus regexes). It is versioned, and each category carries a plain-language explanation shown to Asha.

### 5.2 Screening a single text (`screen(text)`)

- `level = none` when fewer than 2 categories match, unless the matches are `courier_pickup` together with an `authority` mention of a bank or agency, which is `elevated`.
- `level = elevated` when exactly 2 categories match.
- `level = high` when 3 or more categories match, **or** when `courier_pickup` and `unusual_payment` both match.

### 5.3 Cross-session accumulation (`assessDay`)

Categories from every screened text (reminders and "is this legit?" checks) are kept as **category labels and timestamps only, never the text**. A rolling 24-hour window is unioned, then levelled with the same rule. This is what lets "remind me: courier from the bank at 2 p.m." plus a later "is this call legit?" add up to `high` even when each on its own is only `elevated`.

### 5.4 Risk window

- Opens when the accumulated level is `elevated` or `high`. The default duration is **6 hours** (`RISK_WINDOW_HOURS`).
- Upgrades from elevated to high when new signals arrive. Expiry extends to `max(current, now + 6h)`.
- Only Asha (resident scope) can close it early. The reason is logged.

### 5.5 Expected visits

- Each visit is `{label, recurrence: weekly{weekday,start,end} | once{start,end}, status: active|proposed}`, evaluated in the household time zone.
- A visitor event matches when its time falls in `[start − 30 min, end + 30 min]` of an **active** visit.
- **Consent:** a visit proposed by the caregiver is `proposed` until Asha approves it on the TV.

### 5.6 Door decision (`decideOnVisitor`)

Evaluated in this order:

1. If a privacy hour is active, or `consent.doorAwareness` is off: **ignore**. Nothing is stored except a counter.
2. If no person is present (vehicle or package only): store an activity entry and do nothing else.
3. If the visitor matches an active expected visit: show an **expected** card ("Luis (gardener) — expected 10:00").
4. If the visitor is unexpected and the risk window is `high`: show the **Pause**, and alert the caregiver if `consent.caregiverAlerts` is on.
5. If the visitor is unexpected and the risk window is `elevated`: show the **Pause** with softer copy, and send no caregiver alert.
6. If the visitor is unexpected and there is no window: show a **gentle** card ("A visitor isn't on today's list"), with no caregiver alert.

Appearance is **never** an input. Only presence, time, expected visits and the risk window matter.

### 5.7 Alert resolution

Asha resolves an alert from the TV or the Echo:
- `call_family` notifies the caregiver ("Mom chose Call Priya").
- `known_person` closes the alert and offers to add the visitor as an expected visit.
- `dismiss` closes the alert.

An unresolved Pause auto-expires after 30 minutes.

## 6. Interfaces

### 6.1 MCP server (`POST /mcp`, protocol 2025-11-25, Streamable HTTP, stateless)

Tools are scoped by role, taken from the token's `role` claim. Every tool returns `structuredContent` that matches its `outputSchema`, plus a short `content` text for voice.

| Tool | Role | Annotations | UI |
|---|---|---|---|
| `kinwise_add_reminder {text, at}` | resident | write, not destructive | `ui://kinwise/screening` |
| `kinwise_check_call {description}` | resident | write (may open a window), not destructive | `ui://kinwise/screening` |
| `kinwise_get_today {}` | resident, caregiver | read-only | `ui://kinwise/today` |
| `kinwise_add_expected_visit {label, weekday?, date?, start, end}` | resident (active), caregiver (proposed) | write | — |
| `kinwise_respond_to_alert {alertId, action}` | resident | write; visible to model and app | `ui://kinwise/pause` |
| `kinwise_set_privacy_hour {minutes}` | resident | write | — |
| `kinwise_get_day_timeline {date?}` | caregiver (if shared), resident | read-only | `ui://kinwise/timeline` |
| `kinwise_explain_last_alert {}` | resident, caregiver | read-only | `ui://kinwise/pause` |
| `kinwise_send_family_message {text}` | caregiver | write | — |

Auth follows the Alexa+ two-tier model:
- `mcp:service` is enough for `initialize` and `tools/list`.
- `mcp:tools` is needed for `tools/call`, and `mcp:resources` for `resources/read`.
- `GET /.well-known/oauth-protected-resource` serves RFC 9728 metadata.
- A 401 response omits `WWW-Authenticate` by default (Alexa+ compatibility). Set `MCP_WWW_AUTHENTICATE=on` to include it.
- An invalid `Origin` gets a 403.
- `AUTH_MODE=dev` accepts static dev tokens (`dev-asha`, `dev-priya`, `dev-service`). `AUTH_MODE=cognito` verifies Cognito JWTs.

### 6.2 Fire TV API (bearer device token)

- `GET /tv/state` → `{household, resident, caregiver, today, activeAlert, pendingProposals, consent, privacyHourUntil, accessLog, serverTime}`. Here `today` carries the date and time labels, `reminders`, `visits`, `messages` and `safety` (the risk window level and "until" label).
- `POST /tv/alerts/:id/respond {action: call_family|known_person|dismiss}`
- `POST /tv/alerts/:id/seen` quietly clears an *expected-visitor* notice (no timeline entry)
- `POST /tv/visits {label, recurrence}`: the resident remembers a visitor ("I know this person")
- `POST /tv/proposals/:id {decision: approve|decline}`
- `POST /tv/consent {scamScreening?, doorAwareness?, caregiverAlerts?, shareTimelineWithCaregiver?, onboarded?}`. Unknown keys are rejected.
- `POST /tv/privacy-hour {minutes}` · `POST /tv/messages/:id/read` · `POST /tv/safety/close`

### 6.3 Event ingestion (HMAC `X-Kinwise-Signature: sha256=<hex>` over the raw body)

- `POST /events/visitor {eventId, deviceId, occurredAt, source, ringEventType, perception:{personPresent, peopleCount, carrying, description}}`. The handler is idempotent on `eventId`.

### 6.4 Simulator bridge

- `POST /sim/ask {text, sessionId}` (bearer = the speaker's token) forwards `{persona, text, token, sessionId, householdTimezone, hubMcpUrl}` to the concierge: `http://localhost:8081/invocations` in dev, `InvokeAgentRuntime` on AWS.

## 7. Privacy rules (enforced in code, shown in the UI)

1. **The resident owns the switch.** Consent and the privacy hour are set only on Asha's TV, or by her own voice.
2. **Signals, not streams.** The caregiver sees events ("unexpected visitor 2:41 p.m., Pause shown, Mom chose Call Priya"). They never see transcripts, frames or video.
3. **No stored check text.** "Is this legit?" stores categories and level only. Reminders keep their text, because the reminder is the point.
4. **No faces, no plates, no identity.** Perception returns presence, count, carried objects and a neutral description. Frames are discarded after perception.
5. **Advise, never control.** Kinwise never locks doors or calls police. Every card can be dismissed with one press.
6. **Visible access log.** Every caregiver read is logged and shown to Asha.
7. **Accessible.** Large type, high contrast, screen-reader labels and captions.

## 8. Non-goals (cut list)

Bee (no device available), live video on the TV, purchases, Nova Sonic speech-to-speech (stretch), Chime audio (Early Access), facial recognition (never).

## 9. Quality bar

- Rules engine: table-driven unit tests for every category and threshold, plus multi-turn accumulation and time-zone edge cases.
- MCP: an in-process client test covering list, call, structured output vs schema, the role and scope matrix, and auth failures (401 / 403 / Origin).
- Ring worker: HMAC verification, dedupe, client error handling (401 / 429 / 503) and fixture replay.
- A single `scripts/demo-scenario` drives the full hero story end to end against a running hub.
- Measured targets: MCP p95 under 500 ms for read tools; visitor event to TV state under 3 s locally.
