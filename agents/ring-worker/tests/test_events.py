from __future__ import annotations

from datetime import UTC, datetime

import pytest

from kinwise_ring.events import (
    classify,
    parse_devices,
    parse_events,
    parse_time,
    parse_webhook,
)

T0 = datetime(2026, 10, 5, 14, 0, tzinfo=UTC)


def test_bare_list_with_plain_fields():
    events = parse_events(
        [
            {"event_id": "e2", "event_type": "button_press", "created_at": "2026-10-05T14:00:05Z"},
            {"event_id": "e1", "event_type": "motion_detected", "created_at": "2026-10-05T14:00:00Z"},
        ],
        "d1",
    )
    assert [e.id for e in events] == ["e1", "e2"]  # oldest first
    assert events[1].type == "button_press"
    assert events[0].occurred_at == T0
    assert events[0].device_id == "d1"


def test_jsonapi_wrapped_data_with_attributes():
    payload = {
        "data": [
            {
                "id": "abc",
                "type": "events",
                "attributes": {
                    "event_type": "motion_detected",
                    "sub_type": "Human",
                    "timestamp": int(T0.timestamp() * 1000),
                    "component_ids": ["cam-1", 2],
                },
            }
        ],
        "meta": {"next": None},
    }
    (event,) = parse_events(payload, "d1")
    assert event.id == "abc"
    assert event.type == "motion_detected"
    assert event.sub_type == "human"
    assert event.occurred_at == T0
    assert event.component_ids == ("cam-1", "2")


def test_events_key_with_type_field_and_epoch_seconds():
    payload = {"events": [{"id": 42, "type": "on_demand", "occurred_at": T0.timestamp()}]}
    (event,) = parse_events(payload, "d9")
    assert (event.id, event.type, event.occurred_at) == ("42", "on_demand", T0)


def test_nested_wrapper_and_attribute_type():
    payload = {"data": {"events": [{"id": "x", "type": "history_event", "attributes": {"type": "button_press"}}]}}
    (event,) = parse_events(payload, "d1")
    assert event.type == "button_press"
    assert event.occurred_at is None


def test_missing_id_gets_a_stable_synthetic_id():
    item = {"event_type": "on_demand", "time": "2026-10-05T14:00:00+02:00"}
    a = parse_events([item], "d1")[0]
    b = parse_events([dict(item)], "d1")[0]
    assert a.id == b.id and a.id.startswith("h")
    assert a.occurred_at == datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize("payload", [None, "oops", 42, {"foo": 1}, {"data": "x"}, [1, "a", None]])
def test_garbage_payloads_yield_no_events(payload):
    assert parse_events(payload, "d1") == []


def test_unknown_type_defaults():
    (event,) = parse_events([{"id": "z"}], "d1")
    assert event.type == "unknown" and event.sub_type is None


@pytest.mark.parametrize(
    "value, expected",
    [
        ("2026-10-05T14:00:00Z", T0),
        ("2026-10-05T14:00:00", T0),
        ("2026-10-05T14:00:00.000+00:00", T0),
        (T0.timestamp(), T0),
        (int(T0.timestamp() * 1000), T0),
        (str(int(T0.timestamp())), T0),
        ("not a time", None),
        ("", None),
        (True, None),
        (None, None),
    ],
)
def test_parse_time(value, expected):
    assert parse_time(value) == expected


def test_parse_devices_variants():
    payload = {
        "data": [
            {
                "id": "d1",
                "type": "devices",
                "attributes": {"name": "Front Door", "kind": "doorbell", "status": "online"},
            },
            {"device_id": "d2", "description": "Back Yard", "status": {"online": False}},
            {"id": "d3", "status": {"connection": "Connected"}},
            {"name": "no id"},
        ]
    }
    devices = parse_devices(payload)
    assert [(d.id, d.name, d.kind, d.online) for d in devices] == [
        ("d1", "Front Door", "doorbell", True),
        ("d2", "Back Yard", None, False),
        ("d3", "d3", None, True),
    ]
    assert parse_devices({"devices": [{"id": "x"}]})[0].online is None
    assert parse_devices({"id": "single", "name": "Solo"})[0].name == "Solo"


@pytest.mark.parametrize(
    "event_type, sub_type, expected",
    [
        ("button_press", None, "person"),
        ("motion_detected", "human", "person"),
        ("motion_detected", None, "person"),
        ("motion_detected", "vehicle", "activity"),
        ("motion_detected", "package", "activity"),
        ("on_demand", None, "person"),
        ("device_online", None, "ignore"),
        ("subscription_activated", None, "ignore"),
        ("unknown", None, "ignore"),
    ],
)
def test_classify(event_type, sub_type, expected):
    assert classify(event_type, sub_type) == expected


def test_parse_webhook_data_object():
    body = {
        "meta": {"request_id": "req-1", "timestamp": "2026-10-05T14:00:00Z"},
        "data": {
            "id": "evt-9",
            "event_type": "motion_detected",
            "device_id": "d1",
            "attributes": {"sub_type": "human", "component_ids": ["c1"]},
        },
    }
    parsed = parse_webhook(body)
    assert parsed.request_id == "req-1"
    assert parsed.event.id == "evt-9"
    assert parsed.event.device_id == "d1"
    assert parsed.event.type == "motion_detected"
    assert parsed.event.sub_type == "human"
    assert parsed.event.component_ids == ("c1",)
    assert parsed.event.occurred_at == T0


def test_parse_webhook_top_level_fields_and_request_id_as_event_id():
    body = {"meta": {"request_id": "req-2"}, "event_type": "button_press", "device_id": "d7", "data": {}}
    parsed = parse_webhook(body)
    assert parsed.event.type == "button_press"
    assert parsed.event.device_id == "d7"
    assert parsed.event.id == "req-2"


def test_parse_webhook_jsonapi_relationship_device():
    body = {
        "meta": {"request_id": "req-3", "event_type": "device_offline"},
        "data": {"type": "devices", "relationships": {"device": {"data": {"id": "d5"}}}},
    }
    parsed = parse_webhook(body)
    assert parsed.event.type == "device_offline"
    assert parsed.event.device_id == "d5"


def test_parse_webhook_device_resource_uses_request_id_as_event_id():
    body = {
        "meta": {"request_id": "r9", "event_type": "motion_detected"},
        "data": {"id": "dev-5", "type": "devices", "attributes": {"sub_type": "human"}},
    }
    parsed = parse_webhook(body)
    assert parsed.event.device_id == "dev-5"
    assert parsed.event.id == "r9"
    assert (parsed.event.type, parsed.event.sub_type) == ("motion_detected", "human")


def test_parse_webhook_id_equal_to_device_id_is_not_an_event_id():
    body = {"meta": {"request_id": "r10"}, "data": {"id": "d1", "device_id": "d1", "event_type": "button_press"}}
    assert parse_webhook(body).event.id == "r10"


def test_parse_webhook_event_key_and_top_level_type():
    body = {"meta": {"request_id": "r11"}, "type": "button_press", "event": {"device_id": "d3"}}
    parsed = parse_webhook(body)
    assert (parsed.event.type, parsed.event.device_id, parsed.event.id) == ("button_press", "d3", "r11")
