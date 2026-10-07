# Friction log

Real friction hit while building Kinwise (Amazon AppDev 2026). Each entry records the task, the steps, expected vs actual, severity, minutes lost, the workaround and a suggestion. **First-hand** entries happened to us; **reported** entries come from other developers and still need to be reproduced before submission.

Severity: 🔴 blocking · 🟠 costly · 🟡 annoying

---

### 1. Vega SDK cannot be used from Windows (🔴, first-hand)
- **Task:** build and run the Fire TV app for Vega OS on a Windows 11 laptop.
- **Steps:** read the Vega getting-started guide and FAQ. Checked WSL2 for `/dev/kvm`.
- **Expected:** a Windows (or WSL2) path, like the Android/Fire OS toolchain has.
- **Actual:** the SDK supports macOS and Ubuntu only. The Vega Virtual Device needs KVM and isn't supported in WSL, VirtualBox or Docker. `/dev/kvm` is absent in the default WSL distro.
- **Workaround:** keep all UI in plain React Native and develop it in a react-native-web preview on Windows; build for Vega on Linux.
- **Suggestion:** official WSL2 (nested KVM) support for the Vega Virtual Device, or a hosted cloud build and simulator for students and Windows developers.

### 2. Bedrock: Anthropic model blocked by account payment status (🟠, first-hand)
- **Task:** run the concierge agent on Claude Haiku 4.5 through Bedrock.
- **Steps:** `ConverseStream` with `us.anthropic.claude-haiku-4-5-20251001-v1:0`. The model was listed as ACTIVE.
- **Expected:** the call succeeds, or the access page says why it can't.
- **Actual:** `AccessDeniedException … INVALID_PAYMENT_INSTRUMENT … AWS Marketplace subscription … cannot be completed`. The model still shows as available in `list-foundation-models`.
- **Workaround:** switched the default to **Amazon Nova 2 Lite**, which worked first time. Added an automatic offline fallback.
- **Minutes lost:** ~15.
- **Suggestion:** show the Marketplace and payment requirement in `list-foundation-models` and in the hackathon resources. Hackathon credits could cover first-party models clearly.

### 3. Strands Agents pins the MCP Python SDK below the current release (🟡, first-hand)
- **Task:** `uv sync` with `strands-agents>=1.57` and `mcp>=2.3`.
- **Actual:** unsatisfiable: `strands-agents` requires `mcp>=1.23,<2.2`.
- **Workaround:** let Strands choose the MCP SDK version (2.1.1).
- **Suggestion:** widen the pin, or document the supported MCP SDK range.

### 4. AgentCore code deployment needs Linux ARM64 wheels (🟡, first-hand)
- **Task:** deploy the Python concierge to AgentCore Runtime from Windows without Docker.
- **Workaround that worked:** `uv pip install --target build/package --python-platform aarch64-manylinux_2_28 --python-version 3.12 --only-binary :all:`, then `AgentRuntimeArtifact.fromCodeAsset` in CDK (see `agents/concierge/scripts/package.py`).
- **Suggestion:** put this cross-platform recipe in the AgentCore docs. Most guides assume Docker buildx or macOS.

### 5. Alexa+ MCP add-on toolkit isn't available to participants (🟠, first-hand)
- **Task:** verify our MCP server against real Alexa+.
- **Actual:** the MCP Toolkit, CLI and Web Simulator are partner-only (hackathon FAQ).
- **Workaround:** implemented the published Alexa+ contract (two-tier OAuth scopes, RFC 9728, 401 without `WWW-Authenticate`, <500 ms). Wrote a conformance script and a simulated surface.
- **Suggestion:** a public sandbox or "contract test" for Alexa+ MCP add-ons, even without live devices.

