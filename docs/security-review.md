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
