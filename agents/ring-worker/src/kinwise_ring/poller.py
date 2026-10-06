"""Long-running modes: `poll` (event history) and `live` (periodic WHEP frame).

* poll – every POLL_SECONDS, list each device's event history. On the very first start
  everything older than the start time is ignored; seen ids and that cutoff persist in
  STATE_DIR/ring-seen.json (capped at 1000 ids). New person events get a frame (best
  effort) → perception → hub (source "ring-poll").
* live – every LIVE_EVERY_SECONDS, open a WHEP live view, grab a frame and perceive it.
  When a person is present and PERSON_COOLDOWN_SECONDS have passed since the last
  reported person, send a visitor event (source "ring-playground"). This is the
  primary Ring Developer Playground demo mode (the Playground has no webhooks).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from .config import ensure_state_dir
from .errors import DeviceOffline, HubError, RingApiError, RingAuthError
from .events import RingDevice, RingEvent, classify, parse_time
from .pipeline import VisitorPipeline

log = logging.getLogger(__name__)

SEEN_CAP = 1000


class EventSource(Protocol):
    async def list_events(self, device_id: str, since: datetime | None = None) -> list[RingEvent]: ...


class DeviceLister(Protocol):
    async def list_devices(self) -> list[RingDevice]: ...


def utcnow() -> datetime:
    return datetime.now(UTC)


async def wait_or_stop(stop: asyncio.Event, seconds: float) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=seconds)


async def resolve_device_ids(client: DeviceLister, configured: Iterable[str]) -> list[str]:
    ids = [d for d in configured if d]
    if ids:
        return ids
    devices = await client.list_devices()
    if not devices:
        raise RuntimeError("No Ring devices are visible to this token; set RING_DEVICE_IDS or link a device")
    log.info("discovered %d Ring device(s): %s", len(devices), ", ".join(f"{d.name} ({d.id})" for d in devices))
    return [d.id for d in devices]


class SeenStore:
    """Persisted `device:event` ids already handled, plus the first-start cutoff time."""

    def __init__(self, path: Path, *, cap: int = SEEN_CAP) -> None:
        self.path = path
        self.cap = cap
        self.cutoff: datetime = utcnow()
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._dirty = False

    def load(self, now: datetime | None = None) -> bool:
        """Load state; returns True on a fresh start (no usable state file)."""
        now = now or utcnow()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            data = None
        except (OSError, ValueError):
            log.warning("state file %s is unreadable; starting fresh", self.path)
            data = None
        if isinstance(data, dict) and parse_time(data.get("cutoff")):
            self.cutoff = parse_time(data["cutoff"]) or now
            ids = data.get("seen") if isinstance(data.get("seen"), list) else []
            self._seen = OrderedDict((str(i), None) for i in ids[-self.cap :])
            self._dirty = False
            return False
        self.cutoff = now
        self._seen = OrderedDict()
        self._dirty = True
        return True

    def __contains__(self, key: object) -> bool:
        return key in self._seen

    def __len__(self) -> int:
        return len(self._seen)

    def add(self, key: str) -> None:
        if key in self._seen:
            return
        self._seen[key] = None
        while len(self._seen) > self.cap:
            self._seen.popitem(last=False)
        self._dirty = True

    def save(self) -> None:
        if not self._dirty:
            return
        ensure_state_dir(self.path.parent)
        payload = {"cutoff": self.cutoff.isoformat(), "seen": list(self._seen)}
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(tmp, self.path)
        self._dirty = False


class EventPoller:
    def __init__(
        self,
        client: EventSource,
        pipeline: VisitorPipeline,
        store: SeenStore,
        device_ids: Sequence[str],
        *,
        poll_seconds: float = 5.0,
        max_age_s: float = 600.0,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self.client = client
        self.pipeline = pipeline
        self.store = store
        self.device_ids = list(device_ids)
        self.poll_seconds = poll_seconds
        self.max_age_s = max_age_s
        self._clock = clock
        self._fresh = store.load(clock())
        self._baselined: set[str] = set()
        if self._fresh:
            log.info("first start: ignoring Ring events before %s", self.store.cutoff.isoformat())

    async def poll_once(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        try:
            for device_id in self.device_ids:
                results.extend(await self._poll_device(device_id))
        finally:
            self.store.save()
        return results

    async def _poll_device(self, device_id: str) -> list[dict[str, Any]]:
        try:
            events = await self.client.list_events(device_id)
        except DeviceOffline:
            log.warning("device %s is offline (503); will retry", device_id)
            return []
        except RingAuthError:
            raise
        except RingApiError as exc:
            log.warning("listing events for %s failed: %s", device_id, exc)
            return []

        baseline = self._fresh and device_id not in self._baselined
        self._baselined.add(device_id)
        now = self._clock()
        results: list[dict[str, Any]] = []
        for event in events:
            key = f"{device_id}:{event.id}"
            if key in self.store:
                continue
            reason = self._skip_reason(event, baseline, now)
            if reason:
                log.debug("skipping Ring event %s: %s", event.id, reason)
                self.store.add(key)
                continue
            try:
                result = await self.pipeline.handle_ring_event(event, source="ring-poll")
            except HubError as exc:
                if exc.status == 0 or exc.status >= 500:
                    log.error("hub delivery failed for %s (%s); will retry next poll", event.id, exc)
                    continue  # not marked seen: retried next poll (the hub dedupes on eventId)
                log.error("hub rejected %s: %s", event.id, exc)
            else:
                if result is not None:
                    results.append(result)
            self.store.add(key)
        return results

    def _skip_reason(self, event: RingEvent, baseline: bool, now: datetime) -> str | None:
        if event.occurred_at is None:
            if baseline:
                return "present at first start (no timestamp)"
        else:
            if event.occurred_at < self.store.cutoff:
                return "older than the first-start cutoff"
            if (now - event.occurred_at).total_seconds() > self.max_age_s:
                return "too old to act on"
        if classify(event.type, event.sub_type) == "ignore":
            return f"not a visitor event ({event.type})"
        if self.pipeline.is_self_induced(event):
            return "live view opened by this worker"
        return None

    async def run(self, stop: asyncio.Event) -> None:
        log.info(
            "polling %d device(s) every %.0fs: %s", len(self.device_ids), self.poll_seconds, ", ".join(self.device_ids)
        )
        while not stop.is_set():
            delay = self.poll_seconds
            try:
                await self.poll_once()
            except RingAuthError as exc:
                log.error("%s", exc)
                delay = max(delay, 30.0)
            except Exception:
                log.exception("poll failed")
            await wait_or_stop(stop, delay)


class LiveWatcher:
    def __init__(
        self,
        pipeline: VisitorPipeline,
        device_ids: Sequence[str],
        *,
        every_seconds: float = 20.0,
        cooldown_seconds: float = 60.0,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.pipeline = pipeline
        self.device_ids = list(device_ids)
        self.every_seconds = every_seconds
        self.cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._last_reported: dict[str, float] = {}

    async def tick(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for device_id in self.device_ids:
            result = await self._check(device_id)
            if result is not None:
                results.append(result)
        return results

    async def _check(self, device_id: str) -> dict[str, Any] | None:
        now = self._clock()
        perception, used_frame = await self.pipeline.observe(device_id, event_type="on_demand", grab=True)
        if not used_frame:
            log.warning("live view: no frame from %s this round", device_id)
            return None
        if not perception.person_present:
            log.info("live view %s: no one at the door", device_id)
            return None
        last = self._last_reported.get(device_id)
        if last is not None and now - last < self.cooldown_seconds:
            left = self.cooldown_seconds - (now - last)
            log.info("live view %s: person present, in cooldown (%.0fs left)", device_id, left)
            return None
        try:
            result = await self.pipeline.report(
                event_id=f"live-{device_id}-{int(now)}",
                device_id=device_id,
                occurred_at=datetime.fromtimestamp(now, UTC),
                source="ring-playground",
                ring_event_type="on_demand",
                perception=perception,
            )
        except HubError as exc:
            log.error("hub delivery failed: %s", exc)
            return None
        self._last_reported[device_id] = now
        return result

    async def run(self, stop: asyncio.Event) -> None:
        log.info(
            "live view every %.0fs on %s (person cooldown %.0fs)",
            self.every_seconds,
            ", ".join(self.device_ids),
            self.cooldown_seconds,
        )
        while not stop.is_set():
            delay = self.every_seconds
            try:
                await self.tick()
            except RingAuthError as exc:
                log.error("%s", exc)
                delay = max(delay, 30.0)
            except Exception:
                log.exception("live check failed")
            await wait_or_stop(stop, delay)
