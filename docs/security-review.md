# Security review of the caregiver contacts, SMS and follow-up code

On 2026-10-14 the newest, riskiest part of Kinwise was sent to an independent multi-model audit (run `aud_WUFPSwPEZF`, "deep", high stakes). Four models from four vendors reviewed it and a fifth failed to answer. All four came back with serious findings. Each finding was checked against the code and the deployed account, and the result is below.

**What was reviewed, and its limit.** The reviewers read a written description of the code (about 4,000 characters), not the source or the deployed policies. They said so. The findings are therefore leads, and every one was checked by us before it was accepted or rejected.

The earlier changes (the first push and e-mail work, the confirm link) were not independently audited, because the audit service was failing for every reviewer on the earlier attempts (see the commit messages). They had our own review and tests, including attack tests for the confirm link.

## What was found, and what we did

| Finding | Reviewers | Verdict | What we did |
|---|---|---|---|
| Removing an old e-mail subscription matched on the address only, so a caregiver changing their address could remove another caregiver's subscription | all four | **Accepted** | Unsubscribe now reads each matching subscription's filter and removes only the one whose filter names this caregiver and household. A caregiver cannot set an address another family member already uses. Tests cover the shared-address case. |
| An old subscription still waiting for confirmation cannot be removed (it has no ARN), so if someone later confirms it they would receive that caregiver's notices | three | **Accepted** | Every address now gets a random key, put in the subscription's filter and stamped on each e-mail. A new address means a new key, so a late-confirmed old subscription matches nothing new. The key is never shown to the caregiver. |
| `sns:Unsubscribe` was granted on the topic, but SNS authorizes it on the subscription | one | **Accepted, and it exposed a real bug (then a second one in our first fix)** | The IAM policy simulator showed the hub could not call `GetSubscriptionAttributes` (needed to check who owns a subscription), so changing a confirmed address could never have worked (it failed closed). Our first fix scoped the grant to the subscription ARNs, and **that was wrong too**: SNS has no resource-level permissions for these two actions, IAM evaluates them against `*`, and a scoped grant never matches (AWS also documents that `Unsubscribe` is not restricted by IAM). The correct grant is `*` for just those two read/remove actions; the hub only names subscriptions it found by listing its own topic. |
| The scheduler's direct-invoke event was a plain JSON string with no binding to a call, so anything able to invoke the function could trigger it, and an overlapping call could confuse it | three | **Accepted** | The event now carries the call id and a signature (HMAC with the hub's own secret) over household and call. An unsigned, mis-signed or mismatched event is refused and logged. The scheduler role's trust policy is also limited to this app's own schedules (`aws:SourceArn`). |
| The one-change-a-minute gate was checked before SNS was called, so two parallel saves could both subscribe | one | **Accepted** | The gate is claimed first. A save that fails validation does not use it up. If the record cannot be saved after SNS changed, the subscription is put back. |
| `sns:Publish` on every resource (required for texting a phone number) | all four | **Partly accepted** | Splitting it onto a second role would not narrow it, because the second role would also need `*`. What does reduce exposure: **SMS is now off by default** (`-c sms=true` to turn on), so the broad grant exists only when SMS is wanted. |
| `FilterPolicy` must be a JSON string, not an object | one | **Rejected** | It already is: the code passes `JSON.stringify(...)`, and a test asserts a string that parses to the policy. |
| Delete the schedule when the caregiver confirms | one | **Rejected** | A leftover schedule costs a single cheap invocation that finds the call confirmed and does nothing, and deleting adds a permission and a failure path. |
| Listing every subscription on a shared topic does not scale; allow-list phone countries and require a one-time code before SMS | one | **Noted** | Out of scope at demo scale. A production system would keep each subscription ARN per caregiver, and would verify a number by one-time code before the first text. The AWS SMS sandbox already limits sending to verified numbers. |

## Still open

- SMS has only been verified against the AWS SMS sandbox, and sending to India in production needs DLT registration.
- One shared topic carries every caregiver's e-mail. This is fine for a household demo, not for thousands of households.
- Nothing limits how often Call Meera can be pressed beyond the Pause lifecycle that offers the button.

## Audit of the consent and delivery change (2026-10-17, run `aud_0Y5lTT4wcH`, deep)

Five reviewers (OpenAI x2, Google, Anthropic, DeepSeek) read the hub core of the change: the types, the service, the views, the HTTP routes and the MCP server. **Limits of that audit, stated plainly:** the diff was excerpted and in places paraphrased by us, it did not include the tests, the TV app, the identity or persistence code, and the reviewers said so. All five returned "has serious issues" (28 findings in total, about 19 distinct). I wrote the code, so I only adjudicated; each decision below was checked against the code, and every accepted item has a test that failed first.

