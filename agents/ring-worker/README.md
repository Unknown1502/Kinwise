# Kinwise Ring worker (`kinwise_ring`)

The Ring worker turns activity from a Ring doorbell into **neutral, privacy-safe visitor events** and sends them, HMAC-signed, to the Kinwise hub (`POST /events/visitor`, spec §6.3). The hub alone decides what happens next (spec §5.6). The worker reports only *whether someone is at the door*, *how many people*, *what they are carrying* and *one neutral sentence*.

It uses the **official Ring Partner API** (`https://api.amazonvision.com`) at runtime. It does not use the unofficial `ring-client-api` or `ring_doorbell` libraries.

| Ring Partner API call | Used by |
|---|---|
| `GET /v1/devices?include=status,capabilities` | `devices`, and device discovery in every mode |
| `GET /v1/history/devices/{id}/events` | `poll` |
| `POST /v1/devices/{id}/media/streaming/whep/sessions` (SDP offer → SDP answer + `Location`) | `live`, `poll`, `webhook` (frame grab) |
| `DELETE {WHEP session URL}` | always, after every frame grab |
| `POST /v1/devices/{id}/media/image/download` | `snapshot` (returns 416 on the Playground) |
| `POST https://oauth.ring.com/oauth/token` (refresh_token grant) | linked-device auth |
| Webhooks (`X-Signature` HMAC-SHA256) | `webhook` |

```
Ring Playground / linked device
   │  event history · WHEP live view · webhooks
   ▼
ring-worker ── frame (memory only) ─► watermark crop ─► perception (Nova 2 Lite or offline)
   │
   └── {presence, count, carrying, description} ── HMAC-signed ──► hub /events/visitor
```

## Privacy guarantees (spec §7)

- **Frames never leave the worker.** A frame exists only in memory inside one `observe()` call. It is never sent to the hub, never logged and never written to disk. The one exception is the explicit `snapshot` developer command, which prints a privacy warning.
- **No identity, ever.** The vision prompt forbids identifying anyone and describing face, age, gender, race or ethnicity, skin, hair, body, clothing or uniforms. It also forbids judging appearance. Every answer is checked again in code: a description that contains appearance, demographic, role or judgement words is replaced with a neutral template such as "A person at the front door holding a small box".
- **Only the camera scene is analysed.** The top `WATERMARK_CROP` (15%) of the frame, Ring's mandatory watermark band, is cropped from the copy sent to the model. Nothing shown to a person has the watermark removed.
- **Audio is never read.** If the WHEP server insists on an audio m-line, it is negotiated receive-only and never consumed.
- **Logs contain no image bytes and no tokens.** Error bodies from media endpoints are summarised (for example `<5430 bytes of image/jpeg>`).
- **Local state** (seen event ids, a rotated refresh token) lives in `STATE_DIR` (`.kinwise-data/`), which is git-ignored. The worker also writes a catch-all `.gitignore` into that folder.

## Setup

```bash
cd agents/ring-worker
uv sync                 # Python ≥ 3.11; installs aiortc/PyAV wheels on Windows too
cp .env.example .env    # PowerShell: Copy-Item .env.example .env
```

### Getting a Ring Developer Playground token

1. Open <https://developer.amazon.com/ring/console/playground> and sign in.
2. Copy the access token. It lasts about **30 minutes**.
3. Paste it into `ring-token.txt` in this folder. The file is git-ignored.
   - Git Bash: `cat /dev/clipboard > ring-token.txt`
   - PowerShell: `Get-Clipboard | Set-Content -Encoding ascii ring-token.txt`
4. Set `RING_TOKEN_FILE=ring-token.txt` (this is already the value in `.env.example`).

The worker re-reads the file whenever it changes, so you can paste a fresh token without restarting. From 25 minutes on, it logs a warning once a minute with the time left. If the token is a JWT, the warning uses the token's own `exp`.

For a **linked device**, set `RING_CLIENT_ID`, `RING_CLIENT_SECRET` and `RING_REFRESH_TOKEN` instead. The access token (about 4 h) is refreshed automatically. A rotated refresh token is kept in `STATE_DIR/ring-oauth.json`.

## Modes

Run the hub first (`npm run dev:hub` at the repo root; it listens on `http://localhost:8787`).

### `live`: periodic live-view frame (main Playground demo)

The Playground has no webhooks, and its event history only logs live-view (`on_demand`) events. The reliable path is therefore to open a WHEP live view every `LIVE_EVERY_SECONDS`, grab one frame and run perception. When a person is present and `PERSON_COOLDOWN_SECONDS` have passed since the last reported person, the worker sends a visitor event (`source: "ring-playground"`, `eventId: live-{deviceId}-{epochSeconds}`). Pick the Package, Vehicle or Motion scene in the Playground to change what the camera sees.

