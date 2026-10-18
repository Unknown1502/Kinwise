# Deployment record: consent release (2026-10-17)

What was deployed, from what source, and what was checked against the **live** stack afterwards. Nothing here is a claim about code that was not run. Secrets, tokens and the AWS account number are not recorded.

## 1. The deployment

| Item | Value |
|---|---|
| Source | commit `22ab5c23fea36532efb1e52cc2c0aa2ef0973edb` on `main` (`origin/main` identical, working tree clean when deployed) |
| Command | `cd infra && npx cdk deploy -c sms=true --require-approval never` (`-c sms=true` keeps the SMS channel the hosted demo already had) |
| Region / stack | `us-east-1` / `Kinwise` |
| Started / finished | CloudFormation update started 2026-10-17 13:24:43 UTC; CDK exit code 0 at 13:25:18 UTC (deployment time 42 s) |
| Stack status afterwards | `UPDATE_COMPLETE` (13:25:16 UTC); previous update was 2026-10-16 13:22 UTC |
| What changed | exactly two in-place updates, as shown by `cdk diff` before deploying: the Hub Lambda code and the AgentCore concierge code. No IAM, environment-variable or resource changes. |
| Hub Lambda | `nodejs22.x`, `arm64`, `LastUpdateStatus: Successful`, last modified 13:25:06 UTC; code S3 key (CDK asset hash) `5061f2bf65d834547d6c6bbe88d1f6ed284583b2b7218d6b100d4f4903f7ba6b.zip`; Lambda `CodeSha256` `9j73rsivYdUccshn8YRbjDZqexT02nX3O3FPzUMn+uw=` (base64 of the uploaded package), 1,561,874 bytes |
| Concierge runtime | AgentCore Runtime `kinwise_concierge`, status `READY`, updated 13:24:59 UTC; code S3 prefix (CDK asset hash) `e6f8104be4f4ce3810a2c9364c2becb813d82943f2b4d637bd86aabae8194828.zip` |
| Rollback | redeploy `32c8733` (the last commit with the old behaviour) from a clean checkout after rebuilding the concierge bundle. **Not used.** |

The two asset hashes are the ones `cdk diff` showed before the deploy; the deployed template carries the same two names.

## 2. Hosted checks after the deploy

Run by `scratchpad/hosted_smoke.py` against the hosted hub, using the demo household, the three demo personas and (for door events) a signed event built with the ingest secret. Tokens and the secret are derived inside the process and never printed.

**What "event" means here.** Door events in these checks are **controlled signed events**: the hub's own `POST /events/visitor` endpoint, signed with the ingest secret, or the labelled demo doorbell. They are **not** a genuine Ring detection: the Ring Developer Playground has no person scene. The checks show how the hub decides on a supported event, not that Ring saw a person.

**What "delivery" means here.** "Notice sent" in these checks is the hub's own record (the in-memory outbox and the stored notice list) that a notice was handed to the configured channels. **Arrival in a real inbox or phone was not checked in this session.** The delivery-failure wording ("I could not confirm… call Meera yourself") is covered by a **unit test** (`watch-consent` T6), not by a live failure.

Total recorded: 78 rows, 77 passed, 1 failed (a wrong assertion in the script, replaced by a corrected re-check that passed). Two passing rows cannot fail by construction (one hard-coded informational line, and the original Meera-summary assertion that ended in `or True`) and are **not counted**. **75 checks that can fail, all passing.**

