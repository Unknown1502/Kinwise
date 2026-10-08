# Kinwise Echo Show simulator (`packages/echo-sim`)

> **Simulated Alexa+ surface · Kinwise add-on (real MCP server).** This is a browser stand-in for an Echo Show. It is not an Amazon device and uses no Amazon branding. The label above stays on screen the whole time.

The simulator shows what Kinwise looks like on an Alexa+ smart display: you speak or type, "Alexa" answers out loud, and Kinwise's interactive cards appear on the screen. The screen is simulated, but the integration behind it is real:

| Layer | What runs | Evidence on screen |
|---|---|---|
| Orchestrator | `POST {hub}/sim/ask` → the Kinwise concierge (Strands agent, or the offline router) calls Kinwise tools over MCP | The reply's meta line ("1 Kinwise tool via MCP · Claude Haiku 4.5"). The **Concierge tool calls** tab lists each tool's name, arguments, result, `isError` and latency. |
| **Real MCP client** | One `@modelcontextprotocol/client` `Client` per persona, using `StreamableHTTPClientTransport` against `POST {hub}/mcp` with that persona's bearer token. It negotiates protocol **2025-11-25**. | The `MCP 2025-11-25` pill. The **MCP wire traffic** tab logs every JSON-RPC exchange (`initialize`, `tools/list`, `resources/read`, `tools/call`) with HTTP status, the hub's `server-timing`, the round trip, and the request and response JSON (SSE `data:` events are parsed). |
| **Real MCP Apps host** | For every tool call with a `ui://kinwise/*` resource, the simulator calls `resources/read` for the card HTML (`text/html;profile=mcp-app`). It renders the card in `<iframe sandbox="allow-scripts allow-forms" srcdoc>` and drives it with `AppBridge` + `PostMessageTransport` from `@modelcontextprotocol/ext-apps`, sending `ui/initialize`, then `tool-input`, then `tool-result`. | The cards themselves. The bridge rows in the wire tab (`card → host ui/initialize`, `host → card ui/notifications/tool-result`). |
| Card → server | A card button (for example **Call Priya** on the Pause) calls `App.callServerTool`. AppBridge forwards it through our MCP client to the hub, and the card re-renders from the result. Alexa reads the outcome aloud. | The wire tab shows `card → host tools/call kinwise_respond_to_alert (forwarded to the hub by AppBridge)` next to the real `POST tools/call`. Priya's phone gets the notice. |

When the simulator receives a tool call without `uiResourceUri`, it reads the tool's `_meta.ui.resourceUri` from `tools/list`, which is how a real host discovers card UIs.

## Voice

- **Natural voice.** Alexa's replies are spoken by **Amazon Polly** (neural voice Joanna) through the hub: `POST {hub}/speech` returns a short-lived signed link, and the simulator plays it. If the hub has no voice configured, or you are offline, it falls back to the browser's own voice. A chip in the top bar shows which voice is speaking.
- **Hands-free "Alexa".** Turn on **Hands-free “Alexa”** (Chrome or Edge) and just talk: *"Alexa, is this call real?"*. Saying "Alexa" on its own listens for the next sentence for 8 seconds. A dim light along the bottom of the screen means the microphone is waiting for "Alexa"; it brightens while you speak, and your words appear live. Listening pauses while Alexa thinks or speaks, so she never hears herself.
- **Talk to the TV.** *"Alexa, read my messages on the TV"* or *"show my day on the TV"* calls `kinwise_read_on_tv`, and Asha's TV reads it aloud within one poll (2 s).

Browsers only transcribe speech with a real microphone; automated test browsers return no text, so the wake-word logic is covered by unit tests (`src/lib/voice.test.ts`).

## Security and accessibility

