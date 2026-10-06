# Product feedback: raw notes

These are factual notes collected while building. The Devpost **Product Feedback** answers must be written by the team in their own words. Use these as source material: what we used, what worked, what needs work, how onboarding felt, and whether we'd use it again.

## Alexa+ (MCP add-on)
- **Used:** a self-hosted MCP server (TS SDK v2, spec 2025-11-25, Streamable HTTP), MCP Apps (ext-apps 2.0), tool annotations, structured output, the published Alexa+ OAuth contract.
- **Worked:** `createMcpHandler` serves both 2025 and 2026 protocol eras from one factory. The `authInfo` pass-through makes per-user, role-scoped servers trivial. MCP Apps cards rendered unchanged in our own AppBridge host.
- **Needs work:** no participant access to the MCP Toolkit or simulator (friction #5). It's unclear whether Alexa+ supports elicitation and tasks.
- **Onboarding:** the docs for the auth contract were precise (two-tier scopes, no DCR, no `WWW-Authenticate`).

## Ring (Partner API + Developer Playground)
- **Used:** devices, event history, WHEP live view, image download, signed webhooks, Playground tokens.
- **Needs work:** no AI features for partners (friction #7). Playground webhooks and stored media are unclear (friction #8). The 30-minute Playground tokens make long demos fiddly.
- **Liked:** WHEP over HTTP is easy to drive from Python (aiortc). The HMAC webhook contract is clear.

## Fire TV (Vega OS)
- **Used:** a React Native for Vega project structure (from Amazon's multi-TV sample), react-tv-space-navigation, VoiceView/accessibility APIs, w3cmedia (video).
- **Needs work:** no Windows support (friction #1). No third-party overlay or alert API (friction #6). No app-level speech-to-text.
- **Liked:** the multi-TV sample made a shared RN codebase realistic. Spatial navigation works well on the web too.

## AWS (Bedrock, AgentCore, Strands, Nova)
- **Used:** AgentCore Runtime (code asset) + Memory, Strands Agents (BedrockModel, MCPClient, hooks), Nova 2 Lite (text + vision), Cognito, Lambda, API Gateway, DynamoDB, SNS, Secrets Manager, CDK L2 AgentCore constructs.
- **Worked:** the CDK L2 `Runtime` + `AgentRuntimeArtifact.fromCodeAsset` + `Memory` with grants made AgentCore a few dozen lines. Strands' `AfterToolCallEvent` hook exposed `structuredContent` for MCP Apps. Nova 2 Lite followed tool schemas and produced correct ISO dates with offsets.
- **Needs work:** Anthropic access blocked by payment status without a clear console hint (friction #2). The Strands MCP SDK pin (friction #3). The cross-platform ARM64 packaging recipe (friction #4).
- **Would use again:** yes. Strands + AgentCore + Nova is the fastest path we've seen to a hosted, tool-using agent.
