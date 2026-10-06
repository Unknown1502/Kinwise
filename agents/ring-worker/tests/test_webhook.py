from __future__ import annotations

import base64
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from kinwise_ring.events import WebhookEvent, parse_webhook
from kinwise_ring.webhook import RequestIdLru, create_app, make_processor, verify_ring_signature

SECRET = "ring-webhook-secret"


def raw_body(request_id: str = "req-1", event_type: str = "motion_detected", sub_type: str | None = "human") -> bytes:
    data = {"id": f"evt-{request_id}", "event_type": event_type, "device_id": "d1"}
    if sub_type:
        data["attributes"] = {"sub_type": sub_type}
    return json.dumps({"meta": {"request_id": request_id}, "data": data}).encode()


def digest(body: bytes, secret: str = SECRET) -> bytes:
    return hmac.new(secret.encode(), body, hashlib.sha256).digest()


@pytest.fixture
def received() -> list[WebhookEvent]:
    return []


@pytest.fixture
def app_client(received):
    async def processor(event: WebhookEvent) -> None:
        received.append(event)

    return TestClient(create_app(SECRET, processor))


@pytest.mark.parametrize(
    "encode",
    [
        lambda d: d.hex(),
        lambda d: d.hex().upper(),
        lambda d: "sha256=" + d.hex(),
        lambda d: base64.b64encode(d).decode(),
        lambda d: "sha256=" + base64.b64encode(d).decode(),
        lambda d: base64.urlsafe_b64encode(d).decode().rstrip("="),
    ],
    ids=["hex", "HEX", "prefixed-hex", "base64", "prefixed-base64", "urlsafe-unpadded"],
)
def test_signature_encodings_are_accepted(app_client, received, encode):
    body = raw_body()
    resp = app_client.post("/ring/webhook", content=body, headers={"X-Signature": encode(digest(body))})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert len(received) == 1
    assert received[0].event.type == "motion_detected"
    assert received[0].request_id == "req-1"


@pytest.mark.parametrize(
    "header",
    [None, "", "sha256=", "deadbeef", "sha256=" + "0" * 64, "not base64 !!"],
)
def test_bad_or_missing_signatures_are_rejected(app_client, received, header):
    headers = {"X-Signature": header} if header is not None else {}
    resp = app_client.post("/ring/webhook", content=raw_body(), headers=headers)
    assert resp.status_code == 401
    assert received == []


def test_signature_with_wrong_secret_or_tampered_body_is_rejected(app_client, received):
    body = raw_body()
    wrong = app_client.post("/ring/webhook", content=body, headers={"X-Signature": digest(body, "other").hex()})
    tampered = app_client.post(
        "/ring/webhook", content=body.replace(b"human", b"vehicle"), headers={"X-Signature": digest(body).hex()}
    )
    assert wrong.status_code == 401 and tampered.status_code == 401
    assert received == []


def test_duplicate_request_ids_are_processed_once(app_client, received):
    body = raw_body("req-dup")
    headers = {"X-Signature": digest(body).hex()}
    first = app_client.post("/ring/webhook", content=body, headers=headers)
    second = app_client.post("/ring/webhook", content=body, headers=headers)
    assert first.status_code == 200 and second.status_code == 200
    assert second.json() == {"ok": True, "duplicate": True}
    assert len(received) == 1


def test_invalid_json_with_valid_signature_is_400(app_client, received):
    body = b"{not json"
    resp = app_client.post("/ring/webhook", content=body, headers={"X-Signature": digest(body).hex()})
    assert resp.status_code == 400
    assert received == []


def test_missing_secret_refuses_everything():
    client = TestClient(create_app(None))
    body = raw_body()
    resp = client.post("/ring/webhook", content=body, headers={"X-Signature": digest(body).hex()})
    assert resp.status_code == 503


def test_health(app_client):
    resp = app_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_processor_errors_do_not_break_the_response():
    async def boom(event: WebhookEvent) -> None:
        raise RuntimeError("processing failed")

    client = TestClient(create_app(SECRET, boom))
    body = raw_body()
    resp = client.post("/ring/webhook", content=body, headers={"X-Signature": digest(body).hex()})
    assert resp.status_code == 200


def test_request_id_lru_evicts_oldest():
    lru = RequestIdLru(capacity=3)
    for rid in ("a", "b", "c"):
        assert lru.seen_before(rid) is False
    assert lru.seen_before("a") is True  # refreshes "a"
    assert lru.seen_before("d") is False  # evicts "b"
    assert lru.seen_before("b") is False
    assert lru.seen_before("a") is True


def test_verify_signature_requires_secret():
    body = raw_body()
    assert verify_ring_signature("", body, digest(body).hex()) is False


class RecordingPipeline:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def handle_ring_event(self, event, *, source):
        self.calls.append((event.type, source))
        return {"decision": "gentle"} if event.type != "device_added" else None


async def test_make_processor_routes_events():
    pipeline = RecordingPipeline()
    process = make_processor(pipeline)
    await process(parse_webhook(json.loads(raw_body("r1", "motion_detected", "human"))))
    await process(parse_webhook(json.loads(raw_body("r2", "button_press", None))))
    await process(parse_webhook(json.loads(raw_body("r3", "device_online", None))))
    await process(parse_webhook(json.loads(raw_body("r4", "device_offline", None))))
    assert pipeline.calls == [("motion_detected", "ring-webhook"), ("button_press", "ring-webhook")]
