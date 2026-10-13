# Submission checklist (Amazon AppDev 2026, deadline Oct 23, 12:00 PM PT)

Every rule requirement, the evidence in this repo, and its status. ✅ done · 🔄 in progress · ⬜ to do (team)

## Eligibility and repository
| Requirement | Evidence | Status |
|---|---|---|
| New project built during the hackathon window | Git history starts 2026-10-05 | ✅ |
| Public GitHub repo with an OSS license, source and run instructions | github.com/Unknown1502/Kinwise (Apache-2.0); README "Run it locally"; `scripts/setup.mjs` + `scripts/dev.mjs` | ✅ |
| A judge can run it locally without our accounts | `node scripts/dev.mjs --offline` (dev tokens, offline concierge); verified on a fresh clone | ✅ |
| No secrets in the repo | History scanned (tokens, AWS keys, account id, phone, email); `.gitignore` covers tokens, captures, `.env`, CDK outputs | ✅ |

## Track checks (each selected track is a pass/fail "uses the required tech")
| Track | Requirement | Evidence | Status |
|---|---|---|---|
| Alexa+ | Self-hosted MCP server, spec ≥ 2025-11-25, Streamable HTTP | `packages/hub/src/mcp/server.ts`; conformance 16/16 locally and hosted | ✅ |
| Alexa+ | Simulated experience: source in repo and clearly shown as simulated | `packages/echo-sim` with a persistent "Simulated Alexa+ surface" label | ✅ |
| Alexa+ | Hosted endpoint live through Nov 20 | AWS stack `Kinwise` (us-east-1); keep it deployed and keep credits funded | ✅ ⬜ (keep alive) |
| Ring | Ring API/SDK/simulator imported and actually called at runtime | `agents/ring-worker` (official Partner API); verified on the Developer Playground 2026-10-06 | ✅ |
| Caregiver notification | Real delivery when Asha presses Call Meera | E-mail through SNS, with a signed one-tap "I'm calling now" link that puts a note from Meera on the TV; an honest "couldn't reach Meera" screen when no real channel accepted it. ntfy phone push and a WhatsApp sender are built but need an app install or a paid Twilio account (friction log #15). Not built: re-send, escalation, a second caregiver, SMS. "Delivered" means a channel accepted it, not that a person read it | ✅ e-mail, ⚠️ the rest |
| Ring | "Person at the door" on real Ring video | The Playground has only Package, Vehicle and Motion scenes and no way to pick one through the API (friction log #13); every real frame shows the Package clip with no person, and Kinwise correctly stays quiet. The Pause is shown from the labelled doorbell simulator through the same hub rules | ⚠️ real Ring proof is the empty-doorstep case; person case is simulated |
| Fire TV | App runs on Vega OS (simulator acceptable) | `packages/tv-app` built with Vega SDK 0.24.12112; runs on the Vega Virtual Device, showing the Pause driven by the hosted hub (2026-10-07) | ✅ |

## Mini-challenges (one prize max; select both)
| Item | Evidence | Status |
|---|---|---|
| AWS Builder: documented AWS integrations | README "How each Amazon technology is used", `infra/` (CDK), AgentCore Runtime + Memory, Strands, Nova 2 Lite, Cognito, Lambda, DynamoDB, SNS, Secrets Manager | ✅ |
| Open Source: contribution URL | https://github.com/Unknown1502/alexa-plus-mcp-kit | ✅ |
| Open Source: project repo URL | https://github.com/Unknown1502/Kinwise | ✅ |
| Open Source: GitHub username | Unknown1502 | ✅ |
| Open Source: description of the work | Team writes it (see `packages/alexa-plus-mcp-kit/README.md` for facts) | ⬜ |

## Submission content (judges may score from text + images + video alone)
| Item | Notes | Status |
|---|---|---|
| Demo video under 3:00, best material first | Show: Fire TV on Vega, the Echo simulator (labelled simulated), Ring Playground → worker → Pause, AWS console/traces | ⬜ |
| Screenshots / gallery images | Echo Show cards, Fire TV Pause, Today board, family timeline, architecture diagram | ⬜ |
| Devpost text (inspiration, what it does, how we built it, challenges, accomplishments, learnings, what's next) | Written by the team in their own words | ⬜ |
| Product Feedback for every tool used | Source notes: `docs/product-feedback-notes.md` (Alexa+, Ring, Fire TV/Vega, AWS) | ⬜ |
| Friction Log (up to +10%) | `docs/friction-log.md`, 15 first-hand entries | ✅ (attach/link) |
| Testing instructions for judges | Hosted endpoints + demo tokens (`node scripts/demo-tokens.mjs`) go in the private testing field, never the repo | ⬜ |
| Select tracks: Fire TV, Alexa+, Ring + both mini-challenges | Devpost form | ⬜ |
| Submit a draft early (Oct 22), final by Oct 23 9:00 AM PT | Devpost | ⬜ |
