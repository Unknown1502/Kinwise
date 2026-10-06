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

### 8. Ring Developer Playground: webhooks and stored media unclear (🟡, reported, to verify)
- **Reported by other participants:** the Playground event history logs only live-view (`on_demand`) events, snapshot download returns HTTP 416, and webhook delivery is unclear. Tokens last about 30 minutes.
- **Our design:** a live-view sampling mode (`kinwise-ring live`) plus a signed-webhook receiver for linked devices.
- **To do:** reproduce with our own Playground token and record exact responses here.

### 9. MCP Apps cards are ~230 KB each (🟡, first-hand)
- **Actual:** `@modelcontextprotocol/ext-apps` pulls zod and the core SDK into every single-file card.
- **Suggestion:** a slim "view-only" App runtime for hosts that only push tool results.

### 10. Stateless MCP servers produce a console error in browser clients (🟡, first-hand)
- **Actual:** the TS client opens the optional GET SSE stream, and a stateless server correctly answers 405, which still logs a browser console error.
- **Suggestion:** the client could treat 405 on the GET stream as "not supported" silently.
