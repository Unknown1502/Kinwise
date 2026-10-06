"""Defensive parsing of Ring Partner API payloads (devices, event history, webhooks).

The exact response shapes are not fully documented, so every parser accepts a bare
list or a wrapper object (`{"data": [...]}`, `{"events": [...]}`, ...), JSON:API style
items (`{"id", "type", "attributes": {...}}`) and several plausible field names.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Literal

_LIST_KEYS = ("data", "events", "items", "results", "history", "devices", "records")
_JSONAPI_RESOURCE_TYPES = {"event", "events", "history_event", "history_events", "history", "device", "devices"}
_TIME_KEYS = ("created_at", "timestamp", "occurred_at", "event_time", "time", "start_time", "started_at", "created")
_EVENT_ID_KEYS = ("event_id", "id", "uuid", "ding_id", "history_id")
_EVENT_TYPE_KEYS = ("event_type", "eventType", "kind", "type")
_SUB_TYPE_KEYS = ("sub_type", "subtype", "subType", "event_sub_type", "detection_type", "cv_type")

EventClass = Literal["person", "activity", "ignore"]


@dataclass(frozen=True)
class RingDevice:
    id: str
    name: str
    kind: str | None = None
    online: bool | None = None
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True)
class RingEvent:
    id: str
    device_id: str
    type: str
    sub_type: str | None = None
    occurred_at: datetime | None = None
    component_ids: tuple[str, ...] = ()
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)


def extract_items(payload: Any) -> list[dict]:
    """Return the list of item dicts from a bare list or a wrapped object."""
    if isinstance(payload, list):
        return [i for i in payload if isinstance(i, dict)]
    if isinstance(payload, dict):
        for key in _LIST_KEYS:
            value = payload.get(key)
            if isinstance(value, list):
                return [i for i in value if isinstance(i, dict)]
            if isinstance(value, dict):
                nested = extract_items(value)
                if nested:
                    return nested
    return []


def _flatten(item: Mapping[str, Any]) -> dict[str, Any]:
    """Merge JSON:API `attributes` over the top level (top-level `type` kept apart)."""
    attrs = item.get("attributes")
    merged: dict[str, Any] = dict(item)
    if isinstance(attrs, dict):
        for key, value in attrs.items():
            if key == "type" and "type" in item:
                merged["_attr_type"] = value
            else:
                merged.setdefault(key, value)
    return merged


def _first_str(source: Mapping[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
    return None


def parse_time(value: Any) -> datetime | None:
    """ISO-8601 string, epoch seconds or epoch milliseconds → aware UTC datetime."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            value = float(text)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return None
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    if isinstance(value, int | float):
        seconds = value / 1000.0 if value > 1e11 else float(value)
        try:
            return datetime.fromtimestamp(seconds, tz=UTC)
        except (OverflowError, OSError, ValueError):
            return None
    return None


def _event_type(item: Mapping[str, Any], flat: Mapping[str, Any]) -> str:
    for key in ("event_type", "eventType"):
        value = flat.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    top_type = item.get("type")
    if isinstance(top_type, str) and top_type.strip() and top_type.strip().lower() not in _JSONAPI_RESOURCE_TYPES:
        return top_type.strip()
    for key in ("_attr_type", "kind"):
        value = flat.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "unknown"


def _component_ids(flat: Mapping[str, Any]) -> tuple[str, ...]:
    value = flat.get("component_ids")
    if isinstance(value, list):
        return tuple(str(v) for v in value if isinstance(v, str | int))
    return ()