| # | Finding (reviewers) | Decision | Why |
|---|---|---|---|
| 1 | Only the TV may say "shown"; a resident token can (4 of 5) | **Accepted** | `markAlertShown` now needs the `device` role (`pause-delivery` S4.2) |
| 2 | An active window from an older version is honoured without consent (2 critical or blocking, 1 more) | **Accepted** | New `consentedAt` on the window; one without it is closed on first read and never extends or notifies (`watch-consent` C1) |
| 3 | Switching scam screening off leaves a running watch (2) | **Accepted** | It now ends the watch (D1) |
| 4 | An answer without the offer id is not idempotent (4 of 5, one blocking by two) | **Accepted** | A repeat is recognised with or without the id for 10 minutes (A1, A3). Residual risk, documented: an id-less retry of `not_now` that lands after a brand-new question exists acts on the new question (a `turn_on` can no longer be id-less from a voice, see item 17) |
| 5 | A replayed "turn on" says "already on" after the watch ended (3) | **Accepted** | The words follow the current state (A2) |
| 6 | An unanswered offer is never deleted (3) | **Accepted** | Deleted on the next read; capped at ten signs (B1, B2) |
| 7 | Old "Pause was shown" lines count as confirmed (2) | **Accepted** | Relabelled "sent" on read (C2) |
| 8 | An offer can exist without the question being asked aloud (4) | **Accepted** | An offer is made only when its signs could open a watch; the question is spoken whenever one is open (E1, F1) |
| 9 | The decline-hiding flag defaults to the resident view (1) | **Accepted** | The parameter is now required; no family-facing view shows it (G1) |
| 10 | "On until ." can be said when no window opened (1) | **Accepted** | The service checks that a window is active, otherwise it says nothing is on |
| 11 | The prompt says "ask again" during the one-hour pause (1) | **Accepted** | Wording now says it will not ask again for an hour (H1) |
| 12 | `alertView` can silently omit delivery when `now` is missing (1) | **Accepted** | `now` is required by the type |
| 13 | Repeat "shown" reports write and can collide with door events (1) | **Accepted** | A repeat is answered from a read, with no write (S4.3) |
| 14 | A watch can run past the six hours she was told (1) | **Accepted as wording** | The privacy text now says more signs can keep it on and she can end it at any time; behaviour is unchanged |
| 15 | Warning signs are stored in the offer before she consents (1, blocking) | **Rejected as stated, partly accepted** | The offer must hold the labels (categories, level, time; never words) so they can be applied only if she says yes. They live for at most 30 minutes, are capped, and are deleted on answer, expiry and revocation (items 6 and 3). Docs now say "waiting for her answer", not "nothing stored" |
| 16 | Any `device` identity can answer the question (1 critical) | **Rejected** | `device` is issued only to the TV token (`auth/verify.ts` dev token, `auth/secrets.ts` demo TV token); nothing else carries it. If more device types are added this must be revisited |
| 17 | A model reading a scammer's words, or another person in the room, could answer for her over MCP (1, low confidence) | **Accepted, then designed out for the consequential choice** | The hub cannot tell who spoke. Since the second audit round, a spoken or MCP `turn_on` starts nothing and sends nothing (it returns `needsTv`); only the TV device identity, which is authenticated as hers, can turn a watch on (`voice-authorization` V1, V2). A spoken `not_now` is still accepted: it can only keep the watch off for an hour, which is also what not answering does |
| 18 | "undefined" printed when there is no caregiver (1) | **Rejected** | `primaryCaregiverName` falls back to "your family" (`views.ts`) |
| 19 | Notices could duplicate across `mutate()` retries (listed as unverified) | **Not a finding** | `pending` is created fresh inside each attempt (`mutateNotifying`), and notices are sent only after a successful save |

This audit does not certify the change. It is one panel's review of a partial view; the fixes are covered by the tests above, not by a second audit.

## Second audit of the consent and delivery change (2026-10-17, run `aud_6tkf0asOM7`, deep)

