# Friction log

Real friction hit while building Kinwise (Amazon AppDev 2026). Each entry records the task, the steps, expected vs actual, severity, the workaround and a suggestion (minutes lost where we measured it). Every entry here happened to us (first-hand) and is described as it occurred; where an entry says "from the docs" it comes from reading the documentation, not from a failed run. These are the entries to paste into the optional friction-log fields of the Devpost form.

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
- **Steps:** added `strands-agents>=1.57` and `mcp>=2.3` to `pyproject.toml` and ran `uv sync`.
- **Expected:** the two requirements resolve together.
- **Suggestion:** widen the pin, or document the supported MCP SDK range.

### 4. AgentCore code deployment needs Linux ARM64 wheels (🟡, first-hand)
- **Task:** deploy the Python concierge to AgentCore Runtime from Windows without Docker.
- **Workaround that worked:** `uv pip install --target build/package --python-platform aarch64-manylinux_2_28 --python-version 3.12 --only-binary :all:`, then `AgentRuntimeArtifact.fromCodeAsset` in CDK (see `agents/concierge/scripts/package.py`).
- **Steps:** tried to package the concierge for AgentCore Runtime from a Windows laptop with no Docker.
- **Expected:** a documented way to build an ARM64 code bundle on any OS.
- **Actual:** the guides we found assume Docker buildx or a macOS/Linux ARM host; a bundle built on Windows would carry the wrong wheels.
- **Suggestion:** put this cross-platform recipe in the AgentCore docs. Most guides assume Docker buildx or macOS.

### 5. Alexa+ MCP add-on toolkit isn't available to participants (🟠, first-hand)
- **Task:** verify our MCP server against real Alexa+.
- **Actual:** the MCP Toolkit, CLI and Web Simulator are partner-only (hackathon FAQ).
- **Workaround:** implemented the published Alexa+ contract (two-tier OAuth scopes, RFC 9728, 401 without `WWW-Authenticate`, <500 ms). Wrote a conformance script and a simulated surface.
- **Steps:** looked for the MCP Toolkit, CLI and Web Simulator named in the Alexa+ material, then read the hackathon FAQ.
- **Expected:** a way for participants to test an add-on against Alexa+.
- **Suggestion:** a public sandbox or "contract test" for Alexa+ MCP add-ons, even without live devices.

### 6. No overlay or alert API for third-party Fire TV apps (🟠, first-hand, from the docs)
- **Task:** show the Pause on the TV whatever is playing.
- **Actual:** there is no documented API for Vega or Fire OS apps to raise a safety notice over other apps.
- **Workaround:** Kinwise is the resident's ambient home channel. The Echo and the caregiver alert are backups.
- **Steps:** searched the Vega and Fire OS documentation for an overlay, notification or full-screen-alert API.
- **Expected:** a permissioned way for a safety app to raise a notice over whatever is playing.
- **Suggestion:** a permissioned "household safety notice" API (user-granted, rate-limited) for accessibility and safety apps.

### 7. Ring Partner API exposes none of Ring's AI features (🟠, first-hand, from the docs)
- **Task:** know *what* is at the door (a person or a package) without building our own vision.
- **Actual:** Video Descriptions, Smart Alerts and Familiar Faces aren't available to partners, and there are no resident-facing announcements.
- **Workaround:** sample a frame over WHEP and describe it neutrally with Nova 2 Lite.
- **Steps:** read the Ring Partner API documentation and feature list for anything that tells a person from a package.
- **Expected:** Ring's own detections (video descriptions, smart alerts) available to partners.
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
- **Task:** ship the Kinwise result cards as MCP Apps (`ui://` resources) built with `@modelcontextprotocol/ext-apps`.
- **Steps:** bundled each card into a single HTML file and measured the output.
- **Expected:** a card of a few tens of KB.
- **Workaround:** accepted the size; the cards render correctly in the Echo simulator, Claude and VS Code.
- **Suggestion:** a slim "view-only" App runtime for hosts that only push tool results.

### 10. Stateless MCP servers produce a console error in browser clients (🟡, first-hand)
- **Actual:** the TS client opens the optional GET SSE stream, and a stateless server correctly answers 405, which still logs a browser console error.
- **Task:** connect a browser MCP client (the Echo simulator, TypeScript SDK) to a stateless Streamable HTTP server.
- **Steps:** opened the page and watched the console after `initialize`.
- **Expected:** no console errors when the server is simply stateless.
- **Workaround:** none needed: the 405 is the correct answer and the client carries on; we document it so reviewers do not read it as a bug.
- **Suggestion:** the client could treat 405 on the GET stream as "not supported" silently.

