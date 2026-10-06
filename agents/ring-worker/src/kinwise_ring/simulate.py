"""Send a scripted visitor event to the hub without Ring (source "demo")."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from .hub_client import HubClient, VisitorEvent
from .perception import Perception, neutral_description


def build_demo_event(
    household_id: str,
    *,
    person: bool = True,
    description: str | None = None,
    carrying: str | None = None,
    device_id: str = "demo-front-door",
    event_type: str | None = None,
    people_count: int | None = None,
    now: datetime | None = None,
) -> VisitorEvent:
    count = (people_count if people_count is not None else 1) if person else 0
    count = max(0, min(10, count))
    carried = carrying.strip() if person and carrying and carrying.strip() else None
    if description is None:
        description = (
            neutral_description(person, count, carried) if person else "Motion at the front door, no one visible"
        )
    return VisitorEvent(
        household_id=household_id,
        event_id=f"demo-{uuid.uuid4().hex[:12]}",
        device_id=device_id,
        occurred_at=now or datetime.now(UTC),
        source="demo",
        ring_event_type=event_type or ("button_press" if person else "motion_detected"),
        perception=Perception(
            person_present=person,
            people_count=count,
            carrying=carried,
            description=" ".join(description.split())[:140],
        ),
    )


async def simulate(hub: HubClient, event: VisitorEvent) -> dict[str, Any]:
    return await hub.post_visitor(event)