Five reviewers (OpenAI x2, Google, Anthropic, DeepSeek). This time the input was the whole change against the pre-consent base (hub, card UI, Vega app and concierge source, the new tests' names and key assertions, the authorization files, the infrastructure change set). **Limits, stated plainly:** the code was transcribed in condensed form rather than as raw diff bytes, the three new test files were summarised rather than pasted (the Anthropic reviewer flagged exactly this), and README/docs, the browser script and some test diffs were not included. All five again returned "has serious issues" (38 findings, about 22 distinct). I wrote the code, so I only adjudicated; every accepted fix has a test that failed first.

| # | Finding (reviewers) | Decision | Why |
|---|---|---|---|
| 1 | Each new sign moves the offer's 30-minute deadline, so the oldest labels outlive "at most 30 minutes" (all 5, two blocking) | **Accepted** | The deadline is fixed at creation + 30 minutes and never moves (`watch-consent` R1) |
| 2 | Expiry and legacy cleanup happen only in memory until the next write (3, two blocking) | **Accepted** | `read()` now persists the cleanup once (conflict-safe); polling does not keep writing (R3). DynamoDB point-in-time recovery is on, so backups can keep earlier copies up to 35 days: the resident-facing text now says so |
| 3 | Closing a legacy watch, or revoking screening, leaves the signs it was built from, which a later consented watch could reuse (1) | **Accepted** | Both now delete the stored signs, and a household from before the model is migrated once (R5, R6) |
| 4 | The cap counts records, not category labels (3) | **Accepted** | The cap is on labels (R2) |
| 5 | The TV sheet says "a call you asked about" even for reminders and other signs (4) | **Accepted** | Source-neutral wording on the sheet |
| 6 | Pressing Turn on at high level messages family at once, while the question and the answer say "if it looks serious" (1) | **Accepted** | The question says "right away" at high level, and the answer says "I've told Meera" (R11) |
| 7 | "Review privacy" fails when no question is open (1) | **Accepted** | It works any time and writes nothing (R4) |
| 8 | "Turn on" saved signs and timeline lines before finding out that nothing could start (1) | **Accepted** | The check comes first; nothing is recorded if it fails (R7) |
| 9 | A spoken "turn it on" after the TV already did says the question ran out (1) | **Accepted** | It says the watch is already on and points to Settings (R8) |
| 10 | With door awareness off, a watch is still offered (1) | **Accepted** | Nothing is offered then (R9) |
| 11 | A legacy watch is closed silently (1) | **Accepted** | A line is added to her timeline (R10) |
| 12 | The "shown" report is not retried after a failed request (2) | **Accepted** | Retried with backoff, up to eight tries (`tv-preview` render test) |
| 13 | Ordinary requests containing "not now" or "turn it on" are taken as watch answers (1) | **Accepted** | Only short utterances count, and "remind me" is checked first (concierge tests) |
| 14 | The privacy text says she can end the watch "by asking me" and that privacy time ends it; neither is true (1) | **Accepted** | Text corrected: end it on the TV; privacy time only quiets the Pause (R13) |
| 15 | "Shown" is claimed when the app renders; the TV may be backgrounded or off (2) | **Accepted as wording, limit documented** | Family text now says "the TV app reported that the Pause was on screen". Kinwise cannot observe foreground or panel power on Vega and does not pretend to |
| 16 | A forged or replayed device report can mark a Pause shown; bind it to a presentation token (1) | **Rejected** | A per-Pause nonce is more machinery than the risk justifies: the same token can already turn a watch on, so the token is the trust boundary, now documented (spec §5.4). Not built |
| 17 | The whole gate rests on one long-lived bearer token on the TV; Cognito cannot issue `device` (2) | **Accepted as documentation and a test** | Hosted auth is Cognito plus derived demo tokens; the TV token cannot call MCP tools (R14). Wording changed from "it's you" to "the TV in your home" |
| 18 | A family notice from "turn on" can still go out if she revokes in the instant between the save and the send (1, blocking) | **Rejected, documented** | Send-after-save is inherent without a durable outbox; the window is milliseconds, the revocation is later in time than the consent, and the notice is true when queued. Not built |
| 19 | "Not now" blocks all signs for an hour, even strong ones, and she cannot undo it (2) | **Accepted as a documented trade-off** | It is the cost of "no pressure"; the evaluation says so. Not changed |
| 20 | The decline is hidden from family but `watch_on` is not (1) | **Rejected** | The family timeline already shows "Kinwise is watching the door more closely" by design when she shares her timeline, so `watch_on` adds nothing new |
| 21 | The deployed zips cannot be tied to the reviewed source (2) | **Accepted as process** | Deploy from the audited commit on a clean tree and record the asset hashes in the deployment record |
| 22 | Households on an old TV app cannot turn a watch on (1) | **Noted** | There is no installed base: the only TV client is the one in this repository, built from the same commit |
| 23 | The artifact paraphrased central code and tests (1) | **Acknowledged** | See the limits above; the fixes are covered by the executed tests, not by this audit |

Not a finding, checked: an "eval hides family pings for by-design rows" claim is wrong, because `scenarios.test` "never pings the family for a watch Asha declined, ended or never answered" asserts each such row separately.

Neither audit certifies this change. Both were single-panel reviews of a condensed view.
