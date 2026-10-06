from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from kinwise_ring.errors import DeviceOffline, HubError, RingAuthError
from kinwise_ring.events import RingEvent
from kinwise_ring.frames import FrameGrabError
from kinwise_ring.perception import OfflinePerception
from kinwise_ring.pipeline import VisitorPipeline
from kinwise_ring.poller import EventPoller, LiveWatcher, SeenStore, resolve_device_ids

from .conftest import NOBODY, PERSON, FakeGrabber, FakeHub, FixedPerception

START = datetime(2026, 10, 5, 14, 0, tzinfo=UTC)


class Clock:
    def __init__(self, now: datetime = START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def epoch(self) -> float:
        return self.now.timestamp()


class FakeRing:
    def __init__(self, events: dict[str, list[RingEvent]] | None = None) -> None:
        self.events = events or {}
        self.errors: dict[str, Exception] = {}

    async def list_events(self, device_id: str, since=None) -> list[RingEvent]:
        if device_id in self.errors:
            raise self.errors[device_id]
        return list(self.events.get(device_id, []))


def ev(event_id: str, event_type: str, at: datetime | None, sub_type: str | None = None, device: str = "d1"):
    return RingEvent(id=event_id, device_id=device, type=event_type, sub_type=sub_type, occurred_at=at)


def make_poller(tmp_path, ring, *, hub=None, grabber=None, perception=None, clock=None, devices=("d1",)):
    clock = clock or Clock()
    hub = hub or FakeHub()
    pipeline = VisitorPipeline(
        household_id="hh-asha",
        hub=hub,
        perception=perception or OfflinePerception(),
        grabber=grabber if grabber is not None else FakeGrabber(),
        clock=clock.epoch,
    )
    store = SeenStore(tmp_path / "ring-seen.json")
    return EventPoller(ring, pipeline, store, list(devices), clock=clock), hub, pipeline


async def test_first_start_ignores_older_events_and_dedupes(tmp_path):
    ring = FakeRing(
        {
            "d1": [
                ev("old", "button_press", START - timedelta(minutes=5)),
                ev("untimed", "button_press", None),
                ev("new", "button_press", START + timedelta(seconds=3)),
                ev("online", "device_online", START + timedelta(seconds=4)),
            ]
        }
    )
    poller, hub, _ = make_poller(tmp_path, ring)
    results = await poller.poll_once()
    assert len(results) == 1
    (sent,) = hub.events
    assert sent.event_id == "ring-d1-new"
    assert sent.source == "ring-poll"
    assert sent.ring_event_type == "button_press"
    assert sent.perception.person_present is True
    assert sent.occurred_at == START + timedelta(seconds=3)

    # Second poll: nothing new.
    assert await poller.poll_once() == []
    assert len(hub.events) == 1

    # A new event without a timestamp after the baseline is processed.
    ring.events["d1"].append(ev("untimed-2", "motion_detected", None, "human"))
    await poller.poll_once()
    assert [e.event_id for e in hub.events] == ["ring-d1-new", "ring-d1-untimed-2"]


async def test_state_persists_across_restarts(tmp_path):
    ring = FakeRing({"d1": [ev("e1", "button_press", START + timedelta(seconds=1))]})
    poller, hub, _ = make_poller(tmp_path, ring)
    await poller.poll_once()
    assert [e.event_id for e in hub.events] == ["ring-d1-e1"]
    state = json.loads((tmp_path / "ring-seen.json").read_text())
    assert state["seen"] == ["d1:e1"]
    assert state["cutoff"].startswith("2026-10-05T14:00:00")

    # Restart a minute later: the cutoff stays, e1 is not re-sent, a new event is.
    clock = Clock(START + timedelta(minutes=1))
    ring.events["d1"].append(ev("e2", "button_press", START + timedelta(seconds=50)))
    poller2, hub2, _ = make_poller(tmp_path, ring, clock=clock)
    assert poller2.store.cutoff == START
    await poller2.poll_once()
    assert [e.event_id for e in hub2.events] == ["ring-d1-e2"]


async def test_seen_store_is_capped(tmp_path):
    store = SeenStore(tmp_path / "s.json", cap=1000)
    assert store.load(START) is True
    for i in range(1005):
        store.add(f"d1:{i}")
    store.save()
    reloaded = SeenStore(tmp_path / "s.json")
    assert reloaded.load() is False
    assert len(reloaded) == 1000
    assert "d1:4" not in reloaded and "d1:5" in reloaded and "d1:1004" in reloaded
    assert (tmp_path / ".gitignore").exists()


async def test_corrupt_state_starts_fresh(tmp_path):
    (tmp_path / "s.json").write_text("{not json")
    assert SeenStore(tmp_path / "s.json").load(START) is True


async def test_stale_events_after_a_long_downtime_are_skipped(tmp_path):
    ring = FakeRing({"d1": []})
    poller, _, _ = make_poller(tmp_path, ring)
    await poller.poll_once()  # creates state with cutoff = START
    later = Clock(START + timedelta(hours=3))
    ring.events["d1"] = [ev("stale", "button_press", START + timedelta(hours=1))]
    poller2, hub2, _ = make_poller(tmp_path, ring, clock=later)
    await poller2.poll_once()
    assert hub2.events == []
    assert "d1:stale" in poller2.store


async def test_frame_grab_failure_still_reports_with_offline_perception(tmp_path):
    ring = FakeRing({"d1": [ev("e1", "motion_detected", START + timedelta(seconds=1), "human")]})
    grabber = FakeGrabber(error=FrameGrabError("no frame"))
    poller, hub, _ = make_poller(tmp_path, ring, grabber=grabber)
    await poller.poll_once()
    assert grabber.calls == ["d1"]
    assert hub.events[0].perception.description == "A person at the front door"


async def test_vehicle_motion_is_reported_as_activity_without_a_frame(tmp_path):
    ring = FakeRing({"d1": [ev("car", "motion_detected", START + timedelta(seconds=1), "vehicle")]})
    grabber = FakeGrabber()
    poller, hub, _ = make_poller(tmp_path, ring, grabber=grabber)
    await poller.poll_once()
    assert grabber.calls == []
    assert hub.events[0].perception.person_present is False
    assert hub.events[0].perception.description == "A vehicle in the driveway"


async def test_frames_go_to_perception_cropped_and_never_to_the_hub(tmp_path):
    ring = FakeRing({"d1": [ev("e1", "on_demand", START + timedelta(seconds=1))]})
    perception = FixedPerception(PERSON)
    grabber = FakeGrabber()
    poller, hub, _ = make_poller(tmp_path, ring, grabber=grabber, perception=perception)
    await poller.poll_once()
    image, event_type, _ = perception.calls[0]
    assert image is not None and image != grabber.frame  # watermark band cropped
    assert event_type == "on_demand"
    payload = json.dumps(hub.events[0].to_payload())
    assert "image" not in payload and len(payload) < 1000


async def test_own_live_view_events_are_ignored(tmp_path):
    clock = Clock()
    ring = FakeRing({"d1": [ev("op", "on_demand", START + timedelta(seconds=1))]})
    poller, hub, _ = make_poller(tmp_path, ring, clock=clock)
    await poller.poll_once()  # operator's live view → we grab a frame at ~START
    assert len(hub.events) == 1
    # Ring logs our own WHEP session as another on_demand event a few seconds later.
    clock.now = START + timedelta(seconds=10)
    ring.events["d1"].append(ev("ours", "on_demand", START + timedelta(seconds=2)))
    await poller.poll_once()
    assert len(hub.events) == 1
    # A later operator live view (well outside our grab window) is processed again.
    clock.now = START + timedelta(minutes=2)
    ring.events["d1"].append(ev("op2", "on_demand", START + timedelta(minutes=2)))
    await poller.poll_once()
    assert [e.event_id for e in hub.events] == ["ring-d1-op", "ring-d1-op2"]


async def test_hub_outage_is_retried_on_the_next_poll(tmp_path):
    ring = FakeRing({"d1": [ev("e1", "button_press", START + timedelta(seconds=1))]})
    hub = FakeHub(errors=[HubError(0, "down")])
    poller, hub, _ = make_poller(tmp_path, ring, hub=hub)
    await poller.poll_once()
    assert hub.events == [] and "d1:e1" not in poller.store
    await poller.poll_once()
    assert [e.event_id for e in hub.events] == ["ring-d1-e1"]


async def test_hub_rejection_is_not_retried(tmp_path):
    ring = FakeRing({"d1": [ev("e1", "button_press", START + timedelta(seconds=1))]})
    hub = FakeHub(errors=[HubError(400, "bad")])
    poller, hub, _ = make_poller(tmp_path, ring, hub=hub)
    await poller.poll_once()
    assert "d1:e1" in poller.store


async def test_offline_device_is_skipped_and_auth_errors_propagate(tmp_path):
    ring = FakeRing({"d2": [ev("e1", "button_press", START + timedelta(seconds=1), device="d2")]})
    ring.errors["d1"] = DeviceOffline(503, "offline")
    poller, hub, _ = make_poller(tmp_path, ring, devices=("d1", "d2"))
    await poller.poll_once()
    assert [e.device_id for e in hub.events] == ["d2"]

    ring.errors["d1"] = RingAuthError(401, "expired")
    with pytest.raises(RingAuthError):
        await poller.poll_once()


async def test_resolve_device_ids():
    class Lister:
        async def list_devices(self):
            from kinwise_ring.events import RingDevice

            return [RingDevice("a", "Front"), RingDevice("b", "Back")]

    assert await resolve_device_ids(Lister(), ["x"]) == ["x"]
    assert await resolve_device_ids(Lister(), []) == ["a", "b"]


# ── live mode ──


class EpochClock:
    def __init__(self, now: float = 1_780_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def make_live(perception, *, grabber=None, hub=None, cooldown=60.0):
    clock = EpochClock()
    hub = hub or FakeHub()
    pipeline = VisitorPipeline(
        household_id="hh-asha",
        hub=hub,
        perception=perception,
        grabber=grabber if grabber is not None else FakeGrabber(),
        clock=clock,
    )
    watcher = LiveWatcher(pipeline, ["d1"], every_seconds=20, cooldown_seconds=cooldown, clock=clock)
    return watcher, hub, clock


async def test_live_mode_reports_person_then_honours_cooldown():
    watcher, hub, clock = make_live(FixedPerception(PERSON))
    assert len(await watcher.tick()) == 1
    first = hub.events[0]
    assert first.event_id == f"live-d1-{int(clock.now)}"
    assert first.source == "ring-playground"
    assert first.ring_event_type == "on_demand"
    assert first.perception.carrying == "a small box"

    clock.now += 20
    assert await watcher.tick() == []  # still inside the cooldown
    clock.now += 20
    assert await watcher.tick() == []
    clock.now += 21  # 61 s after the last report
    assert len(await watcher.tick()) == 1
    assert len(hub.events) == 2 and hub.events[1].event_id != first.event_id


async def test_live_mode_ignores_empty_scenes_and_failed_grabs():
    watcher, hub, _ = make_live(FixedPerception(NOBODY))
    assert await watcher.tick() == []
    assert hub.events == []
    watcher, hub, _ = make_live(FixedPerception(PERSON), grabber=FakeGrabber(error=FrameGrabError("timeout")))
    assert await watcher.tick() == []
    assert hub.events == []


async def test_live_mode_hub_failure_does_not_start_the_cooldown():
    watcher, hub, clock = make_live(FixedPerception(PERSON), hub=FakeHub(errors=[HubError(0, "down")]))
    assert await watcher.tick() == []
    clock.now += 20
    assert len(await watcher.tick()) == 1
    assert len(hub.events) == 1
