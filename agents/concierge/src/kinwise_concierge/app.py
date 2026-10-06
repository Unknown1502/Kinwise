"""AgentCore Runtime entry point (POST /invocations, GET /ping on port 8080).

Locally: `uv run kinwise-concierge`. On AWS: deployed to Bedrock AgentCore Runtime (see infra/README.md).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

from .brain import answer_bedrock
from .config import Settings
from .models import AskRequest, AskResponse, BadRequest
from .offline import answer_offline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("kinwise.concierge")

settings = Settings.from_env()
app = BedrockAgentCoreApp()

_FALLBACK_ERRORS = (NoCredentialsError, BotoCoreError, ClientError)


async def handle(payload: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        req = AskRequest.parse(payload)
    except BadRequest as err:
        return {"error": "bad_request", "reply": f"Sorry, I couldn't understand that request ({err}).", "toolCalls": []}

    try:
        if settings.mode == "offline":
            resp = await answer_offline(req, settings.hub_mcp_url)
        else:
            try:
                resp = await asyncio.to_thread(answer_bedrock, req, settings)
            except _FALLBACK_ERRORS as err:
                if settings.mode == "bedrock":
                    raise
                log.warning("Bedrock unavailable (%s); using the offline router", type(err).__name__)
                resp = await answer_offline(req, settings.hub_mcp_url)
    except Exception:  # noqa: BLE001 — the Echo screen must always get a calm answer
        log.exception("concierge failed")
        resp = AskResponse(
            reply="Sorry, I'm having trouble reaching Kinwise right now. Please try again in a moment.",
            sessionId=req.session_id,
            model="error",
        )
    resp.latencyMs = round((time.perf_counter() - started) * 1000)
    log.info("persona=%s model=%s tools=%s latency=%sms", req.persona, resp.model, [c.name for c in resp.toolCalls], resp.latencyMs)
    return resp.to_dict()


@app.entrypoint
async def invoke(payload: dict[str, Any], context: Any = None) -> dict[str, Any]:
    return await handle(payload)


def main() -> None:
    log.info("Kinwise concierge on :%s (mode=%s, model=%s, hub=%s)", settings.port, settings.mode, settings.model_id, settings.hub_mcp_url)
    app.run(port=settings.port)


if __name__ == "__main__":
    main()
