# Judging evidence and readiness (2026-10-16)

Every row says whether it is **VERIFIED** (read in an official source, or run), an **INFERENCE**, **UNKNOWN**, or **FAILED**. Sources were read on 2026-10-16 from the official pages (the Devpost site blocks automated fetches, so they were read in a real browser): [overview](https://amazonappdev2026.devpost.com/), [rules](https://amazonappdev2026.devpost.com/rules), [resources](https://amazonappdev2026.devpost.com/resources).

## 1. Requirements matrix

| Requirement (source) | Status | Evidence |
|---|---|---|
| Submit by **Oct 23, 2026, 12:00 PM PT** (rules §1; the site shows 24 Oct 12:30 AM IST) | VERIFIED | Draft by Oct 22, final by 9 AM PT, per `docs/submission-checklist.md` |
| Project **created or significantly updated in the window** Aug 31 to Oct 23 (rules, "New & Existing") | VERIFIED | First commit 2026-10-05; GitHub repo created 2026-10-07; nothing pre-dates the window |
| **Public repo with an open-source license visible in the About section**, or a private repo shared with testing@devpost.com and the Amazon team (rules, Submission Requirements) | VERIFIED | GitHub reports **Apache-2.0** for both `Unknown1502/Kinwise` and `Unknown1502/alexa-plus-mcp-kit`. Gap: the About description and topics are empty on both (blocker 5) |
| Repo has **clear setup and run instructions** (rules, "Functionality") | VERIFIED | A fresh clone of the public repo followed the README: setup 1 m 44 s, offline start, scripted story, 22/22 and 16/16 conformance, every test suite green, browser doorbell check 7/7 (section 4) |
| **Alexa+**: MCP server, spec 2025-11-25+, Streamable HTTP, called at runtime in the repo, or a simulated experience whose source is in the repo and clearly shown | VERIFIED | `packages/hub/src/mcp/server.ts` (MCP TS SDK v2); the open-source checker passes 16/16 locally and, on the hosted hub, 14 of 14 checks that need no service token (16/16 with one, run earlier in the project); the Echo simulator is labelled "Simulated Alexa+ surface" on screen |
| **Ring**: any Ring API, SDK, simulator or device in Ring's docs; the demo video must show it working; the repo must call it in code | VERIFIED | `agents/ring-worker` calls the Ring Partner API (device list, WHEP live view, history, webhooks). Run live on 2026-10-14: device online, live frames analysed, correctly "no one at the door" (`take6/ring`) |
| **Fire TV**: runs on Fire OS or Vega OS; the video must show an actual device **or the Fire TV/Vega simulator** | VERIFIED | The real app on the Vega Virtual Device (SDK 0.24.12112), 1:36 of footage (`take6/vega`) |
| **Demo video under 3 minutes**, public on **YouTube or Vimeo**, English, on-device footage, no third-party trademarks or copyrighted music | **NOT DONE** | Footage exists (`D:\kinwise-demo\take5`, `take6`); no narration, no edit, no upload (blocker 1) |
| **Text description** (features and how it works) | DRAFTED | `docs/devpost-draft.md`; the team should put it in their own words |
| **Product feedback for every tool, API or SDK used** (used for what, worked, needs work, onboarding, build again Y/N); **AWS services described here for the AWS Builder challenge** | DRAFTED | `docs/devpost-draft.md`; backed by `docs/product-feedback-notes.md` |
| **Tracks and mini-challenges identified** | READY | Fire TV, Alexa+, Ring; AWS Builder, Open Source. A project can win **one** track prize and **one** mini-challenge prize (overview) |
| **Open Source fields**: contribution URL, repo URL, GitHub username, description | READY | `https://github.com/Unknown1502/alexa-plus-mcp-kit`, `https://github.com/Unknown1502/Kinwise`, `Unknown1502`; description in the draft. The kit repo's code is identical to `packages/alexa-plus-mcp-kit` (checked) |
| **Optional friction log: up to a 10% bonus**, assessed by Amazon's team at Stage 1; it must be entered **in the submission form** | READY, NOT ENTERED | 17 first-hand entries in `docs/friction-log.md`, each with task, steps, expected vs actual, severity, workaround and suggestion. A repository file alone does not count (blocker 2) |
| **Testing**: the project must be available **free of charge until the Judging Period ends (Nov 20)**; private sites need login credentials in the testing instructions | VERIFIED, ONGOING | Hosted stack is live (health 200). Demo tokens go in the private testing field via `node scripts/demo-tokens.mjs`, never in the repo. **The stack must stay up through Nov 20** (blocker 4) |
| Third-party SDKs and APIs used only as their terms allow | VERIFIED | `NOTICE` records Atkinson Hyperlegible Next (OFL), Lucide icons (ISC). Twilio and ntfy are optional channels and not required to run |
| Judging is **Stage 1 pass/fail, then four equally weighted criteria**; judges may use AI-assisted analysis and may judge from the text, images and video alone | VERIFIED | So the README and the video must carry the evidence by themselves |

## 2. Judging evidence, criterion by criterion

The four criteria are equally weighted. The scores below are **our own estimates for planning**, not predictions, and have no competitor comparison behind them.

| Criterion | Our estimate | Evidence | Biggest weakness | A fix that fits the time |
|---|---|---|---|---|
| **Tech implementation** | 8 / 10 | A standards-conformant MCP server with MCP Apps cards and two-tier OAuth (16/16, 22/22 checks); deterministic safety engine (262 hub tests, an evaluation of 17 situations with one disclosed miss, and a resident-consent step the backend enforces); Ring Partner API with real WHEP frames and neutral Nova 2 Lite perception; Vega app running on the simulator; AgentCore Runtime + Memory, Strands, Polly, EventBridge Scheduler, SNS, all CDK, live-tested; an independent four-vendor audit whose findings were fixed ([`security-review.md`](security-review.md)) | The Alexa+ surface and the Ring "person" scene are simulated; SMS and WhatsApp are unproven on real phones | Say plainly on screen what is simulated; show the real e-mail arriving |
| **Design** | 7.5 / 10 | A resident-controlled safety watch (a plain question with Turn on / Not now / Review privacy, on the Echo card and on the TV); a 10-foot UI with a warm home screen, large Atkinson Hyperlegible text, a calm persimmon Pause that explains *why*, captions, spoken lines, D-pad focus rings, a "nobody answered" state that says so plainly | The video is not made; the Vega footage was captured frame by frame, not with a screen recorder | Record the Vega run with OBS while pressing the same keys |
| **Potential impact** | 7 / 10 | Real, sourced figures ($7.7 B lost by people 60+ in 2025; 63 million caregivers; Alexa Together no longer offered); a product shape (family-set contacts, consent, access log) that could ship as a Fire TV / Ring app | No user research and no pilot; the AWS stack is single-household demo scale | State the limits; do not claim a market study |
| **Quality of the idea** | 8.5 / 10 | The cross-device join (earlier call → later visitor → TV Pause → family) is the idea; it matches the rules' own "creative, not obvious" examples: Alexa+ "context-aware add-on that maintains state across sessions" and MCP Apps; Ring "caretaking, event-based triggers"; Fire TV "multi-modal UX combining voice + D-pad + visual"; AWS "Bedrock + AgentCore + Strands" | Courier-scam detection by fixed rules is simple by design | Lead the video with the Pause and the *why* line |
| Friction log bonus | up to +10% | 17 first-hand entries, each with task, steps, expected vs actual, severity, workaround and suggestion | Must be pasted into the form | Blocker 2 |

## 3. Three skeptical readers

1. **A judge who watches the video and never runs the code.** They need, inside 3 minutes: the problem, the Pause with its reason, the call-then-door link, the real family notification, the Vega device, the real Ring API, and what is simulated. All the footage exists; the video does not (blocker 1). The simulated parts must be labelled in the narration.
2. **A judge who runs the project with only the README.** Verified on a clean clone (section 4). Limits: tested on Windows 11 only; the Vega app needs Linux or WSL2 and the Vega SDK; hosted-demo tokens live in the private testing field, so without them a judge uses the offline path.
3. **A judge who doubts the Amazon integrations and the privacy claims.** Evidence is in the repo, not in claims: the MCP checker output, the Ring worker's real run with its log, the Vega footage, the AWS evidence images, and tests for each privacy rule (`safety-test-coverage.md`). The honest limits are written in the README: the Alexa+ surface is simulated, Ring has no person scene in the Playground, SMS is sandbox-only, and e-mail is the verified family channel.

## 4. Reproduction from a clean clone (2026-10-16, Windows 11, Node 22, uv)

`git clone https://github.com/Unknown1502/Kinwise.git` at commit `6216c45`, then the README's steps, with these results:

| Step | Result |
|---|---|
| `node scripts/setup.mjs` | completed in 1 m 44 s (download caches warm) |
| `node scripts/dev.mjs --offline` | hub, concierge, Echo simulator and TV preview all answered |
| `node scripts/demo-scenario.mjs` | the story ran to a Pause |
| `npm run conformance -w @kinwise/hub` | 22 / 22 |
| `alexa-mcp-conformance` against the local hub | 16 / 16 |
| `npm test` (kit 15, hub 188, infra 11 with 1 skipped without the concierge bundle) | all passed |
| `echo-sim` 80 passed (4 live-hub tests skipped without a hub URL); `tv-preview` 95 passed | all passed |
| `uv run pytest` in `agents/concierge` and `agents/ring-worker` | 32 and 191 passed |
| Browser: Reset demo, Ring the doorbell, TV shows the Pause, Meera's phone shows the alerts | 7 / 7 |

Not tested: macOS or Linux hosts, a cold download cache, and the Vega build on a fresh machine.

### 4b. The consent and delivery change (2026-10-16, same day, after the run above)

A flagged call used to open the watch and tell the family automatically (standing consent from onboarding). It now **asks first**, and the TV no longer implies a Pause was seen when it was only sent. Results on the local stack from this working tree (not yet deployed):

| Check | Result |
|---|---|
| `npm test`: kit 15, hub 262, infra 12 | all passed |
| `tv-preview` 108, `echo-sim` 80 (4 skipped without a hub URL; the 4 live-hub tests also pass with `KINWISE_HUB_URL` set) | all passed |
| `agents/concierge` 45, `agents/ring-worker` 191; Vega project jest 55 | all passed |
| `npm run typecheck` (hub, kit, infra, echo-sim, tv-preview) | 0 errors; `tv-app` types are checked only by the Vega build in WSL, **not rerun here** |
| `npm run conformance -w @kinwise/hub`; `alexa-mcp-conformance` | 22 / 22; 16 / 16 (now 11 tools) |
| `node scripts/demo-scenario.mjs` and `--decline` | Turn on → Pause; Not now → gentle note only |
| Real Edge, local stack: ask → question → Review privacy (nothing changes) → Turn on → Pause on the TV → TV reports it shown → Call Meera; Not now → gentle note, nobody told; TV closed → "sent", never "shown" | 15 / 15 |

Independent audits: three deep runs, `aud_0Y5lTT4wcH` (a partial, partly paraphrased diff), `aud_6tkf0asOM7` (the whole change, condensed, with the tests summarised) and `aud_1EOSt8PKHq` (verbatim diffs and the three new test files in full; one of five reviewers found nothing). The first two returned "has serious issues" from all five reviewers. They found real gaps (legacy windows honoured, idempotency without an id, pending labels living past 30 minutes, cleanup not durable, a resident token able to report "shown", wording that said more than the code did, and more); each accepted finding was fixed test-first, and every decision, including three rejected with evidence, is in [`security-review.md`](security-review.md). None of the audits certifies the change, and the fixes after the third were not re-audited: they were checked by their tests and a reading of the diff.

### 4c. Deployed and checked live (2026-10-17)

Commit `22ab5c2` was deployed to the hosted stack (`UPDATE_COMPLETE`, only the Hub Lambda and the concierge runtime changed) and then checked against the live hub: **75 checks that can fail, all passing**, plus a 30-minute offer-expiry run (fixed deadline, durable deletion, no Turn on after expiry: 7 / 7). Everything, including what was **not** tested live (no genuine Ring person event; delivery to a real inbox not checked; delivery-failure wording is unit-tested only), the artifact hashes and two observations that need your attention (the concierge's spoken paraphrase can overstate; two unexplained "Call Meera" resolutions while probing the emulator), is in [`deployment-record.md`](deployment-record.md). The Vega app was rebuilt from the same source and run on the Vega Virtual Device against the hosted hub for the new footage.

## 5. Blockers, in order of importance

| # | Blocker | Why it matters | Action |
|---|---|---|---|
| 1 | **Demo video** built (2:49, under the 3:00 limit) but **not uploaded** | A required submission artifact; judges may judge from it alone | Upload `D:\kinwise-demoinal3\kinwise-demo.mp4` to YouTube or Vimeo as **public** (captions: `kinwise-demo-captions.srt`), then open the link in a private window to confirm it plays without signing in; the link goes in the form. Nothing here claims it is published. |
| 2 | **Devpost form** not filled: description, product feedback, tracks, mini-challenge fields, friction log | Required fields; the friction log is worth up to 10% only if entered | Paste from `docs/devpost-draft.md` and `docs/friction-log.md`; save a draft by Oct 22 |
| 3 | **Testing instructions** with demo tokens | Judges may test the hosted demo | `node scripts/demo-tokens.mjs`, paste into the private testing field |
| 4 | **Hosted stack must stay up through Nov 20** | The rules require free access until the Judging Period ends | Keep the `Kinwise` stack deployed; the `kinwise-monthly` budget ($25) emails 9284233564p@gmail.com; check credits |
| 5 | GitHub **About description and topics** are empty on both repos | First impression of the repo | Set them in the GitHub UI (suggested text in `docs/devpost-draft.md`) |
| 6 | Real **e-mail and SMS proof on your phone** | The strongest evidence that the family notification is real | Click the AWS confirmation for 9284233564p@gmail.com and send the SMS code; film the inbox |
| 7 | **Wake word** has not been heard through a real microphone | One claim in the README is only partly verified | Try "Alexa, is this call real?" once in your own Chrome |
| 8 | ~~Redeploy and re-record after the consent change~~ | **Done 2026-10-17/18**: `22ab5c2` deployed and checked live ([`deployment-record.md`](deployment-record.md)); the Echo question, the real Vega consent sheet and Pause, and Meera's sent / shown / not-confirmed answers were re-recorded from the deployed version and the video rebuilt | none |

## 6. Readiness verdict

**NOT READY TO SUBMIT, because two required artifacts are still with you: the demo video is built (2:49) but not uploaded to a public URL, and the Devpost form is not filled.** **The product itself is READY WITH DISCLOSED LIMITATIONS.** The code is deployed and checked live (75 checks that can fail, all passing, plus the 30-minute expiry run), the footage matches the deployed behaviour, and the limits (simulated Alexa+, no Ring person scene so door events are the labelled simulator or controlled signed events, sandbox-only SMS, unproven wake word, delivery to a real inbox not checked in this release, a spoken paraphrase that can drift from the hub's exact words) are written in the README or `deployment-record.md` and are said or captioned in the video. Uploading the video and filling the form moves the verdict to READY WITH DISCLOSED LIMITATIONS.
