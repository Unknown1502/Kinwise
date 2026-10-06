"""Runtime configuration from environment variables (and an optional .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    hub_mcp_url: str
    mode: str  # "bedrock" | "offline" | "auto"
    model_id: str
    region: str
    memory_id: str | None
    port: int
    history_turns: int

    @staticmethod
    def from_env() -> Settings:
        mode = os.getenv("CONCIERGE_MODE", "auto").lower()
        if mode not in {"bedrock", "offline", "auto"}:
            raise ValueError("CONCIERGE_MODE must be bedrock, offline or auto")
        return Settings(
            hub_mcp_url=os.getenv("HUB_MCP_URL", "http://localhost:8787/mcp"),
            mode=mode,
            model_id=os.getenv("CONCIERGE_MODEL_ID", "us.amazon.nova-2-lite-v1:0"),
            region=os.getenv("AWS_REGION", "us-east-1"),
            memory_id=os.getenv("AGENTCORE_MEMORY_ID") or None,
            port=int(os.getenv("PORT", "8081")),  # 8080 inside the AgentCore container (set via env)
            history_turns=int(os.getenv("HISTORY_TURNS", "12")),
        )
