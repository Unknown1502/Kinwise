# Measured, not demonstrated

Every row below is run through the real Kinwise service (the same code the hub runs, with a fake clock), then compared with a **door-only** rule. Rerun it any time:

```bash
npm run scenarios -w @kinwise/hub          # prints this table
npm run scenarios -w @kinwise/hub -- --write   # rewrites this file (a test fails if it drifts)
```

**Door-only** is not a named product. It is Kinwise's own rules (the expected-visitor list, privacy time, presence) *without* the phone call: it never hears that Asha asked about a scam. A door-only rule has one policy for a stranger, so both are shown: **urgent** (alert and tell the family every time) or **calm** (a quiet note every time).

What Kinwise shows: **Pause** = the full-screen Pause on the TV (and the family is told when risk is high); **Note** = a gentle card; **Greeting** = an expected visitor, no alarm; **Quiet** = nothing.

| Situation | Truth | Kinwise | Door-only, urgent | Door-only, calm |
|---|---|---|---|---|
| Scam call checked at 10:20, a courier rings at 2:41 PM | a scam | Pause ✔ caught | Alert ✔ caught | Note ✘ missed |
| Reminder "courier from the bank" saved at 10:15, a courier rings at 2:41 PM | a scam | Pause ✔ caught | Alert ✔ caught | Note ✘ missed |
| Scam call checked at 8:00 AM, a courier rings at 2:30 PM (6½ hours later) | a scam | Note ✘ missed | Alert ✔ caught | Note ✘ missed |
| A delivery driver rings at 2:41 PM, no call that day | harmless | Note | Alert ✘ false alarm | Note |
| A neighbour drops by at 5:00 PM, no call that day | harmless | Note | Alert ✘ false alarm | Note |
| Scam call checked at 9:30, the gardener arrives at 10:15 (his usual hour) | harmless | Greeting | Greeting | Greeting |
| The home-health aide arrives on her Tuesday at 2:30 PM | harmless | Greeting | Greeting | Greeting |
| Scam call checked at 10:20, Asha turns on privacy time, someone rings at 12:30 | by design | Quiet | Quiet | Quiet |
| Scam call checked at 10:20, the doorbell sees motion but no person at 2:41 PM | by design | Quiet | Quiet | Quiet |

## Scorecard

| | Scams caught | False urgent alerts on harmless visitors | Family pinged |
|---|---|---|---|
| **Kinwise** | 2 of 3 | 0 of 4 | 1 |
| Door-only, urgent for every stranger | 3 of 3 | 2 of 4 | 5 |
| Door-only, calm for every stranger | 0 of 3 | 0 of 4 | 0 |

## What this says, and what it does not

- Knowing about the call is what lets Kinwise be **urgent when it matters and calm when it does not**. A door-only rule must pick one: it either cries wolf at every delivery and neighbour, or it never raises the alarm.
- **Kinwise misses one scam**, reported as a failure: a courier who arrives after the 6-hour risk window has closed (`RISK_WINDOW_HOURS` in `packages/hub/src/domain/risk.ts`). A longer window would catch it at the cost of more Pauses. That trade-off belongs to Asha and her family, so it is left as it is.
- Privacy time and "nobody visible" are choices, not detections, so they are not scored.
- These are scripted situations, not a field study. They prove the rules do what they claim; they do not estimate how often scams really happen.
- The Pause also tells Asha *why*: "At 10:20 AM you asked Kinwise about a call, and it matched courier-scam warning signs." It is built from the time and kind of each earlier warning, never from the words said, and the family never see it for a reminder (reminders are Asha's own).
