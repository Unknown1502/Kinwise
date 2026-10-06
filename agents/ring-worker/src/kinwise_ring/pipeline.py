"""Frame → perception → signed hub event, shared by the poll, live and webhook modes.

A frame lives only inside `observe()`: it is grabbed into memory, the watermark band is
cropped off the copy given to the vision model, and both are dropped when the call
returns. Only the neutral `Perception` leaves this module.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

from .events import RingEvent, classify
from .frames import crop_watermark
from .hub_client import Source, VisitorEvent
from .perception import Perception, PerceptionEngine

log = logging.getLogger(__name__)


class Grabber(Protocol):
    async def grab_jpeg(self, device_id: str) -> bytes: ...


class Hub(Protocol):
    async def post_visitor(self, event: VisitorEvent) -> dict[str, Any]: ...


def ring_event_id(device_id: str, ring_id: str) -> str:
    """Stable hub eventId for a Ring event: the same event seen by poll and webhook dedupes."""
    return f"ring-{device_id}-{ring_id}"


class VisitorPipeline:
    def __init__(
        self,
        *,
        household_id: str,
        hub: Hub,
        perception: PerceptionEngine,
        grabber: Grabber | None = None,
        watermark_crop: float = 0.15,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.household_id = household_id
        self.hub = hub
        self.perception = perception
        self.grabber = grabber
        self.watermark_crop = watermark_crop
        self._clock = clock
        # (start, end) epoch seconds of our own live-view sessions; used to ignore the
        # `on_demand` history entries that our own frame grabs create.
        self._grab_windows: deque[tuple[float, float]] = deque(maxlen=64)

    async def observe(
        self, device_id: str, *, event_type: str, sub_type: str | None = None, grab: bool = True
    ) -> tuple[Perception, bool]:
        """Perceive the scene at `device_id`. Returns (perception, whether a frame was used)."""
        frame: bytes | None = None
        if grab and self.grabber is not None:
            started = self._clock()
            try:
                frame = await self.grabber.grab_jpeg(device_id)
            except Exception as exc:  # best effort: fall back to event-type perception
                log.warning("frame grab from %s failed (%s: %s)", device_id, exc.__class__.__name__, str(exc)[:160])
            finally:
                self._grab_windows.append((started, self._clock()))
        image: bytes | None = None
        if frame:
            try:
                image = crop_watermark(frame, self.watermark_crop)
            except Exception as exc:
                log.warning("could not prepare the frame (%s); continuing without it", exc.__class__.__name__)
        perception = await self.perception.analyze(image, event_type=event_type, sub_type=sub_type)
        return perception, image is not None

    async def report(
        self,
        *,
        event_id: str,
        device_id: str,
        occurred_at: datetime,
        source: Source,
        ring_event_type: str,
        perception: Perception,
    ) -> dict[str, Any]:
        event = VisitorEvent(
            household_id=self.household_id,
            event_id=event_id,
            device_id=device_id,
            occurred_at=occurred_at,
            source=source,
            ring_event_type=ring_event_type,
            perception=perception,
        )
        result = await self.hub.post_visitor(event)
        log.info(
            "visitor event %s -> hub: person=%s count=%d %r -> decision=%s%s",
            event_id,
            perception.person_present,
            perception.people_count,
            perception.description,
            result.get("decision"),
            " (duplicate)" if result.get("duplicate") else "",
        )
        return result

    async def handle_ring_event(self, event: RingEvent, *, source: Source) -> dict[str, Any] | None:
        """Classify a Ring event; person events get a frame, activity events are reported without one."""
        kind = classify(event.type, event.sub_type)
        if kind == "ignore":
            log.debug("ignoring Ring event %s (%s)", event.id, event.type)
            return None
        perception, used_frame = await self.observe(
            event.device_id, event_type=event.type, sub_type=event.sub_type, grab=kind == "person"
        )
        log.info(
            "Ring %s%s on %s (%s)",
            event.type,
            f"/{event.sub_type}" if event.sub_type else "",
            event.device_id,
            "frame analysed" if used_frame else "no frame",
        )
        return await self.report(
            event_id=ring_event_id(event.device_id, event.id),
            device_id=event.device_id,
            occurred_at=event.occurred_at or datetime.now(UTC),
            source=source,
            ring_event_type=event.type,
            perception=perception,
        )

    def is_self_induced(self, event: RingEvent, *, before_s: float = 5.0, after_s: float = 20.0) -> bool:
        """True for an `on_demand` (live view) history entry created by our own frame grab."""
        if event.type.strip().lower() != "on_demand" or not self._grab_windows:
            return False
        if event.occurred_at is None:
            now = self._clock()
            return any(now - end < 120 for _, end in self._grab_windows)
        ts = event.occurred_at.timestamp()
        return any(start - before_s <= ts <= end + after_s for start, end in self._grab_windows)