### 11. AgentCore Runtime tracing fails a first deploy until X-Ray Transaction Search is enabled (🟠, first-hand, 2026-10-07)
- **Task:** deploy the concierge with the CDK L2 `agentcore.Runtime` and `tracingEnabled: true`.
- **Actual:** the stack rolled back. `AWS::Logs::Delivery` (Concierge/TracesDelivery) failed with *"X-Ray Delivery Destination is supported with CloudWatch Logs as a Trace Segment Destination. Please enable the CloudWatch Logs destination … UpdateTraceSegmentDestination"*. On a fresh account the X-Ray destination is `XRay`.
- **Workaround:** a one-time account setup: a CloudWatch Logs resource policy for `xray.amazonaws.com` on `aws/spans`, then `aws xray update-trace-segment-destination --destination CloudWatchLogs`, then wait for `ACTIVE`. Tracing is now also a deploy flag (`-c tracing=false`).
- **Minutes lost:** ~15, plus a rollback cycle.
- **Steps:** `cdk deploy` of the stack with `agentcore.Runtime` and `tracingEnabled: true` on a fresh account.
- **Expected:** the deploy succeeds, or says before deploying that the account setup is missing.
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
- **Steps:** followed the Linux install guide inside Ubuntu 24.04 on WSL2, as in the numbered list below.
- **Expected:** either a supported WSL2 path or a clear statement that it is unsupported.
- **Workaround:** `apt install jq libjpeg62`, a manual `vega sdk install <version>` after the stalled download, `legacy-peer-deps=true`, and a script that keeps the WSL session alive while the Virtual Device runs.
- **Suggestion:** document WSL2 as a supported (or "known to work") path, add `jq`/`libjpeg62` to the prerequisites, add retry and progress to SDK downloads, and offer a `--detach` option for `vega virtual-device start`.

### 13. Ring Developer Playground: no person scene, no way to choose a scene, one slow token at a time (🟠, first-hand, 2026-10-13, from India)
- **Task:** show a real "person at the door" from the Playground doorbell so the Fire TV Pause can be triggered by real Ring video.
- **What the Playground offers:** step 3 "Simulate live view event" has three cards: **Package**, **Vehicle**, **Motion**. There is no person or visitor scene.
- **Steps and actual results:**
  1. Logged the network calls the Playground page makes when each card is clicked. All three send the **same** request, `POST /v1/devices/{id}/media/streaming/whep/sessions` (`content-type: application/sdp`), with nothing that names the scene. The scene is chosen on Ring's side, so a partner app cannot ask for one through the API.
  2. Every frame we pulled through the API (live view on several days, plus the stored-image call) showed the same clip: a cardboard box on snowy steps. Nova 2 Lite described it correctly as "a snowy roof with a cardboard box"; Kinwise correctly raised no alert.
  3. "Generate token" disables itself while a token is active. We saw it re-enable after 5 minutes once and after about 16 minutes another time, so a run of tests is paced by the slowest token. Closing or reloading the tab clears the page's token and locks steps 2 to 4 again, and the button may still be disabled.
  4. While a stream from a scene card is playing, a video overlay sits over the other cards, so automated or fast clicks on the next scene fail until the stream is torn down.
  5. The access token is displayed in full in the page and the sample curl command, which is handy but easy to leak in a screen recording.
- **Expected:** a scene list that includes a person, a way to pick the scene from the API (even a query parameter), and a visible countdown for the token cooldown.
- **Minutes lost:** ~90.
- **Workaround:** the real Playground proves the Partner API path end to end (device list, WHEP live view, frame, neutral perception, no alert for an empty doorstep). The person-at-the-door moment is shown with Kinwise's own doorbell simulator, clearly labelled as simulated, through the same hub rules.
- **Suggestion:** add a "Person" or "Visitor" scene, accept the scene as a parameter on the WHEP session request, and show when the next token can be generated.

### 14. Vega Virtual Device: restarts after an unclean stop fail without saying why (🟠, first-hand, 2026-10-07 to 2026-10-13)
- **Task:** keep the Vega Virtual Device running to test and film the Fire TV app.
- **Friction, in order:**
  1. After the emulator stops uncleanly (its WSL session ended, or the machine ran short of memory), `vega virtual-device start` waits the full 240 s and ends with *"Deadline reached but virtual device unresponsive"*. The real cause is only in the instance's own `virtual_device.err`: *"Running multiple emulators with the same AVD is an experimental feature. Please use -read-only"*, caused by stale `hardware-qemu.ini.lock` and `multiinstance.lock` files that nothing removes. Deleting those two files (with no emulator running) fixes it.
  2. `vega run-app` issued right after the device appears in `vega device list` can fail with *"Cannot read properties of undefined (reading 'trim')"* (a CLI error, not a device error). Waiting about 30 seconds and retrying works. Our run-app scripts now retry.
  3. `vega device list` and `vega virtual-device status` can hang indefinitely while the emulator is still booting under memory pressure, and leave stuck `vda` child processes that block later commands.