def parse_event(item: Mapping[str, Any], device_id: str) -> RingEvent:
    flat = _flatten(item)
    event_type = _event_type(item, flat)
    sub_type = _first_str(flat, _SUB_TYPE_KEYS)
    occurred_at = None
    for key in _TIME_KEYS:
        occurred_at = parse_time(flat.get(key))
        if occurred_at:
            break
    event_id = _first_str(flat, _EVENT_ID_KEYS)
    if not event_id:
        # No id: derive a stable one so dedupe still works across polls.
        digest = hashlib.sha256(json.dumps(item, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        event_id = f"h{digest[:16]}"
    dev = _first_str(flat, ("device_id", "deviceId")) or device_id
    return RingEvent(
        id=event_id,
        device_id=dev,
        type=event_type,
        sub_type=sub_type.lower() if sub_type else None,
        occurred_at=occurred_at,
        component_ids=_component_ids(flat),
        raw=dict(item),
    )


def parse_events(payload: Any, device_id: str) -> list[RingEvent]:
    """Parse an event-history response, oldest first (events without a time keep their order)."""
    events = [parse_event(item, device_id) for item in extract_items(payload)]
    epoch = datetime.min.replace(tzinfo=UTC)
    if all(e.occurred_at for e in events):
        events.sort(key=lambda e: e.occurred_at or epoch)
    return events


def _online(flat: Mapping[str, Any]) -> bool | None:
    for key in ("online", "is_online", "connected"):
        if isinstance(flat.get(key), bool):
            return flat[key]
    status = flat.get("status")
    if isinstance(status, bool):
        return status
    if isinstance(status, str):
        return status.lower() in {"online", "connected", "ok", "available"}
    if isinstance(status, dict):
        nested = _online(status)
        if nested is not None:
            return nested
        for key in ("connection", "connection_status", "state"):
            if isinstance(status.get(key), str):
                return status[key].lower() in {"online", "connected", "ok", "available"}
    return None


def parse_device(item: Mapping[str, Any]) -> RingDevice | None:
    flat = _flatten(item)
    device_id = _first_str(flat, ("id", "device_id", "deviceId"))
    if not device_id:
        return None
    name = _first_str(flat, ("name", "description", "device_name", "label")) or device_id
    kind = _first_str(flat, ("kind", "device_type", "model", "_attr_type"))
    top_type = item.get("type")
    if not kind and isinstance(top_type, str) and top_type.lower() not in _JSONAPI_RESOURCE_TYPES:
        kind = top_type
    return RingDevice(id=device_id, name=name, kind=kind, online=_online(flat), raw=dict(item))


def _included_status(payload: Any, item: Mapping[str, Any]) -> bool | None:
    """Real API (verified 2026-10-06): JSON:API, with `relationships.status.data.id` pointing at a
    `device-status` resource in `included` whose attributes carry `online`."""
    if not isinstance(payload, dict):
        return None
    rel = (item.get("relationships") or {}).get("status") or {}
    status_id = (rel.get("data") or {}).get("id") if isinstance(rel, dict) else None
    for inc in payload.get("included") or []:
        if isinstance(inc, dict) and inc.get("type") == "device-status" and inc.get("id") == status_id:
            online = (inc.get("attributes") or {}).get("online")
            return online if isinstance(online, bool) else None
    return None


def parse_devices(payload: Any) -> list[RingDevice]:
    items = extract_items(payload)
    if not items and isinstance(payload, dict) and payload.get("id"):
        items = [payload]
    devices = []
    for item in items:
        device = parse_device(item)
        if device is None:
            continue
        if device.online is None and isinstance(item, Mapping):
            device = replace(device, online=_included_status(payload, item))
        devices.append(device)
    return devices


def classify(event_type: str, sub_type: str | None) -> EventClass:
    """`person`: someone may be at the door → grab a frame and perceive.
    `activity`: door activity with no person (vehicle, package) → report without a frame.
    `ignore`: not a visitor event (device online/offline, subscriptions, ...)."""
    kind = event_type.strip().lower()
    sub = (sub_type or "").strip().lower()
    if kind in {"button_press", "ding", "doorbell_press", "on_demand"}:
        return "person"
    if kind in {"motion_detected", "motion"}:
        return "person" if sub in {"", "human", "person", "people"} else "activity"
    return "ignore"


@dataclass(frozen=True)
class WebhookEvent:
    request_id: str | None
    event: RingEvent


def parse_webhook(body: Mapping[str, Any]) -> WebhookEvent:
    """Normalize a Ring webhook delivery: `meta.request_id` + an event-like `data` object."""
    meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
    request_id = _first_str(meta, ("request_id", "requestId")) or _first_str(body, ("request_id",))
    data = body.get("data", body.get("event"))
    if isinstance(data, list) and data and isinstance(data[0], dict):
        data = data[0]
    item: dict[str, Any] = dict(data) if isinstance(data, dict) else {}
    # Event type / device / time may live at the top level or in meta instead of data.
    for source in (body, meta):
        for key in ("event_type", "eventType", "device_id", "deviceId", "timestamp", "created_at", "occurred_at"):
            if key in source and key not in item and not isinstance(source[key], dict | list):
                item[key] = source[key]
    if "type" not in item and "event_type" not in item and isinstance(body.get("type"), str):
        item["event_type"] = body["type"]
    is_device_resource = str(item.get("type", "")).lower() in {"device", "devices"}
    device_id = _first_str(item, ("device_id", "deviceId")) or _first_str(_flatten(item), ("device_id", "deviceId"))
    if not device_id:
        device_id = _relationship_device(item)
    if not device_id and is_device_resource:
        device_id = _first_str(item, ("id",))
    device_id = device_id or "unknown-device"
    # `data.id` may be the device's id rather than the event's: then the delivery's request_id
    # is the only per-event identifier (otherwise every event of a device would share one eventId).
    id_is_device = "id" in item and (is_device_resource or str(item["id"]) == device_id)
    if "event_id" not in item and request_id and ("id" not in item or id_is_device):
        item["event_id"] = request_id
    return WebhookEvent(request_id=request_id, event=parse_event(item, device_id))


def _relationship_device(item: Mapping[str, Any]) -> str | None:
    rel = item.get("relationships")
    if isinstance(rel, dict):
        dev = rel.get("device")
        if isinstance(dev, dict) and isinstance(dev.get("data"), dict):
            return _first_str(dev["data"], ("id",))
    return None
