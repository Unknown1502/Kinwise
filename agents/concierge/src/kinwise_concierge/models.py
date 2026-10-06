"""Request/response contract between the hub's /sim/ask bridge and the concierge."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Persona = Literal["resident", "caregiver"]


class BadRequest(ValueError):
    """The payload from the hub is malformed."""


@dataclass(frozen=True)
class AskRequest:
    persona: Persona
    text: str
    token: str
    session_id: str
    timezone: str

    @staticmethod
    def parse(payload: dict[str, Any]) -> AskRequest:
        if not isinstance(payload, dict):
            raise BadRequest("payload must be a JSON object")
        persona = payload.get("persona")
        if persona not in ("resident", "caregiver"):
            raise BadRequest("persona must be resident or caregiver")
        text = str(payload.get("text", "")).strip()
        if not text:
            raise BadRequest("text is required")
        token = str(payload.get("token", "")).strip()
        if not token:
            raise BadRequest("token is required")
        return AskRequest(
            persona=persona,
            text=text[:2000],
            token=token,
            session_id=str(payload.get("sessionId") or "default")[:128],
            timezone=str(payload.get("householdTimezone") or "America/New_York"),
        )


@dataclass
class ToolCallRecord:
    name: str
    arguments: dict[str, Any]
    result: dict[str, Any]
    uiResourceUri: str | None = None  # noqa: N815 — wire format is camelCase
    latencyMs: int | None = None  # noqa: N815


@dataclass
class AskResponse:
    reply: str
    toolCalls: list[ToolCallRecord] = field(default_factory=list)  # noqa: N815
    sessionId: str = ""  # noqa: N815
    model: str = ""
    latencyMs: int = 0  # noqa: N815

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        for call in out["toolCalls"]:
            if call.get("uiResourceUri") is None:
                call.pop("uiResourceUri", None)
            if call.get("latencyMs") is None:
                call.pop("latencyMs", None)
        return out


def mcp_result_to_wire(result: dict[str, Any]) -> dict[str, Any]:
    """Normalise a Strands/MCP tool result into the MCP CallToolResult shape the Echo simulator renders."""
    content = []
    for block in result.get("content") or []:
        if isinstance(block, dict) and "text" in block:
            content.append({"type": "text", "text": str(block["text"])})
    wire: dict[str, Any] = {"content": content}
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        wire["structuredContent"] = structured
    if result.get("status") == "error" or result.get("isError"):
        wire["isError"] = True
    return wire