### 6. No overlay or alert API for third-party Fire TV apps (🟠, first-hand, from the docs)
- **Task:** show the Pause on the TV whatever is playing.
- **Actual:** there is no documented API for Vega or Fire OS apps to raise a safety notice over other apps.
- **Workaround:** Kinwise is the resident's ambient home channel. The Echo and the caregiver alert are backups.
- **Suggestion:** a permissioned "household safety notice" API (user-granted, rate-limited) for accessibility and safety apps.

### 7. Ring Partner API exposes none of Ring's AI features (🟠, first-hand, from the docs)
- **Task:** know *what* is at the door (a person or a package) without building our own vision.
- **Actual:** Video Descriptions, Smart Alerts and Familiar Faces aren't available to partners, and there are no resident-facing announcements.
- **Workaround:** sample a frame over WHEP and describe it neutrally with Nova 2 Lite.
- **Suggestion:** expose Video Descriptions (opt-in) and a "speak to the resident" chime action.

### 8. Ring Developer Playground: stored media and Python WebRTC decoding (🟠, first-hand, 2026-10-06, from India)
- **Task:** get one still frame of the Playground doorbell from a Python backend, then run privacy-preserving perception on it.
- **Steps and actual results:**
  1. `GET /v1/devices?include=status,capabilities` → 200. The response is **JSON:API**: devices in `data[]`, with `device-status` (`online: true`) and `device-capabilities` (video codec `AVC`, 1080p, 16:9) in `included[]`, linked by `relationships.*.data.id`. The docs examples didn't make this shape obvious, so our first parser showed status as unknown.
  2. `GET /v1/history/devices/{id}/events` → 200 `{"data": []}` on a fresh Playground.
  3. `POST /v1/devices/{id}/media/image/download` with no body → **403 `REQUEST_FORBIDDEN` "Cannot authorize: empty request body"**. The required body isn't documented in the API reference we used.
  4. `POST …/media/streaming/whep/sessions` → **201**. The answer offers H.264 `profile-level-id=42001f;packetization-mode=1` with RTX, plus Opus. **aiortc** (Python) received RTP but **never decoded a frame** (every packet failed with `AVERROR_INVALIDDATA`), in both transceiver orders, even waiting 45 s.
  5. The same WHEP flow in **headless Edge** (Playwright, audio `sendrecv` first, like Amazon's `ring-api-helloworld`) → **1280×720 frame in 2.5 s**.
- **Expected:** the image download works with a documented body, or returns 416 when no image is stored; live view decodes in common WebRTC stacks.
- **Minutes lost:** ~35.
- **Workaround:** `BrowserFrameGrabber` (headless Edge/Chrome via Playwright, no browser download) is now the default frame source (`FRAME_GRABBER=browser`). Snapshot falls back from stored image to live view automatically.
- **Suggestion:** document the image-download request body and the JSON:API response shapes with full examples. Offer a "single snapshot" endpoint for partners who only need one frame. Provide a server-side (non-browser) live-view example.
- **Update 2026-10-07 (step 3 resolved):** Ring's documentation MCP server (`knowledge.appstore-mcp.ring.amazon.dev`, page `amazon_vision_api/image_download.md`) does document the body: `{"type": "latest_in_range" | "at_timestamp", …, "image_options": {…}}`. The API answers **303** with a pre-signed `Location`, which you GET without the bearer token. With that body the Playground returned a 1280×720 JPEG (`X-Media-Origin: recording`) in 6.6 s end to end, so `kinwise-ring snapshot --method stored` now works. Two remaining gaps: (a) the page we found first didn't link to this one; (b) the docs show the pre-signed host as `media.api.amazonvision.com`, but the live Playground redirected to `download-ap-northeast-1.prod.phoenix.devices.amazon.dev`. A client that allow-lists the documented host (as ours did) rejects the real redirect. Also, the docs MCP's `max_results` parameter must be sent as a string; an integer fails validation. **Minutes lost:** ~15 more.
- **Likely root cause of the aiortc failure:** the Playground's own API explorer, negotiating from a browser, gets an answer with **H.264 High profile (`profile-level-id=64001f`, pt 118)**. Our aiortc offer only listed baseline profiles, and Ring answered `42001f`, but the camera most likely kept sending its native High-profile stream. A WHEP server that answers a profile it then doesn't send would explain why every packet failed to decode. *(Inferred, not confirmed.)*
- **Still to verify:** whether Playground simulations deliver webhooks. Whether a second live-view session is refused while the Playground's own live view is open (one of our grabs got no frame while the explorer had a session running). Tokens last 30 minutes, which makes long demos fiddly.

### 9. MCP Apps cards are ~230 KB each (🟡, first-hand)
- **Actual:** `@modelcontextprotocol/ext-apps` pulls zod and the core SDK into every single-file card.
- **Suggestion:** a slim "view-only" App runtime for hosts that only push tool results.

### 10. Stateless MCP servers produce a console error in browser clients (🟡, first-hand)
- **Actual:** the TS client opens the optional GET SSE stream, and a stateless server correctly answers 405, which still logs a browser console error.
- **Suggestion:** the client could treat 405 on the GET stream as "not supported" silently.

### 11. AgentCore Runtime tracing fails a first deploy until X-Ray Transaction Search is enabled (🟠, first-hand, 2026-10-07)
- **Task:** deploy the concierge with the CDK L2 `agentcore.Runtime` and `tracingEnabled: true`.
- **Actual:** the stack rolled back. `AWS::Logs::Delivery` (Concierge/TracesDelivery) failed with *"X-Ray Delivery Destination is supported with CloudWatch Logs as a Trace Segment Destination. Please enable the CloudWatch Logs destination … UpdateTraceSegmentDestination"*. On a fresh account the X-Ray destination is `XRay`.
- **Workaround:** a one-time account setup: a CloudWatch Logs resource policy for `xray.amazonaws.com` on `aws/spans`, then `aws xray update-trace-segment-destination --destination CloudWatchLogs`, then wait for `ACTIVE`. Tracing is now also a deploy flag (`-c tracing=false`).
- **Minutes lost:** ~15, plus a rollback cycle.
- **Suggestion:** have the CDK construct (or `agentcore` CLI) check the destination at synth/deploy time and say how to enable it, or enable Transaction Search as part of the construct.

### 12. Vega Virtual Device works under WSL2, but the path there is undocumented (🟠, first-hand, 2026-10-07)
- **Task:** build and run the Fire TV app for Vega from a Windows laptop.
- **What worked (not in the docs):** Ubuntu 24.04 in WSL2 exposes `/dev/kvm` (Intel VT-x). `NONINTERACTIVE=true bash get_vvm.sh` installs SDK 0.24.12112, `npm run build:debug` produces x86_64/armv7/aarch64 `.vpkg`s, and the Virtual Device boots in ~30 s with a WSLg window. Kinwise ran end to end against our AWS hub.
- **Friction, in order:**
  1. The installer exits with *"jq is required"*, but `jq` isn't listed in the prerequisites we followed.
  2. The SDK download stalled at 225 MB with no progress output or retry. A manual `vega sdk install <ver>` finished in seconds.
  3. KeplerPerfCLI post-install failed with `ImportError: libjpeg.so.62` on Ubuntu 24.04 (`apt install libjpeg62` fixes it).
  4. `npm install` hit `ERESOLVE` on `@amazon-devices/react-native-kepler` peers. `legacy-peer-deps=true` is required, as the multi-TV sample implies but doesn't document.
  5. The Virtual Device process dies when the WSL session that started it exits, so `vega run-app` then reports *"No devices found"*.
  6. Generated vpkg names follow the package.json name (`tv-app_x86_64.vpkg`), not `appName`, unlike several docs examples.
- **Minutes lost:** ~90, mostly the stalled download plus diagnosing WSL networking.
- **Suggestion:** document WSL2 as a supported (or "known to work") path, add `jq`/`libjpeg62` to the prerequisites, add retry and progress to SDK downloads, and offer a `--detach` option for `vega virtual-device start`.
