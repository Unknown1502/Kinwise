"""Signed delivery of visitor events to the Kinwise hub (`POST /events/visitor`).

Contract (spec §6.3): the body is serialized ONCE to compact UTF-8 JSON bytes, and
`X-Kinwise-Signature: sha256=<hex HMAC-SHA256(INGEST_SECRET, raw body)>` is computed
over exactly those bytes. The hub verifies the signature over the raw bytes it receives
and is idempotent on `eventId`, so retries are safe.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import httpx

from . import USER_AGENT
from .errors import HubError
from .perception import Perception

log = logging.getLogger(__name__)

Source = Literal["ring-playground", "ring-webhook", "ring-poll", "demo"]
SIGNATURE_HEADER = "X-Kinwise-Signature"


def encode_body(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign_body(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def iso_utc(when: datetime) -> str:
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return when.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class VisitorEvent:
    household_id: str
    event_id: str
    device_id: str
    occurred_at: datetime
    source: Source
    ring_event_type: str
    perception: Perception

    def to_payload(self) -> dict[str, Any]:
        return {
            "householdId": self.household_id,
            "eventId": self.event_id,
            "deviceId": self.device_id,
            "occurredAt": iso_utc(self.occurred_at),
            "source": self.source,
            "ringEventType": self.ring_event_type,
            "perception": self.perception.to_hub(),
        }


class HubClient:
    def __init__(
        self,
        hub_url: str,
        ingest_secret: str,
        *,
        http: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        tries: int = 3,
        backoff_s: float = 0.5,
        timeout_s: float = 10.0,
    ) -> None:
        if not ingest_secret:
            raise ValueError("INGEST_SECRET must not be empty")
        self._url = hub_url.rstrip("/") + "/events/visitor"
        self._secret = ingest_secret
        self._owns_http = http is None
        self._http = http or httpx.AsyncClient(timeout=timeout_s)
        self._sleep = sleep
        self._tries = max(1, tries)
        self._backoff = backoff_s

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def post_visitor(self, event: VisitorEvent) -> dict[str, Any]:
        """POST the signed event; returns the hub's JSON (`{duplicate, decision, alertId?}`)."""
        body = encode_body(event.to_payload())
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
            SIGNATURE_HEADER: sign_body(self._secret, body),
        }
        last: Exception | None = None
        for attempt in range(1, self._tries + 1):
            try:
                resp = await self._http.post(self._url, content=body, headers=headers)
            except httpx.TransportError as exc:
                last = HubError(0, f"hub unreachable at {self._url} ({exc.__class__.__name__})")
            else:
                if resp.status_code < 400:
                    try:
                        result = resp.json()
                    except ValueError:
                        result = {}
                    return result if isinstance(result, dict) else {"result": result}
                if resp.status_code < 500:
                    hint = " (does INGEST_SECRET match the hub?)" if resp.status_code == 401 else ""
                    raise HubError(resp.status_code, f"{resp.text[:200]}{hint}")
                last = HubError(resp.status_code, resp.text[:200])
            if attempt < self._tries:
                delay = self._backoff * (2 ** (attempt - 1))
                log.warning("hub delivery attempt %d failed (%s); retrying in %.1fs", attempt, last, delay)
                await self._sleep(delay)
        assert last is not None
        raise last
