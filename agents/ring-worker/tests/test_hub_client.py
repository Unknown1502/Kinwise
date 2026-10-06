from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import UTC, datetime, timedelta, timezone

import httpx
import pytest
import respx

from kinwise_ring.errors import HubError
from kinwise_ring.hub_client import HubClient, VisitorEvent, encode_body, iso_utc, sign_body
from kinwise_ring.perception import Perception

HUB = "http://hub.test"
SECRET = "dev-ingest-secret"


def event(**overrides) -> VisitorEvent:
    base = dict(
        household_id="hh-asha",
        event_id="ring-dev1-ev1",
        device_id="dev1",
        occurred_at=datetime(2026, 10, 5, 14, 41, 7, 123000, tzinfo=UTC),
        source="ring-poll",
        ring_event_type="button_press",
        perception=Perception(True, 1, "a small box", "A person at the front door holding a small box"),
    )
    base.update(overrides)
    return VisitorEvent(**base)


def test_sign_body_test_vector():
    body = b'{"a":1}'
    expected = "sha256=" + hmac.new(b"dev-ingest-secret", body, hashlib.sha256).hexdigest()
    assert sign_body("dev-ingest-secret", body) == expected
    assert re.fullmatch(r"sha256=[0-9a-f]{64}", sign_body("dev-ingest-secret", body))
    # Same value as the hub's Node signBody(): createHmac('sha256', secret).update('{"a":1}', 'utf8')
    assert expected == "sha256=02d7ad0e7843b9a6ce2310116b0fae12ddbd1f420d977eb1238d12618802771f"
    assert sign_body("other-secret", body) != expected


def test_encode_body_is_compact_utf8():
    body = encode_body({"b": "café", "n": [1, 2]})
    assert body == '{"b":"café","n":[1,2]}'.encode()


def test_payload_matches_hub_contract():
    payload = event().to_payload()
    assert payload == {
        "householdId": "hh-asha",
        "eventId": "ring-dev1-ev1",
        "deviceId": "dev1",
        "occurredAt": "2026-10-05T14:41:07.123Z",
        "source": "ring-poll",
        "ringEventType": "button_press",
        "perception": {
            "personPresent": True,
            "peopleCount": 1,
            "carrying": "a small box",
            "description": "A person at the front door holding a small box",
        },
    }
    no_carry = event(perception=Perception(False, 0, None, "A vehicle in the driveway")).to_payload()
    assert "carrying" not in no_carry["perception"]


def test_iso_utc_converts_and_assumes_utc_for_naive():
    plus2 = timezone(timedelta(hours=2))
    assert iso_utc(datetime(2026, 1, 1, 12, 0, tzinfo=plus2)) == "2026-01-01T10:00:00.000Z"
    assert iso_utc(datetime(2026, 1, 1, 12, 0)) == "2026-01-01T12:00:00.000Z"


@respx.mock
async def test_post_visitor_signs_the_exact_bytes_sent(sleep):
    route = respx.post(f"{HUB}/events/visitor").mock(
        return_value=httpx.Response(200, json={"duplicate": False, "decision": "pause", "alertId": "a1"})
    )
    hub = HubClient(HUB + "/", SECRET, sleep=sleep)
    result = await hub.post_visitor(event(perception=Perception(True, 1, None, "Une personne à la porte")))
    await hub.aclose()

    assert result == {"duplicate": False, "decision": "pause", "alertId": "a1"}
    request = route.calls.last.request
    raw = request.content
    assert request.headers["x-kinwise-signature"] == sign_body(SECRET, raw)
    assert re.fullmatch(r"sha256=[0-9a-f]{64}", request.headers["x-kinwise-signature"])
    assert request.headers["content-type"] == "application/json"
    assert request.headers["user-agent"] == "kinwise-ring/0.1"
    assert b" " not in raw.split(b'"description"')[0]  # compact separators
    assert "à".encode() in raw  # ensure_ascii=False, UTF-8
    body = json.loads(raw)
    assert body["eventId"] == "ring-dev1-ev1" and body["householdId"] == "hh-asha"
    assert "carrying" not in body["perception"]
    assert sleep.calls == []


@respx.mock
async def test_post_visitor_retries_5xx_with_backoff(sleep):
    route = respx.post(f"{HUB}/events/visitor").mock(
        side_effect=[
            httpx.Response(502, text="bad gateway"),
            httpx.Response(503, text="busy"),
            httpx.Response(200, json={"duplicate": True, "decision": "ignored"}),
        ]
    )
    hub = HubClient(HUB, SECRET, sleep=sleep)
    result = await hub.post_visitor(event())
    assert result["duplicate"] is True
    assert route.call_count == 3
    assert sleep.calls == [0.5, 1.0]
    # Same bytes and signature on every attempt (idempotent retry).
    bodies = {c.request.content for c in route.calls}
    sigs = {c.request.headers["x-kinwise-signature"] for c in route.calls}
    assert len(bodies) == 1 and len(sigs) == 1


@respx.mock
async def test_post_visitor_gives_up_after_three_network_errors(sleep):
    route = respx.post(f"{HUB}/events/visitor").mock(side_effect=httpx.ConnectError("refused"))
    hub = HubClient(HUB, SECRET, sleep=sleep)
    with pytest.raises(HubError) as info:
        await hub.post_visitor(event())
    assert info.value.status == 0
    assert route.call_count == 3
    assert sleep.calls == [0.5, 1.0]


@respx.mock
async def test_post_visitor_does_not_retry_4xx(sleep):
    route = respx.post(f"{HUB}/events/visitor").mock(
        return_value=httpx.Response(401, json={"error": "invalid_signature"})
    )
    hub = HubClient(HUB, "wrong-secret", sleep=sleep)
    with pytest.raises(HubError) as info:
        await hub.post_visitor(event())
    assert info.value.status == 401
    assert "INGEST_SECRET" in str(info.value)
    assert route.call_count == 1


def test_empty_secret_is_rejected():
    with pytest.raises(ValueError):
        HubClient(HUB, "")
