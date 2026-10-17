# Kinwise — design spec

Status: approved for build (2026-10-05). Owner: Kinwise team. Hackathon: Amazon AppDev 2026 "Build, Ship, Shape".

## 1. Problem and promise

Courier scams follow a two-step pattern. First, a caller posing as a bank, the FTC or the police convinces an older adult that their money is at risk. Then a "courier" comes to the home to collect cash or gold. Adults 60+ reported **$7.7B** in fraud losses in 2025 (about 60% more than in 2024; FBI IC3 data as reported by AARP). In FBI Boston's 103 courier-pickup cases from 2023 to May 2025, **roughly 98% of the losses were reported by people over 60** (a share of losses, not of victims). Sources are linked in the README.

No single device sees both steps. Kinwise joins them up. The signal from the conversation comes from what the resident tells Alexa. The signal from the door comes from Ring. When both line up, the resident's TV gently intervenes ("the Pause") and offers a one-press call to family.

Kinwise is **the resident's second opinion, not the caregiver's camera.** The resident owns every switch.

## 2. Personas

- **Asha (resident, 78)** lives alone. She uses an Echo Show (simulated Alexa+) and a Fire TV. A Ring doorbell watches her front door.
- **Meera (caregiver, 46)** is her daughter in another city. She has her own Alexa (simulated) and receives alerts (signals only, never recordings).

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
Fire TV app (Vega) ──poll──► hub /tv/*                hub ──► Notifier (SNS / console) ──► Meera
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

### 5.4 Risk window (the safety watch) and the resident's choice

- **Nothing starts by itself.** A call or reminder that matches warning signs only **offers** a watch (`watchOffer`, 30 minutes to answer, holding at most ten category labels in total with levels and times, never words; the deadline is fixed at 30 minutes from the first sign and never moves when more signs join; the labels are deleted from the stored document when she says Not now, when scam screening or door alerts are turned off, and the next time Kinwise runs after the deadline (there is no timer: the TV checks every two seconds while it is open, so this is usually within seconds, but a household nobody touches keeps expired labels until its next read). If she says Turn on, the labels become the watch's own signs and are kept with it (up to 24 hours of accumulation, plus the timeline lines) until the watch is ended by her revoking scam screening or door alerts. DynamoDB point-in-time recovery is on for the demo table, so an automatic backup can keep an earlier copy for up to 35 days). Asha chooses: **Turn on** (the watch opens, and family is told if it looks serious; **only her authenticated TV can do this**), **Not now** (nothing from the declined question is kept and nothing is sent; signs that belong to a watch she turned on earlier follow that watch's own retention. Kinwise keeps only three facts with no content: a line in her own timeline that she declined, the time before which it will not ask again, and the id of her last answer so that a repeat does nothing twice; none of the three says why she was asked), or **Review privacy** (a plain list of what the watch shares; changes nothing). **Not now** and **Review privacy** can be said to Alexa. A spoken **Turn on** cannot start a watch: the hub cannot verify who is speaking, and turning it on also tells family, so the tool returns `needsTv` and answers nothing and sends nothing (the one-time housekeeping that any read does, such as deleting an expired question, can still write); the question is shown on the TV as a sheet (Not now is focused) and in Settings & privacy. A caregiver, the discovery-only service identity and any other identity cannot answer for her.
- Opens when she turns it on and the accumulated level is `elevated` or `high`. The default duration is **6 hours** (`RISK_WINDOW_HOURS`). While a watch she turned on is running, a new warning extends or upgrades it without another question.
- Upgrades from elevated to high when new signals arrive. Expiry extends to `max(current, now + 6h)`.
- Only Asha (resident scope) can close it early. The reason is logged.
- Turning **scam screening** off withdraws a pending question and its signs **and ends a running watch**; turning **door awareness** off or using **privacy time** stops the Pause (spec §5.6, rule 1).
- A question that nobody answers is **deleted with its warning signs** once its 30 minutes are up, and holds at most ten category labels. A single weak sign (one category, which cannot open a watch) starts no question and is not kept at all.
- A watch carries `consentedAt`. A window that an older version opened by itself has none, is closed the first time the household is read (with a line in her timeline saying so), and never extends or notifies. A household from before this model is migrated once (`consentModel: 2`): the warning signs stored in the automatic era are dropped. Old "Pause was shown" timeline lines (written at send time) are relabelled "sent".
- What she is told when she agrees matches what happens: if the offered signs already add up to **high**, the question says family will be messaged **right away** and turning on sends that one short message (no recordings, none of what she said); at **elevated** level, family is told only if it later becomes serious. With **door awareness off** nothing is offered, because a watch that cannot see the door would only mislead. "Review privacy" works whenever she asks, with or without a question open, and writes nothing.
- **The TV names the question.** Turning a watch on from the TV needs the id of the question being answered; without it the request is refused, and a delayed retry of an old answer is never applied to a newer question (a retried "not now" without an id is still accepted). Answering a Pause on the TV (any button) also counts as the TV reporting it on screen.
- **Revocation and a message already on its way.** Notices are sent right after the decision that created them is saved. If she revokes in that instant, a notice already decided can still go out: revocation stops later decisions, and it never retracts a message already sent. The window is the time the notifier takes (one call to SNS or another channel; there is no timeout in the code). This is bounded, not eliminated, and a durable outbox was judged out of scope for this release. What she is told matches what happened: "I've told Meera" is only said when a channel accepted the message, otherwise she hears that delivery could not be confirmed and to call Meera herself.
- Turning **door alerts** off withdraws the question and ends a running watch (clearing its signs), and "Turn on" is refused while they are off, because a watch that cannot see the door would only mislead her.
- **Voice "not now" is accepted from an unverified speaker; "turn on" is not.** The asymmetry is deliberate: not answering already leaves everything off, so a wrong "not now" costs only one hour without a question, while a wrong "turn on" would tell family. The one-hour pause cannot be cancelled from the TV.
- **The TV credential.** Only the `device` role, issued to exactly one bearer token per household (the TV's: `dev-tv` in dev mode, a derived `kw_tv_…` token when hosted, where `AUTH_MODE` is `cognito`; Cognito can never issue `device`), can turn a watch on or report a Pause as shown, and that token cannot call MCP tools (`watch-consent` R14). It proves the request came from the TV app holding the household's device token, not that a particular person is in the room (so the README says "the TV app holds the household's device token", not "authenticated as hers" in any stronger sense). A long-lived bearer token on the TV is the trust boundary: keep it only on the TV, and rotate it by changing the secret seed.
- **"Shown" means the TV app reported it.** The app reports once its Pause screen is on screen (retrying with backoff if a request fails). Kinwise cannot tell whether the TV panel is on, whether another app is in front, or whether she looked, and says only that "the TV app reported that the Pause was on screen".
- The same answer again (with or without the offer's id, within 10 minutes) does nothing twice, and its wording follows the current state ("already on" only if the watch is still on). Pressing Back on the TV sheet only tucks it away; it answers nothing, and the question waits in Settings & privacy until it runs out.
- The timeline records `watch_on` and, for Asha only, `watch_declined`, as facts without content.

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
- `call_family` notifies the caregiver ("Mom chose Call Meera").
- `known_person` closes the alert and offers to add the visitor as an expected visit.
- `dismiss` closes the alert.

An unresolved Pause auto-expires after 30 minutes.

### 5.8 A Pause that was sent is not a Pause that was shown

The hub knows an event arrived and that it decided to Pause. Only the TV knows it drew the screen. So the hub records `pause_sent` when it decides, and `pause_shown` only when the TV app reports it (`POST /tv/alerts/:id/shown`). `delivery` on a Pause is `sent`, `shown`, or `not_confirmed` (nothing from the TV after 60 s). The family message says Kinwise *sent* a Pause and cannot tell whether she saw it; the timeline and `explain_last_alert` say the same. "Shown" means the app rendered the Pause, not that she looked at it.

**Foreground limit.** A third-party Fire TV app cannot draw over another app, so the Pause appears only while Kinwise is the active app. Kinwise does not try to detect "foreground" (there is no supported way); it observes only what it can: the TV's poll, the TV's `shown` report, and "Reconnecting…" when the hub is unreachable. If the TV does not report within a minute the Pause stays `not_confirmed` and the family is told a call may help. An e-mail alone never protects Asha in real time and is never described as doing so.

## 6. Interfaces

### 6.1 MCP server (`POST /mcp`, protocol 2025-11-25, Streamable HTTP, stateless)

Tools are scoped by role, taken from the token's `role` claim. Every tool returns `structuredContent` that matches its `outputSchema`, plus a short `content` text for voice.

| Tool | Role | Annotations | UI |
|---|---|---|---|
| `kinwise_add_reminder {text, at}` | resident | write, not destructive | `ui://kinwise/screening` |
| `kinwise_check_call {description}` | resident | write (stores category labels, may offer a watch), not destructive | `ui://kinwise/screening` |
| `kinwise_set_safety_watch {offerId?, choice}` | resident | write; `not_now` · `review_privacy` act; `turn_on` returns `needsTv` and does nothing (only the TV device can turn a watch on); visible to model and app | `ui://kinwise/screening` |
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

- `GET /tv/state` → `{household, resident, caregiver, today, activeAlert, pendingProposals, consent, watch, privacyHourUntil, accessLog, serverTime}`. Here `today` carries the date and time labels, `reminders`, `visits`, `messages` and `safety` (the risk window level and "until" label).
- `POST /tv/alerts/:id/respond {action: call_family|known_person|dismiss}`
- `POST /tv/watch {choice, offerId?}`: her answer to the safety-watch question on the TV (the only place `turn_on` takes effect)
- `POST /tv/alerts/:id/shown`: the TV says the Pause is on screen (until then it is only "sent"). Only the TV device identity may report this; a resident token is refused
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

1. **The resident owns the switch.** Consent, the privacy hour and each safety watch are set only on Asha's TV, or by her own voice. Kinwise asks before it watches or tells family, and a refusal is respected.
2. **Signals, not streams.** The caregiver sees events ("unexpected visitor 2:41 p.m., Pause sent to the TV, Mom chose Call Meera"). They never see transcripts, frames or video.
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
