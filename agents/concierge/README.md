# Kinwise concierge: the simulated Alexa+ orchestrator

A [Strands Agents](https://strandsagents.com) agent hosted on **Amazon Bedrock AgentCore Runtime**. It plays the role Alexa+ plays for a real add-on: it understands what a household member says and calls the **Kinwise MCP server** on that person's behalf, using their own OAuth token, just like Alexa+ account linking.

```
Echo Show sim ──/sim/ask──► hub ──/invocations──► concierge (Strands + Nova 2 Lite)
                                                    │  MCPClient (Streamable HTTP, user's bearer token)
                                                    ▼
                                               hub /mcp ── deterministic Kinwise rules
```

**The model never makes safety decisions.** Scam signals, risk windows and the door decision all come from the hub's tested rules engine, through MCP. The model only routes the request and speaks the result in one to three warm sentences.

## Modes

| `CONCIERGE_MODE` | Brain | Needs AWS |
|---|---|---|
| `bedrock` | Strands `Agent` + `BedrockModel` (default `us.amazon.nova-2-lite-v1:0`) + Strands `MCPClient` | Yes |
| `offline` | Deterministic intent router + the official MCP Python client | No |
| `auto` (default) | Bedrock, falling back to offline if Bedrock is unavailable | Optional |

Both modes are real MCP clients of the same server. Offline mode lets judges run the whole demo without Bedrock access.

Every tool call is captured by a Strands `AfterToolCallEvent` hook. It records the arguments, `structuredContent`, latency and the tool's MCP Apps `ui://` resource, and returns them to the Echo Show simulator, which renders the card.

## Run locally

```bash
cd agents/concierge
uv sync
CONCIERGE_MODE=offline uv run kinwise-concierge          # or: bedrock / auto
# → http://localhost:8081  (POST /invocations, GET /ping)
```

Port **8081** is the local default (8080 is often taken). The AgentCore container uses 8080.

| Variable | Default | |
|---|---|---|
| `HUB_MCP_URL` | `http://localhost:8787/mcp` | Kinwise MCP endpoint |
| `CONCIERGE_MODE` | `auto` | `bedrock`, `offline` or `auto` |
| `CONCIERGE_MODEL_ID` | `us.amazon.nova-2-lite-v1:0` | Any Bedrock Converse model, e.g. `us.anthropic.claude-haiku-4-5-20251001-v1:0` (Anthropic models need an AWS account with a valid payment method, because they are subscribed through AWS Marketplace) |
| `AWS_REGION` | `us-east-1` | |
| `AGENTCORE_MEMORY_ID` | — | When set, conversation memory is persisted in **AgentCore Memory** via `AgentCoreMemorySessionManager` |
| `PORT` | `8081` | 8080 in the container |

Request (sent by the hub): `{persona, text, token, sessionId, householdTimezone}`.
Response: `{reply, toolCalls[{name, arguments, result, uiResourceUri?, latencyMs?}], sessionId, model, latencyMs}`.

## Deploy to AgentCore Runtime

The `Dockerfile` builds an ARM64 image that serves `/invocations` and `/ping` on 8080 (the AgentCore contract). For the deploy steps, see [`../../infra/README.md`](../../infra/README.md).

## Tests

```bash
uv run pytest -q && uv run ruff check .
```
