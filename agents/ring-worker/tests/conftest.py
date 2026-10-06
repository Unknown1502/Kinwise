from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import Any

import pytest
from PIL import Image

from kinwise_ring.hub_client import VisitorEvent
from kinwise_ring.perception import Perception

API = "https://api.example-ring.test"


class FakeTokens:
    """Token provider that hands out tokens from a list and counts invalidations."""

    def __init__(self, *tokens: str) -> None:
        self.tokens = list(tokens or ("tok-1",))
        self.index = 0
        self.invalidations = 0

    async def get(self) -> str:
        return self.tokens[min(self.index, len(self.tokens) - 1)]

    async def invalidate(self) -> None:
        self.invalidations += 1
        self.index += 1

    def expiry_hint(self) -> str | None:
        return None


class RecordingSleep:
    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


class FakeHub:
    def __init__(self, result: dict[str, Any] | None = None, errors: list[Exception] | None = None) -> None:
        self.events: list[VisitorEvent] = []
        self.result = result or {"duplicate": False, "decision": "gentle"}
        self.errors = list(errors or [])

    async def post_visitor(self, event: VisitorEvent) -> dict[str, Any]:
        if self.errors:
            raise self.errors.pop(0)
        self.events.append(event)
        return dict(self.result)


class FakeGrabber:
    def __init__(self, frame: bytes | None = None, error: Exception | None = None) -> None:
        self.frame = frame if frame is not None else make_jpeg()
        self.error = error
        self.calls: list[str] = []

    async def grab_jpeg(self, device_id: str) -> bytes:
        self.calls.append(device_id)
        if self.error:
            raise self.error
        return self.frame


class FixedPerception:
    def __init__(self, perception: Perception) -> None:
        self.perception = perception
        self.calls: list[tuple[bytes | None, str, str | None]] = []

    async def analyze(self, image_jpeg: bytes | None, *, event_type: str, sub_type: str | None = None) -> Perception:
        self.calls.append((image_jpeg, event_type, sub_type))
        return self.perception


def make_jpeg(width: int = 320, height: int = 200, color: tuple[int, int, int] = (40, 90, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="JPEG")
    return buf.getvalue()


def ts(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


PERSON = Perception(True, 1, "a small box", "A person at the front door holding a small box")
NOBODY = Perception(False, 0, None, "No one visible at the front door")


@pytest.fixture
def tokens() -> FakeTokens:
    return FakeTokens("tok-1", "tok-2")


@pytest.fixture
def sleep() -> RecordingSleep:
    return RecordingSleep()