| # | Requirement | Live result |
|---|---|---|
| 1 | A flagged call produces an offer, not a running watch | passed: `watch.state` is `offered`, no safety window, no family notice |
| 2 | Only the authenticated TV can turn it on | passed: TV `turn_on` naming the open question starts the watch once; the window has `consentedAt`; repeating it is idempotent |
| 3 | Voice, Echo, MCP and unauthorised callers cannot | passed: Asha's MCP and the `/tv/watch` route with her token return "needs the TV" and change nothing; the TV token on MCP is `403 insufficient_scope`; Meera's token and the service token cannot answer; no token and a forged token are `401`; a TV `turn_on` with no question id is `400`; a wrong id starts nothing; a spoken "yes, turn it on" through the concierge starts nothing |
| 4 | "Not now" and the one-hour cooldown | passed: nothing turned on; stored state keeps only the three content-free facts and no labels; a second flagged call within the hour asks nothing; Asha's timeline records the decline, Meera's does not |
| 5 | "Review privacy" changes nothing | passed on the Echo and on the TV route: the offer, its deadline, the document version, the consent and the signs are unchanged; the text states 30-minute / next-run deletion, 35-day backups and the Not-now note |
| 6 | Fixed 30-minute deadline, durable deletion, no Turn on after expiry | passed (see section 3) |
| 7 | Revocation, screening off and door alerts off | passed: each ends a running watch, withdraws an open question, empties the stored window's categories and signs, and Turn on is refused while door alerts are off |
| 8 | Stale and duplicate events | passed (controlled signed events): a supported event with the watch on gives a Pause; the same event id again is ignored; an event 2 h old and one dated 90 min ahead are ignored; motion with no person gives no alert; a wrong signature is `401`; a signed event cannot ask to skip the schedule; a door event while door alerts are off is ignored |
| 9 | A sent Pause is not shown until the TV says so | passed: delivery is `sent`; Meera's text says Kinwise is waiting for the TV app and does **not** say it was on screen |
| 10 | An authorised TV render report makes it "shown" | passed: delivery becomes `shown`, a repeat writes nothing, and Meera's text says "the TV app reported that the Pause was on screen" |
| 11 | No report for 60 s means "not confirmed" | passed after a real 64 s wait; the text says the TV app has not reported it and it may not have been seen |
| 12 | An unauthorised display report is refused | passed: Meera's token and Asha's (voice/Echo) token cannot report "shown" (`401`/`403`, delivery stays `sent`); an unknown alert id is refused |
| 13 | Family wording, including delivery failures | wording on `sent`, `shown` and `not_confirmed` passed live; **delivery-failure wording is unit-tested only** (T6) |
| 14 | Privacy and family-access limits | passed: Meera's token is refused on the TV state, watch and consent routes and has no resident tools; with family alerts off a Pause reaches the TV and no family notice is recorded; none of the resident's own words reach anything Meera can read, any notice, or the stored document (11 checks, including a negative control that proves the detector can fail); with timeline sharing off Meera's timeline is refused and carries no door lines, while Asha can still read hers |

Corrected assertion: the first Meera-summary row asserted something no rule in the code defines ("a summary does not expose door detail" when family alerts are off) and ended in `or True`, so it could never fail. It was replaced by the checks in row 14, which test two contracts the code does define: the resident's words never reach family-readable surfaces, and "share my timeline" off refuses the timeline.

## 3. Offer expiry (the 30-minute run)

Started 13:32 UTC, finished 14:03 UTC (1,853 s), with nothing polling the TV. Result: **7 / 7 passed.**

- The stored offer's deadline was exactly 30 minutes after the first sign (`14:02:21.257Z`).
- The stored offer holds only category labels (at most ten), and none of the call's words.
- A later flagged call, four minutes in, did **not** move the deadline or replace the offer.
- After the deadline the TV reported no question; the next hub read deleted the offer and its labels from the stored document. (There is no timer: deletion happens on the next read. With nothing polling, the labels stay stored until then. This is disclosed in the privacy text, the README and the spec.)
- "Turn on" naming the expired question started nothing.

The line "document is not rewritten by a timer" in that run is informational and always passes; it is not evidence.

## 4. Not tested live, and observations

- **No genuine Ring person detection.** Door events are controlled signed events or the labelled doorbell simulator.
- **Delivery to a real inbox or phone was not verified** in this session (see section 2).
- **The delivery-failure wording** is unit-tested only.
- **The concierge's spoken paraphrase can drift from the hub's text.** The hub's own words were correct in every live check. The Nova 2 Lite concierge that speaks them on the Echo sometimes softened them: for a Pause that was only *sent*, the question "Did Mom see the warning on her TV?" was once answered "Yes, the warning appeared on her TV", and for the *not-confirmed* state it said "the TV didn't show a pause screen". The authoritative wording is the hub's tool result, which the Echo simulator shows under "Show under the hood". Not changed in this release.
- **Unrequested answers on the emulator during recording.** While recording on the Vega Virtual Device, the on-screen question or Pause was answered several times with no key sent by this session: two Pauses resolved as "Call Meera" about 20 s after appearing, one question answered "Not now" and two "Turn on" 15 to 25 s after the sheet appeared (the last two with the emulator window moved off-screen). The app has no timer or code path that answers by itself (checked), an idle control run and a concierge-only run left the question open, and the owner then said they had been clicking on the screen, so the cause is most likely human or other input to the emulator or its host, not the app. Each answer was a real action on the hosted demo household and recorded a call request or a watch (and, for "Turn on", the message to the family channels); none of those notices was checked in a mailbox. The footage in the video was therefore recorded only from takes whose state log shows no answer before the scripted key press.
- **Hosted notices.** The checks created notices through the hub's channels (e-mail via SNS to the demo caregiver, and the SMS sandbox). They were not inspected in a mailbox.
