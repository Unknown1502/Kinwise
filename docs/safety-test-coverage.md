# Safety engine: which test proves which case

The door decision is deterministic and explainable: `packages/hub/src/domain/decide.ts` (the Pause decision), `risk.ts` (the warning window), `visits.ts` (expected visitors) and `patterns.ts` (the warning signs). No model makes a safety decision. This table maps each case a skeptical reviewer would ask about to the test that fails if it breaks. Run them all with `npm test` at the repository root.

| Case | Expected behaviour | Test that proves it |
|---|---|---|
| A suspicious call, then an unexpected visitor | Pause on the TV; family told once, as a signal | `service.test.ts` "runs reminder → check → unexpected visitor → Pause → Call Meera"; `domain.test.ts` "shows the Pause and alerts family for an unexpected visitor in a high window"; `docs/evaluation.md` rows 1 and 2 |
| An expected visitor (gardener, aide), even during a watch | A calm greeting, never a Pause | `domain.test.ts` "treats an expected visitor calmly even inside a high window"; `service.test.ts` "greets an expected visitor without alarm even during a high window"; `docs/evaluation.md` rows 6 and 7 |
| An unexpected delivery or neighbour with no call that day | A gentle note, not an alarm | `domain.test.ts` "shows a gentle card with no window"; `service.test.ts` "shows a gentle card for an unexpected visitor with no risk"; `docs/evaluation.md` rows 4 and 5 |
| A suspicious call and **no visitor afterwards** | One signal to the family; nothing on the TV; the watch lapses by itself | `service.test.ts` "a suspicious call with no visitor afterwards: the family hears once, nothing pops up, and the watch lapses by itself" (added 2026-10-16) |
| An **expired** warning | The watch closes; an old call no longer raises a Pause | `domain.test.ts` "forgets signals older than 24 hours", "treats a closed or expired window as inactive"; `docs/evaluation.md` row 3 (the one miss, reported) |
| Privacy time or revocation | Nothing is stored or shown; only a counter | `domain.test.ts` "ignores everything during a privacy hour", "ignores when door awareness is off", "respects caregiverAlerts consent"; `service.test.ts` "stores nothing during a privacy hour, only a counter"; `docs/evaluation.md` row 8 |
| **Duplicate** Ring events | Handled once | `service.test.ts` "is idempotent on visitor event ids"; ring worker: "first start ignores older events and dedupes" |
| **Delayed or stale** Ring events (a retried webhook, a backlog after an outage) | Ignored: they describe a visitor who has gone | `domain.test.ts` "a door event must be fresh" (4 tests) and `service.test.ts` "a doorbell event that arrives hours late is ignored" (added 2026-10-16: **the hub had no age check before this; only the Ring worker did**, "stale events after a long downtime are skipped") |
| Ring, the network or AWS unavailable | The TV keeps its last state, backs off, says "Reconnecting…" and never claims safety; the worker retries | `tv-preview/test/poller.test.ts` ("backs off 4 s, 8 s, 15 s, 15 s on errors and recovers to 2 s", "is false within 10 s and true after"); ring worker: "hub outage is retried on the next poll", "post_visitor retries 5xx with backoff", "gives up after three network errors", "does not retry 4xx" |
| A family notice that could not be delivered | The TV says "We couldn't reach Meera", never "Calling Meera now" | `callback.test.ts` "says NOT delivered when the real channel failed"; `tv-preview/test/render.test.tsx` "says so, aloud and on screen, when Meera could not be reached" |
| Nobody answers the family call | A second message at about 2 minutes; the TV says so at 2 and 5 minutes | `callback.test.ts` "Nobody answered: re-send, then say so"; `followup.test.ts`; live test on AWS, 2026-10-14 |
| A caregiver tries to see or change what they may not | Refused | `service.test.ts` "enforces roles", "keeps reminders private from the caregiver and logs every caregiver read", "respects the resident choosing not to share the timeline"; `contacts.test.ts` ("one caregiver cannot read or change the other's"); `callback.test.ts` "the confirm link under attack" |
| The resident dismisses the Pause | Closed, nobody is called, no follow-up scheduled | `callback.test.ts` "does not claim a call for the other answers"; `followup.test.ts` "schedules nothing for the other answers" |
| A false positive and a false negative | Both reported | `docs/evaluation.md` scorecard: Kinwise 2 of 3 scams caught, 0 of 4 false urgent alerts, **1 miss reported**; a door-only rule either alarms on 2 of 4 harmless visitors or catches 0 of 3 |

