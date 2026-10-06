"""Bedrock-backed orchestrator: a Strands agent that uses the Kinwise MCP server on the speaker's behalf.

This is the simulated Alexa+ "brain". Safety decisions are never made here: they come from the hub's
deterministic rules engine through MCP. The model only routes requests and speaks the results kindly.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from strands import Agent
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

from .config import Settings
from .mcp_session import ui_uri_from_meta
from .models import AskRequest, AskResponse, ToolCallRecord, mcp_result_to_wire
from .prompts import system_prompt

log = logging.getLogger(__name__)

# Conversation history per session (in-process). On AgentCore Runtime each session id gets its own microVM, so
# this survives between turns of one conversation; with AGENTCORE_MEMORY_ID set, AgentCore Memory persists it.
_histories: dict[str, list[dict[str, Any]]] = {}
_lock = threading.Lock()


class ToolRecorder(HookProvider):
    """Records every MCP tool call (args, structured result, MCP Apps UI link, latency) for the Echo screen."""

    def __init__(self, ui_uris: dict[str, str]) -> None:
        self.ui_uris = ui_uris
        self.calls: list[ToolCallRecord] = []

    def register_hooks(self, registry: HookRegistry, **_: Any) -> None:
        registry.add_callback(AfterToolCallEvent, self._after_tool)

    def _after_tool(self, event: AfterToolCallEvent) -> None:
        name = str(event.tool_use.get("name", ""))
        raw = event.result if isinstance(event.result, dict) else {}
        if event.exception is not None:
            raw = {"status": "error", "content": [{"text": f"Tool failed: {event.exception}"}]}
        self.calls.append(
            ToolCallRecord(
                name=name,
                arguments=dict(event.tool_use.get("input") or {}),
                result=mcp_result_to_wire(raw),
                uiResourceUri=self.ui_uris.get(name),
                latencyMs=round(event.duration * 1000) if event.duration is not None else None,
            )
        )


def trim_history(messages: list[dict[str, Any]], max_messages: int) -> list[dict[str, Any]]:
    """Keep the tail of a conversation, starting at a plain user turn so toolUse/toolResult pairs stay intact."""
    tail = messages[-max_messages:]
    while tail:
        first = tail[0]
        is_user_text = first.get("role") == "user" and not any("toolResult" in b for b in first.get("content", []))
        if is_user_text:
            break
        tail = tail[1:]
    return tail


def _session_manager(settings: Settings, req: AskRequest) -> Any | None:
    if not settings.memory_id:
        return None
    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

    config = AgentCoreMemoryConfig(memory_id=settings.memory_id, session_id=req.session_id, actor_id=req.persona)
    return AgentCoreMemorySessionManager(config, region_name=settings.region)


def answer_bedrock(req: AskRequest, settings: Settings, hub_mcp_url: str | None = None) -> AskResponse:
    mcp = MCPClient(
        url=hub_mcp_url or settings.hub_mcp_url,
        headers={"Authorization": f"Bearer {req.token}"},
        application_name="kinwise-concierge",
        application_version="0.1.0",
    )
    with mcp:
        tools = mcp.list_tools_sync()
        ui_uris = {t.tool_name: uri for t in tools if (uri := ui_uri_from_meta(t.mcp_tool.meta))}
        recorder = ToolRecorder(ui_uris)
        model = BedrockModel(model_id=settings.model_id, region_name=settings.region, temperature=0.2, max_tokens=700)
        session_manager = _session_manager(settings, req)
        with _lock:
            history = list(_histories.get(req.session_id, [])) if session_manager is None else None

        agent = Agent(
            model=model,
            tools=tools,
            system_prompt=system_prompt(req.persona, req.timezone),
            hooks=[recorder],
            callback_handler=None,
            name="kinwise-concierge",
            **({"session_manager": session_manager} if session_manager else {"messages": history}),
        )
        result = agent(req.text)
        reply = str(result).strip() or "Okay."

        if session_manager is None:
            with _lock:
                _histories[req.session_id] = trim_history(list(agent.messages), settings.history_turns * 2)

    return AskResponse(reply=reply, toolCalls=recorder.calls, sessionId=req.session_id, model=settings.model_id)