- **Minutes lost:** ~60 across several restarts.
- **Steps:** stopped the Virtual Device uncleanly (WSL session ended or memory ran out), then restarted it and installed the app, as in the numbered list below.
- **Expected:** the restart works, or the error says why it cannot.
- **Workaround:** stop `qemu` and `vda`, delete the two stale lock files, `wsl --shutdown`, start again, and retry `vega run-app` once on the `trim` error.
- **Suggestion:** have `vega virtual-device start` detect and clear stale lock files, print the contents of `virtual_device.err` when the device is unresponsive, and make `device list` and `status` time out with a clear message.

### 15. Twilio WhatsApp on a trial account: the sandbox accepts "join", then refuses to send (🟠, first-hand, 2026-10-13, from India)
- **Task:** message the caregiver on WhatsApp when the resident presses "Call Meera", with no app to install.
- **Friction, in order:**
  1. The sandbox shows its own number and join code per account (a different US number and a two-word `join` code from the ones in most tutorials), not the number in most tutorials. The tutorial number gives an error that does not say the number is wrong.
  2. A plain `Body` message from the sandbox number is refused with HTTP 400, code **21654**, *"ContentSid Required"*. The error page says it applies when `ContentVariables` is sent without `ContentSid`, and the request had no `ContentVariables`.
  3. The way out is a Content template. Creating one is refused on a trial account with code **20003**, *"This feature is not available on a Trial account"*, so a free account cannot send WhatsApp from code at all.
  4. Twilio's *"accepted"* answer means queued, not delivered. Other WhatsApp failures, for example the 24-hour window (error 63016), can arrive only in a later status callback, so a hub that trusts the first HTTP answer can tell the user a message was sent when it was not.
- **Minutes lost:** ~45, mostly finding that the trial blocks the feature.
- **Steps:** joined the Twilio WhatsApp sandbox, then sent a free-text message from code with the REST API; then tried to create a Content template.
- **Expected:** the sandbox accepts a plain message to a number that joined it.
- **Workaround:** kept the WhatsApp sender in the code for a paid account or Meta's Cloud API; the demo uses e-mail through SNS.
- **Suggestion:** say on the sandbox page that code needs a Content template, and say so at the moment of the 21654 error; let the trial account create `twilio/text` templates for the sandbox; document that `queued` is not `delivered`.
- **What we did:** kept the WhatsApp sender in the code (it works on a paid Twilio account or can be pointed at Meta's Cloud API), and use e-mail through SNS for the demo.

### 16. EventBridge Scheduler one-time schedules fire late, and the docs do not say by how much (🟡, first-hand, 2026-10-14)
- **Task:** wake a Lambda about 2 minutes after a button press, so a follow-up does not depend on a device polling.
- **Friction:** a schedule created for `at(HH:MM:SS)` 130 seconds ahead fired after 168 seconds. `at()` accepts seconds, but the service is evidently only accurate to within about a minute, and the console, the API reference and the SDK types do not state a tolerance. Everything else about one-time schedules worked well: `ActionAfterCompletion: DELETE` cleaned up after itself, and the invoke role needed only `lambda:InvokeFunction`.
- **Minutes lost:** ~10 (checking whether our code or the service was late).
- **Steps:** created a one-time schedule (`at(...)` 130 s ahead, UTC, action after completion DELETE) targeting a Lambda, pressed the button, and polled until the second message appeared.
- **Expected:** the schedule fires within a few seconds of its time.
- **Workaround:** none needed: we arm the schedule 10 s after the 2-minute mark and keep the device poll as a backup trigger.
- **Suggestion:** state the delivery tolerance next to the `at()` expression, and say that second-level precision is not a guarantee.

### 17. Browser speech recognition under automation: the microphone works, the recogniser does not (🟡, first-hand, 2026-10-14)
- **Task:** test a hands-free "Alexa" wake word end to end without a person speaking.
- **Friction:** Edge started under Playwright with a fake microphone file hears it correctly (`audiostart`, `soundstart`, `speechstart` all fire), then `webkitSpeechRecognition` reports `error: network` and never returns a transcript, because the cloud recogniser is not reachable from an automation profile. The error is the same as for a real network outage, so it is easy to chase the wrong cause.
- **Minutes lost:** ~25.
- **Steps:** started Edge under Playwright with `--use-fake-device-for-media-stream` and `--use-file-for-fake-audio-capture` playing a synthesized phrase, then called `webkitSpeechRecognition.start()` and logged its events.
- **Expected:** a transcript of the phrase, or a clear error that the recogniser service cannot be reached.
- **Workaround:** test the wake-word parsing as pure functions and ask a person to try the live microphone once in a normal browser.
- **Suggestion:** give the Web Speech API a distinct error for "recogniser service unavailable", or allow an on-device recogniser to be selected in test builds. We test the wake-word parsing as pure functions and ask a person to try it once in a normal browser.