## What this does and does not show

- These are **scripted situations and unit tests**, not a field study. They prove the rules do what they claim. They do not estimate how often real scams happen or how often real doorbells misfire.
- The evaluation compares Kinwise with a door-only rule built from Kinwise's own parts. It is a design comparison, not a benchmark against a named product.
- The 6-hour warning window and the 5-minute freshness limit are judgement calls, written as named constants (`RISK_WINDOW_HOURS`, `EVENT_MAX_AGE_MS`) so a reviewer can see and change them.

## The 17 situations, end to end (added 2026-10-16 with the consent step)

Every row names a test that fails if it breaks. "Scenario row" means a line in [`docs/evaluation.md`](evaluation.md), run by `npm run scenarios -w @kinwise/hub`. Tests are in `packages/hub/test/` unless a path says otherwise.

| # | Situation | Trigger → backend decision | What Asha sees | What the family gets | Privacy invariant | Evidence |
|---|---|---|---|---|---|---|
| 1 | Watch authorised, then an unexpected visitor | flagged call → question → **Turn on** → visitor → `pause` | The Pause, with why | One safety signal, sent when she turned it on | Only category labels stored | `watch-consent` S1.2; `service` "runs reminder → check → …"; scenario row 1 |
| 2 | Ordinary expected delivery or visitor | visitor on the expected list → `expected` | A calm greeting | Nothing | — | `domain` "treats an expected visitor calmly even inside a high window"; scenario rows 6, 7 |
| 3 | Expected visitor during an active watch | same, inside a high window → `expected` | Greeting, never a Pause | Nothing | — | same tests |
| 4 | Suspicious call, no visitor | watch on, no door event | Nothing on the TV; the watch lapses | One signal at Turn on | — | `service` "a suspicious call with no visitor afterwards…"; scenario row "call-no-visitor" |
| 5 | Unexpected visitor, no scam signal | visitor, no window → `gentle` | A gentle note | Nothing | — | `domain` "shows a gentle card with no window"; scenario rows 4, 5 |
| 6 | Expired safety signal | visitor after the 6-hour window → `gentle` | A gentle note (the one reported miss) | Nothing | — | `domain` "forgets signals older than 24 hours"; scenario row 3 |
| 7 | Resident refusal | **Not now** → no window, warning signs dropped, no re-ask for an hour | Advice only; later a gentle note | **Nothing** | No signs or categories kept. Only three content-free facts remain: a timeline line for Asha alone (hidden from family), the no-ask-until time, her last answer's id | `watch-consent` S2.1, S2.2, S2.3; browser check "Not now…"; scenario rows "watch-declined", "watch-unanswered" |
| 8 | Revocation before a visitor | she ends the watch, switches screening off, or switches door awareness off | Gentle note or nothing | Nothing new | A pending question and its signs are withdrawn | `watch-consent` S6.3, S7.1; scenario rows "watch-ended", "screening-revoked", "door-revoked" |
| 9 | Privacy time | privacy hour → `ignored` | Nothing | Nothing | Only a counter | `service` "stores nothing during a privacy hour…"; scenario row 8 |
| 10 | Duplicate Ring event | same `eventId` twice → second is `ignored` | One Pause | One signal | — | `service` "is idempotent on visitor event ids"; scenario row "duplicate-event" |
| 11 | Delayed event (older than 5 minutes) | `stale_event` → `ignored` | Nothing | Nothing | — | `domain` "a door event must be fresh"; `service` "a doorbell event that arrives hours late is ignored"; scenario row "late-event" |
| 12 | Invalid, future-dated or forged event | bad signature → 401; more than 2 minutes in the future → `ignored` | Nothing | Nothing | — | `http` "rejects a bad signature"; `domain` "allows a minute or two of clock difference, but not an event from the future" |
| 13 | Family notification failure | channel fails | The TV says "We couldn't reach Meera" | — | — | `callback` "says NOT delivered when the real channel failed"; `tv-preview/test/render.test.tsx` |
| 14 | TV state unavailable or delayed | the TV never reports the Pause | The hub says **sent**, then **not confirmed** after 60 s; never "shown" | The message says Kinwise cannot tell whether she saw it | — | `pause-delivery` S1.1, S2.1, S3.1; browser check "With no TV app open the Pause is 'sent'" |
| 15 | Unauthorised caregiver | a caregiver or service identity tries to answer, read or change | Refused | — | The request is refused and logged | `watch-consent` S4.1, S9.1; `service` "enforces roles"; `contacts` |
| 16 | Resident dismisses the Pause | `dismiss` → resolved | Closed | Nobody called | — | `callback` "does not claim a call for the other answers" |
| 17 | Recovery after a network interruption | the TV or worker loses the hub, then it returns | "Reconnecting…", last state kept, then caught up | — | — | `tv-preview/test/poller.test.ts` ("backs off … and recovers"); ring worker "hub outage is retried on the next poll" |

