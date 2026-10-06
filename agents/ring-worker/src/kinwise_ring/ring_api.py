"""Async client for the official Ring Partner API (`api.amazonvision.com`).

Retry policy: 401 → invalidate the token and retry once; 429 → sleep `Retry-After`
(capped at 30 s, at most 3 attempts); 503 → `DeviceOffline`; anything else ≥ 400 →
`RingApiError` with the status and a short body snippet (never binary media).
"""

from __future__ import annotations

import asyncio
import email.utils
import logging
import time
from collections.abc import Awaitable, Callable, Iterable
from datetime import datetime
from typing import Any
from urllib.parse import quote, urljoin, urlsplit

import httpx

from . import USER_AGENT
from .config import DEFAULT_RING_API_BASE
from .errors import DeviceOffline, RingApiError, RingAuthError
from .events import RingDevice, RingEvent, parse_devices, parse_events
from .tokens import TokenProvider

log = logging.getLogger(__name__)

Sleep = Callable[[float], Awaitable[None]]

MAX_RETRY_AFTER_S = 30.0
MAX_RATE_LIMIT_ATTEMPTS = 3
TRUSTED_DOMAINS = ("amazonvision.com", "ring.com")


def _snippet(resp: httpx.Response, limit: int = 300) -> str:
    """A loggable, text-only preview of an error body (media bodies are summarized)."""
    ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
    textual = not ctype or ctype.startswith("text/") or ctype.endswith(("json", "xml", "/sdp"))
    if not textual:
        return f"<{len(resp.content)} bytes of {ctype}>"
    return resp.text[:limit]


def retry_after_seconds(value: str | None, *, default: float = 1.0, cap: float = MAX_RETRY_AFTER_S) -> float:
    """Parse `Retry-After` (delta-seconds or HTTP-date) and clamp to [0, cap]."""
    if not value:
        return default
    value = value.strip()
    try:
        delay = float(value)
    except ValueError:
        try:
            when = email.utils.parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return default
        delay = when.timestamp() - time.time()
    return max(0.0, min(cap, delay))


class RingClient:
    def __init__(
        self,
        tokens: TokenProvider,
        base_url: str = DEFAULT_RING_API_BASE,
        *,
        http: httpx.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
        timeout_s: float = 15.0,
    ) -> None:
        self._tokens = tokens
        self._base = base_url.rstrip("/") + "/"
        self._owns_http = http is None
        self._http = http or httpx.AsyncClient(timeout=timeout_s)
        self._sleep = sleep

    @property
    def tokens(self) -> TokenProvider:
        return self._tokens

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def __aenter__(self) -> RingClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    def url(self, path_or_url: str) -> str:
        return urljoin(self._base, path_or_url.lstrip("/")) if "://" not in path_or_url else path_or_url

    def _trusted(self, url: str) -> bool:
        """Only send the bearer token to the API host or Ring's own domains (e.g. a WHEP Location)."""
        host = (urlsplit(url).hostname or "").lower()
        if host == (urlsplit(self._base).hostname or "").lower():
            return True
        return any(host == d or host.endswith("." + d) for d in TRUSTED_DOMAINS)

    async def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        params: dict[str, str] | None = None,
        content: bytes | str | None = None,
        headers: dict[str, str] | None = None,
        allow: Iterable[int] = (),
    ) -> httpx.Response:
        url = self.url(path_or_url)
        if not self._trusted(url):
            raise RingApiError(0, f"refusing to send Ring credentials to untrusted host in {url!r}")
        allowed = set(allow)
        auth_retried = False
        rate_attempts = 0
        while True:
            token = await self._tokens.get()
            req_headers = {"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})}
            req_headers["Authorization"] = f"Bearer {token}"
            try:
                resp = await self._http.request(method, url, params=params, content=content, headers=req_headers)
            except httpx.HTTPError as exc:
                raise RingApiError(0, f"{method} {path_or_url} failed ({exc.__class__.__name__})") from exc
            status = resp.status_code
            if status < 400 or status in allowed:
                return resp
            if status == 401:
                if not auth_retried:
                    auth_retried = True
                    log.info("Ring returned 401 for %s %s; refreshing token and retrying once", method, path_or_url)
                    await self._tokens.invalidate()
                    continue
                hint = self._tokens.expiry_hint() or "check the token (Playground tokens last ~30 minutes)"
                raise RingAuthError(401, f"{method} {path_or_url} unauthorized; {hint}", _snippet(resp))
            if status == 429:
                rate_attempts += 1
                if rate_attempts >= MAX_RATE_LIMIT_ATTEMPTS:
                    raise RingApiError(429, f"{method} {path_or_url} rate limited", _snippet(resp))
                delay = retry_after_seconds(resp.headers.get("retry-after"))
                log.warning("Ring rate limit (429); retrying in %.1fs", delay)
                await self._sleep(delay)
                continue
            if status == 503:
                raise DeviceOffline(503, f"{method} {path_or_url}: device offline or unavailable", _snippet(resp))
            raise RingApiError(status, f"{method} {path_or_url} failed", _snippet(resp))

    @staticmethod
    def _json(resp: httpx.Response) -> Any:
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            raise RingApiError(resp.status_code, "expected JSON", _snippet(resp)) from exc

    # ── devices ──
    async def list_devices(self) -> list[RingDevice]:
        resp = await self._request("GET", "/v1/devices", params={"include": "status,capabilities"})
        return parse_devices(self._json(resp))

    async def get_device(self, device_id: str) -> dict[str, Any]:
        resp = await self._request("GET", f"/v1/devices/{quote(device_id, safe='')}")
        data = self._json(resp)
        return data if isinstance(data, dict) else {"data": data}

    # ── event history ──
    async def list_events(self, device_id: str, since: datetime | None = None) -> list[RingEvent]:
        resp = await self._request("GET", f"/v1/history/devices/{quote(device_id, safe='')}/events")
        events = parse_events(self._json(resp), device_id)
        if since is not None:
            events = [e for e in events if e.occurred_at is None or e.occurred_at >= since]
        return events

    # ── media ──
    async def create_whep_session(self, device_id: str, sdp_offer: str) -> tuple[str, str | None]:
        """POST an SDP offer; returns (answer SDP, absolute session URL from `Location`)."""
        path = f"/v1/devices/{quote(device_id, safe='')}/media/streaming/whep/sessions"
        resp = await self._request(
            "POST",
            path,
            content=sdp_offer.encode("utf-8"),
            headers={"Content-Type": "application/sdp", "Accept": "application/sdp"},
        )
        answer = resp.text
        if "v=0" not in answer:
            raise RingApiError(resp.status_code, "WHEP response did not contain an SDP answer", _snippet(resp))
        location = resp.headers.get("location")
        session_url = urljoin(str(resp.request.url), location) if location else None
        return answer, session_url

    async def delete_whep_session(self, session_url: str) -> None:
        await self._request("DELETE", session_url, allow=(404, 410))

    async def download_image(self, device_id: str) -> bytes | None:
        """Latest stored image (JPEG/PNG), or None when there is none (416, e.g. on the Playground)."""
        resp = await self._request(
            "POST",
            f"/v1/devices/{quote(device_id, safe='')}/media/image/download",
            headers={"Accept": "image/jpeg, image/png, */*"},
            allow=(416,),
        )
        if resp.status_code in (204, 416) or not resp.content:
            return None
        return resp.content
