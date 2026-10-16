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