- Card HTML runs only in sandboxed `srcdoc` iframes, without `allow-same-origin`, so each card gets an opaque origin. The host never uses `innerHTML` for server data, and all text is rendered by React. Cards can open only `http(s)` links, in a new tab with `noopener`.
- Each card iframe is created empty. The bridge connects to its `contentWindow` first, and only then is `srcdoc` set, so the view's `ui/initialize` can never be missed. Cards are torn down when they are closed (`ui/resource-teardown`, then `close()`) or when they fall off the stack. Only the newest 6 cards stay alive per device.
- Large type (body text is 22 px on the Echo screen and replies are 31–38 px), visible focus rings, an `aria-live` region for Alexa's replies, and full keyboard operation. Escape exits a full-screen card.
- Cards are auto-sized from `ui/notifications/size-changed`. A card taller than 520 px scrolls inside its frame, as on a touch display. **Expand** shows a card full screen (`displayMode: fullscreen`). The simulator also honours `ui/request-display-mode`.

## Run it

```bash
# 1. hub (MCP server + /sim/ask + dev routes)
cd packages/hub && npm run dev                      # http://localhost:8787
# 2. concierge (offline mode needs no AWS)
cd agents/concierge && CONCIERGE_MODE=offline uv run kinwise-concierge
# 3. simulator
cd packages/echo-sim && npm install && npm run dev  # http://localhost:5173
```

Use Chrome or Edge for the microphone (Web Speech API). Text input and chips work in any browser.

| Env var (Vite) | Default | Purpose |
|---|---|---|
| `VITE_HUB_URL` | `http://localhost:8787` | Hub base URL |
| `VITE_ASHA_TOKEN` | `dev-asha` | Bearer token for Asha's kitchen Echo Show (resident) |
| `VITE_PRIYA_TOKEN` | `dev-priya` | Bearer token for Priya's Echo Show (caregiver) |

Copy `.env.example` to `.env.local` to override these. Each persona keeps its own concierge `sessionId`, transcript, cards and MCP client.

Scripts: `npm run dev`, `npm run build` (tsc + vite build), `npm run preview`, `npm test` (vitest), `npm run typecheck`.

The live integration test is opt-in and runs against a running hub: `KINWISE_HUB_URL=http://localhost:8787 npx vitest run src/lib/hub.e2e.test.ts`. It checks the 2025-11-25 negotiation, the UI resource read, role-scoped tools, and a view's `callServerTool` forwarded by AppBridge to the hub.

## Error handling

If the hub is down, the token is rejected (401/403), the concierge is not configured (503) or the concierge is down (5xx), Alexa apologises calmly. A "For the demo team" box shows the fix, for example `Start the concierge: cd agents/concierge && uv run kinwise-concierge`. Tool results with `isError` are shown as a calm note instead of a card. The MCP status pill retries when clicked and also every 10 s.

## Dev aids (not part of the simulated device)

- **Priya's phone** polls `GET {hub}/dev/notices` every 2 s and shows the caregiver's notifications. The panel hides itself if the route returns 404.
- **Demo controls:**
  - **Reset demo** calls `POST /dev/reset` and clears local transcripts, cards and logs.
  - **Ring the doorbell** calls `POST /dev/visitor`. The "Person visible" toggle sets whether a person is at the door. "Show the alert on Asha's Echo" rings a banner on Asha's screen and shows the alert card through her own MCP client (`kinwise_explain_last_alert`).
- **Under the hood → Run a tool directly** calls any tool with the current persona's MCP client and renders its card exactly like a concierge tool call. Use it to show cards without the concierge.

## Demo script

**Asha's kitchen Echo Show:**

1. "Remind me at 2 PM: courier from the bank is picking up a package". A reminder card appears with *Some warning signs*.
2. "A man from the FTC called… a courier will come, and I shouldn't tell my family. Is that real?" The card shows *Strong scam warning signs* and Alexa offers to call Priya.
3. Click **Ring the doorbell**. The TV shows the Pause, and Priya's phone shows a notice.
4. "Why did my TV pause?" The Pause card appears. Press **Call Priya** on the card. Alexa says "Calling Priya now." and Priya's phone shows *Asha wants to talk to you now*.
5. "What's happening today?" and "Give me an hour of privacy".

**Priya's Echo Show:**

1. "How's Mom's day going?" A timeline card appears. It shows signals only.
2. "Why did Kinwise alert?"
3. "Add Maria the nurse on Tuesday from 2 to 3 PM as an expected visitor". The visit waits for Asha's approval on the TV.
4. "Send Mom a message: Dinner Sunday? ❤️"

Open **Under the hood** at any time to show the concierge's tool calls and the raw MCP traffic.