**How the frame is decoded (verified against the real Playground, 2026-10-06).** Ring's live view is WHEP with H.264 baseline plus RTX. The default `FRAME_GRABBER=browser` lets headless **Edge or Chrome** decode it through Playwright: an installed browser is used (`BROWSER_CHANNEL=msedge|chrome`), nothing is downloaded, and a 1280×720 frame arrives in about 2.5 s. The pure-Python `FRAME_GRABBER=aiortc` path negotiates the session but could not decode the Playground's H.264 (see `docs/friction-log.md` #8). The frame stays in memory, is cropped above the watermark band, described neutrally, and discarded.

```bash
# Git Bash
RING_TOKEN_FILE=ring-token.txt PERCEPTION_MODE=bedrock uv run kinwise-ring live
uv run kinwise-ring live --once          # one check per device, then exit
```
```powershell
# PowerShell
$env:RING_TOKEN_FILE = "ring-token.txt"; $env:PERCEPTION_MODE = "bedrock"
uv run kinwise-ring live
```

Live mode needs `PERCEPTION_MODE=bedrock` (AWS credentials with access to Amazon Nova 2 Lite). Offline perception cannot see a frame, so it never reports a person.

### `poll`: event history

Every `POLL_SECONDS`, the worker lists each device's event history.

- **First start.** Events older than the start time are ignored. The cutoff and the seen ids (capped at 1000) are stored in `STATE_DIR/ring-seen.json`, so a restart does not replay them. Events more than 10 minutes old are never acted on.
- **Person events** (`button_press`, `motion_detected` with sub_type `human` or no sub_type, `on_demand`): the worker grabs a frame (best effort), runs perception and posts to the hub (`source: "ring-poll"`, `eventId: ring-{deviceId}-{ringEventId}`). If the frame grab fails, the event-type heuristic is used.
- **Vehicle or package motion** is posted without a frame as `personPresent: false`, so the hub logs it as activity (spec §5.6 step 2). Device, app and subscription events are ignored.
- **The worker's own live views are skipped.** Its frame grabs create `on_demand` history entries, and these are ignored to avoid a feedback loop.
- **Delivery failures.** If the hub is down, the event is retried on the next poll. The hub is idempotent on `eventId`.

```bash
uv run kinwise-ring poll                 # Git Bash or PowerShell
uv run kinwise-ring poll --once
```

### `webhook`: linked devices

```bash
RING_WEBHOOK_SECRET=... uv run kinwise-ring webhook --port 8090                          # Git Bash
$env:RING_WEBHOOK_SECRET = "..."; uv run kinwise-ring webhook --host 0.0.0.0 --port 8090  # PowerShell
```

- `POST /ring/webhook` verifies `X-Signature`: HMAC-SHA256 of the raw body, hex or base64, with or without `sha256=`, compared in constant time. A mismatch gets **401**.
- Deliveries are deduplicated on `meta.request_id` (an in-memory LRU of 1000).
- The endpoint answers `200 {"ok": true}` immediately. The frame grab, perception and hub post (`source: "ring-webhook"`) run in a background task, so Ring always gets its reply within 5 s.
- `device_online` and `device_offline` are logged.
- Without `RING_WEBHOOK_SECRET`, every delivery is refused with 503.
- `GET /health` is a liveness check.

### Other commands

```bash
uv run kinwise-ring devices [--json]                 # list devices (also a quick token check)
uv run kinwise-ring simulate                         # scripted visitor, no Ring (source "demo")
uv run kinwise-ring simulate --carrying "a small box"
uv run kinwise-ring simulate --no-person
uv run kinwise-ring simulate --description "A person at the front door" --count 2
uv run kinwise-ring snapshot <device_id> --out captures/front.jpg   # DEV ONLY, prints a privacy warning
```

`snapshot` first tries the stored-image endpoint, then falls back to a live-view frame (`--method auto|stored|live`). Write it under `captures/`, which is git-ignored, and delete it afterwards.

Global flags: `--env-file PATH` (default `.env`) and `-v` for debug logging.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HUB_URL` | `http://localhost:8787` | Kinwise hub base URL |
| `INGEST_SECRET` | `dev-ingest-secret` | HMAC key shared with the hub |
| `HOUSEHOLD_ID` | `hh-asha` | Household the events belong to |
| `RING_API_BASE` | `https://api.amazonvision.com` | Ring Partner API base URL |
| `RING_TOKEN` / `RING_TOKEN_FILE` | – | Playground token, or a file holding it |
| `RING_CLIENT_ID` / `RING_CLIENT_SECRET` / `RING_REFRESH_TOKEN` | – | Linked-device OAuth (takes precedence) |
| `RING_OAUTH_URL` | `https://oauth.ring.com/oauth/token` | OAuth token endpoint |
| `RING_DEVICE_IDS` | discover | Comma-separated device ids |
| `RING_WEBHOOK_SECRET` | – | Webhook HMAC key (webhook mode) |
| `POLL_SECONDS` | `5` | Poll interval |
| `LIVE_EVERY_SECONDS` | `20` | Live-view interval |
| `PERSON_COOLDOWN_SECONDS` | `60` | Minimum gap between reported people per device (live mode) |
| `PERCEPTION_MODE` | `bedrock` if AWS credentials are found, else `offline` | Vision model or event-type heuristic |
| `PERCEPTION_MODEL_ID` | `us.amazon.nova-2-lite-v1:0` | Bedrock model (Converse API) |
| `AWS_REGION` | `us-east-1` | Bedrock region |
| `WATERMARK_CROP` | `0.15` | Top fraction of the frame cropped before analysis |
| `STATE_DIR` | `.kinwise-data` | Seen ids and the rotated refresh token |

## Hub contract: eventId and HMAC

The body is serialized **once** to compact UTF-8 JSON (`separators=(",", ":")`, `ensure_ascii=False`). The worker signs exactly those bytes:

```
X-Kinwise-Signature: sha256=<hex HMAC-SHA256(INGEST_SECRET, raw_body)>
```

```json
{"householdId":"hh-asha","eventId":"ring-<deviceId>-<ringEventId>","deviceId":"<deviceId>",
 "occurredAt":"2026-10-05T14:41:07.123Z","source":"ring-poll","ringEventType":"button_press",
 "perception":{"personPresent":true,"peopleCount":1,"description":"A person at the front door holding a small box","carrying":"a small box"}}
```

- `source` is one of `ring-playground` (live), `ring-poll`, `ring-webhook` or `demo` (simulate). `carrying` is omitted when nothing is carried.
- `eventId` is deterministic: `ring-{deviceId}-{ringEventId}` for history and webhook events (the same Ring event seen both ways dedupes), `live-{deviceId}-{epochSeconds}` for live mode and `demo-{random}` for simulate.
- The hub verifies the signature over the raw bytes it receives, rejects mismatches with 401, and is idempotent on `eventId` (a repeat returns `{"duplicate": true}`). That makes retries safe: network errors and 5xx get 3 attempts with exponential backoff, and 4xx is not retried.
- Test vector: secret `dev-ingest-secret`, body `{"a":1}` gives `sha256=02d7ad0e7843b9a6ce2310116b0fae12ddbd1f420d977eb1238d12618802771f`. This is the same value as the hub's Node `signBody()`.

## Ring API client behaviour

- **401**: invalidate the token (the Playground file is re-read, OAuth is refreshed) and retry once.
- **429**: sleep for `Retry-After`, capped at 30 s, with at most 3 attempts.
- **503**: `DeviceOffline`.
- **Other errors**: `RingApiError` with the status and a text-only body snippet.
- Every request sends `User-Agent: kinwise-ring/0.1`.
- The bearer token is only sent to the API host or to Ring-owned domains. This protects against an unexpected WHEP `Location` header.

**Unverified assumptions** (parsed defensively):

- The shape of the event-history response. A list, `{data|events|items: [...]}` and JSON:API `attributes` are all accepted. Field names tried: `id/event_id`, `event_type/type/kind`, `created_at/timestamp/occurred_at`, `attributes.sub_type`. Timestamps may be ISO-8601 or epoch seconds or milliseconds.
- The webhook envelope (`meta.request_id` plus a `data` object) and the `X-Signature` encoding.
- Whether WHEP needs an audio m-line. The worker offers video only and retries with receive-only audio on 400/406/409/415/422/488.

## Development

```bash
uv run pytest -q        # offline: respx mocks HTTP; WebRTC is tested on localhost loopback
uv run ruff check .
uv run ruff format --check .
```

The tests cover:

- HMAC signing (including the test vector) and hub retries.
- The Ring client's 401, 429, 503 and 416 handling, WHEP session handling and trusted hosts.
- Event, device and webhook parsing for several response shapes.
- Webhook signature encodings, rejection and `request_id` dedupe.
- The poller's first-start cutoff, persistence, cap, self-induced `on_demand` skipping and hub-outage retry.
- The live-mode cooldown.
- Perception JSON parsing, the neutrality filter and the offline mapping.
- Watermark cropping.
- Frame-grabber cleanup when no frame arrives. This uses a fake peer, plus a real aiortc loopback grab.
