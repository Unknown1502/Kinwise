"""Thin async wrapper over the official MCP Python client, used by the offline router."""

from __future__ import annotations

import time
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

from .models import ToolCallRecord


def ui_uri_from_meta(meta: Any) -> str | None:
    """Read `_meta.ui.resourceUri` (MCP Apps) or the legacy `_meta["ui/resourceUri"]` key."""
    if not isinstance(meta, dict):
        return None
    ui = meta.get("ui")
    if isinstance(ui, dict) and isinstance(ui.get("resourceUri"), str):
        return ui["resourceUri"]
    legacy = meta.get("ui/resourceUri")
    return legacy if isinstance(legacy, str) else None


class KinwiseMcp:
    """One MCP session to the Kinwise hub, authenticated as the household member who is speaking."""

    def __init__(self, url: str, token: str) -> None:
        self._url = url
        self._token = token
        self._stack = AsyncExitStack()
        self.session: ClientSession | None = None
        self.ui_uris: dict[str, str] = {}
        self.tool_names: set[str] = set()
        self.calls: list[ToolCallRecord] = []

    async def __aenter__(self) -> KinwiseMcp:
        http = await self._stack.enter_async_context(
            create_mcp_http_client(headers={"Authorization": f"Bearer {self._token}"})
        )
        streams = await self._stack.enter_async_context(streamable_http_client(self._url, http_client=http))
        read, write = streams[0], streams[1]
        session = await self._stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        listed = await session.list_tools()
        for tool in listed.tools:
            self.tool_names.add(tool.name)
            uri = ui_uri_from_meta(tool.meta)
            if uri:
                self.ui_uris[tool.name] = uri
        self.session = session
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._stack.aclose()

    async def call(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        """Call a tool and record it in the wire format the Echo simulator renders."""
        if self.session is None:
            raise RuntimeError("MCP session not open")
        args = arguments or {}
        started = time.perf_counter()
        result = await self.session.call_tool(name, args)
        content = [
            {"type": "text", "text": block.text}
            for block in getattr(result, "content", []) or []
            if getattr(block, "type", None) == "text"
        ]
        wire: dict[str, Any] = {"content": content}
        structured = getattr(result, "structured_content", None)
        if isinstance(structured, dict):
            wire["structuredContent"] = structured
        if getattr(result, "is_error", False):
            wire["isError"] = True
        self.calls.append(
            ToolCallRecord(
                name=name,
                arguments=args,
                result=wire,
                uiResourceUri=self.ui_uris.get(name),
                latencyMs=round((time.perf_counter() - started) * 1000),
            )
        )
        return wire


def text_of(wire: dict[str, Any]) -> str:
    return " ".join(block["text"] for block in wire.get("content", []) if block.get("text")).strip()