### Added after the audit of 2026-10-17

| Case | Test |
|---|---|
| A repeated answer with or without the offer id does nothing twice; a different answer is refused | `watch-consent` A1, A3 |
| A replay never says "already on" once the watch ended | `watch-consent` A2 |
| An unanswered question is deleted, and holds at most ten signs | `watch-consent` B1, B2 |
| A watch opened by an older version without consent is not honoured | `watch-consent` C1 |
| Old "Pause was shown" lines are not counted as confirmed | `watch-consent` C2 |
| Turning scam screening off ends a running watch | `watch-consent` D1 |
| One weak sign starts no question and is not kept | `watch-consent` E1 |
| The question is spoken whenever one is open | `watch-consent` F1 |
| No family-facing view mentions a decline | `watch-consent` G1 |
| A resident token cannot report "shown"; a repeat report writes nothing | `pause-delivery` S4.2, S4.3 |

### Voice authorization (added 2026-10-17, second round)

| Case | Test |
|---|---|
| A resident (voice, Echo or MCP) token saying "turn on" starts nothing, sends nothing and writes nothing | `voice-authorization` V1 |
| The same question then answered on the authenticated TV starts the watch once | `voice-authorization` V2 |
| By voice she can still say not now and review privacy | `voice-authorization` V3 |
| Alexa says aloud, and the card says, where to confirm | `voice-authorization` V5; `scripts/golden-path-check.py` |
| The TV shows the question as a sheet with "Not now" focused; Back only tucks it away | `tv-preview` render tests; `selectScreen.spec` |
| The TV says the question aloud once | `narration.spec` |

### Second audit round (2026-10-17)

| Case | Test |
|---|---|
| The pending offer's deadline never moves; old labels are gone when it runs out | `watch-consent` R1 |
| The offer holds at most ten category labels | `watch-consent` R2 |
| Cleanup is durable on a plain read, and polling does not keep writing | `watch-consent` R3 |
| "Review privacy" works with no question open and writes nothing | `watch-consent` R4 |
| Closing a legacy watch or revoking screening deletes the stored signs; old households are migrated once | `watch-consent` R5, R6 |
| "Turn on" records nothing when the signs can no longer open a watch | `watch-consent` R7 |
| A spoken turn-on after the TV did says "already on" | `watch-consent` R8 |
| No offer with door awareness off | `watch-consent` R9 |
| A closed legacy watch leaves a line for her | `watch-consent` R10 |
| The question and the answer match what happens (messaged now at high, later at elevated) | `watch-consent` R11 |
| Family-facing "shown" wording claims only what the TV app reports | `watch-consent` R12 |
| The privacy text is true (end on TV; privacy time only quiets the Pause; backups) | `watch-consent` R13 |
| The TV token cannot call MCP tools | `watch-consent` R14 |
| The TV retries a failed "shown" report | `tv-preview` render test |
| A reminder containing "turn it on" is a reminder; a long request with "not now" is not a decline | `agents/concierge/tests/test_offline.py` |

### Honest reading of this table

- Unit and integration tests prove the rules do what this page says. The scenario suite is 17 scripted situations on one synthetic household; it does not measure how often real scams or real doorbells behave this way, and it says nothing about real-world effectiveness.
- **Asking first costs coverage.** In rows 7 and 8 Kinwise deliberately catches nothing, because Asha did not (or no longer does) consent. That is the design, not a bug; how often real residents would say "Not now" is unknown.
- "Shown" means the TV app reported it rendered the Pause. It does not mean Asha looked at it, and Kinwise cannot observe whether it is the foreground app.
