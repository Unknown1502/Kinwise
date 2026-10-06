"""Ring webhook receiver (linked devices; the Playground has no webhooks).

`POST /ring/webhook`: verify `X-Signature` (HMAC-SHA256 of the raw body with
RING_WEBHOOK_SECRET; hex or base64, optional `sha256=` prefix, constant-time compare),
dedupe on `meta.request_id`, answer 200 immediately and do the slow work (frame grab,
perception, hub delivery) in a background task – Ring expects a reply within 5 s.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
from collections import OrderedDict
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.responses import JSONResponse

from .events import WebhookEvent, parse_webhook

log = logging.getLogger(__name__)

Processor = Callable[[WebhookEvent], Awaitable[None]]
SIGNATURE_HEADER = "X-Signature"
MAX_BODY_BYTES = 256 * 1024


def verify_ring_signature(secret: str, raw_body: bytes, header: str | None) -> bool:
    """Accept hex or base64 (standard or URL-safe) HMAC-SHA256, with or without `sha256=`."""
    if not secret or not header:
        return False
    value = header.strip()
    if value.lower().startswith("sha256="):
        value = value[7:].strip()
    if not value:
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    if hmac.compare_digest(value.lower().encode("ascii", "replace"), digest.hex().encode("ascii")):
        return True
    for decode in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            candidate = decode(value + "=" * (-len(value) % 4))
        except (binascii.Error, ValueError):
            continue
        if hmac.compare_digest(candidate, digest):
            return True
    return False


class RequestIdLru:
    """Remembers the last `capacity` webhook request ids."""

    def __init__(self, capacity: int = 1000) -> None:
        self.capacity = capacity
        self._ids: OrderedDict[str, None] = OrderedDict()

    def seen_before(self, request_id: str) -> bool:
        """Record `request_id`; True if it was already recorded."""
        if request_id in self._ids:
            self._ids.move_to_end(request_id)
            return True
        self._ids[request_id] = None
        while len(self._ids) > self.capacity:
            self._ids.popitem(last=False)
        return False


def create_app(
    secret: str | None,
    processor: Processor | None = None,
    *,
    lifespan: Callable[[FastAPI], Any] | None = None,
    dedupe_capacity: int = 1000,
) -> FastAPI:
    app = FastAPI(title="Kinwise Ring webhook", version="0.1.0", lifespan=lifespan)
    seen = RequestIdLru(dedupe_capacity)
    app.state.seen = seen
    app.state.processor = processor

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "service": "kinwise-ring-webhook", "secretConfigured": bool(secret)}

    @app.post("/ring/webhook")
    async def ring_webhook(request: Request, background: BackgroundTasks) -> JSONResponse:
        if not secret:
            return JSONResponse({"error": "webhook_secret_not_configured"}, status_code=503)
        raw = await request.body()
        if len(raw) > MAX_BODY_BYTES:
            return JSONResponse({"error": "payload_too_large"}, status_code=413)
        if not verify_ring_signature(secret, raw, request.headers.get(SIGNATURE_HEADER)):
            log.warning("rejected a webhook with a missing or invalid signature")
            return JSONResponse({"error": "invalid_signature"}, status_code=401)
        try:
            body = json.loads(raw)
        except ValueError:
            return JSONResponse({"error": "invalid_json"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_payload"}, status_code=400)
        parsed = parse_webhook(body)
        if parsed.request_id and seen.seen_before(parsed.request_id):
            log.info("duplicate webhook delivery %s ignored", parsed.request_id)
            return JSONResponse({"ok": True, "duplicate": True})
        proc = app.state.processor
        if proc is not None:
            background.add_task(_run_safely, proc, parsed)
        return JSONResponse({"ok": True})

    return app


async def _run_safely(processor: Processor, event: WebhookEvent) -> None:
    try:
        await processor(event)
    except Exception:
        log.exception("processing webhook %s failed", event.request_id)


def make_processor(pipeline: Any) -> Processor:
    """Route webhook events: visitor events go through the pipeline, others are logged."""

    async def process(parsed: WebhookEvent) -> None:
        event = parsed.event
        kind = event.type.lower()
        if kind in {"device_online", "device_offline"}:
            log.info("Ring device %s is now %s", event.device_id, kind.removeprefix("device_"))
            return
        result = await pipeline.handle_ring_event(event, source="ring-webhook")
        if result is None:
            log.info("Ring webhook %s (%s) needs no visitor event", parsed.request_id, event.type)

    return process


def build_app_from_settings(settings: Any) -> FastAPI:
    """Production wiring: Ring client + frame grabber + perception + hub, opened in the lifespan."""
    from .frames import FrameGrabber
    from .hub_client import HubClient
    from .perception import build_perception
    from .pipeline import VisitorPipeline
    from .ring_api import RingClient
    from .tokens import build_token_provider

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        hub = HubClient(settings.hub_url, settings.ingest_secret)
        ring: RingClient | None = None
        grabber = None
        if settings.has_ring_credentials:
            ring = RingClient(build_token_provider(settings), settings.ring_api_base)
            grabber = FrameGrabber(ring)
        else:
            log.warning("no Ring credentials: webhook events will be perceived from the event type only")
        pipeline = VisitorPipeline(
            household_id=settings.household_id,
            hub=hub,
            perception=build_perception(settings.perception_mode, settings.perception_model_id, settings.aws_region),
            grabber=grabber,
            watermark_crop=settings.watermark_crop,
        )
        app.state.processor = make_processor(pipeline)
        try:
            yield
        finally:
            await hub.aclose()
            if ring is not None:
                await ring.aclose()

    if not settings.ring_webhook_secret:
        log.warning("RING_WEBHOOK_SECRET is not set: every webhook will be refused (503)")
    return create_app(settings.ring_webhook_secret, lifespan=lifespan)
