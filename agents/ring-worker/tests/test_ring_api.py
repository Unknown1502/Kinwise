from __future__ import annotations

import email.utils
import json
import time
from datetime import UTC, datetime

import httpx
import pytest
import respx

from kinwise_ring.errors import DeviceOffline, RingApiError, RingAuthError
from kinwise_ring.ring_api import RingClient, retry_after_seconds

from .conftest import API, FakeTokens, make_jpeg


def client(tokens, sleep) -> RingClient:
    return RingClient(tokens, API, sleep=sleep)


@respx.mock
async def test_401_invalidates_token_and_retries_once(tokens, sleep):
    route = respx.get(f"{API}/v1/devices").mock(
        side_effect=[httpx.Response(401, json={"error": "expired"}), httpx.Response(200, json={"data": []})]
    )
    ring = client(tokens, sleep)
    assert await ring.list_devices() == []
    assert tokens.invalidations == 1
    auths = [c.request.headers["authorization"] for c in route.calls]
    assert auths == ["Bearer tok-1", "Bearer tok-2"]
    assert route.calls.last.request.url.params["include"] == "status,capabilities"
    assert route.calls.last.request.headers["user-agent"] == "kinwise-ring/0.1"
    await ring.aclose()


@respx.mock
async def test_second_401_raises_auth_error(tokens, sleep):
    route = respx.get(f"{API}/v1/devices").mock(return_value=httpx.Response(401, text="nope"))
    with pytest.raises(RingAuthError) as info:
        await client(tokens, sleep).list_devices()
    assert info.value.status == 401
    assert route.call_count == 2
    assert tokens.invalidations == 1


@respx.mock
async def test_429_honors_retry_after(tokens, sleep):
    route = respx.get(f"{API}/v1/devices").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "2"}),
            httpx.Response(200, json=[{"id": "d1", "name": "Front Door"}]),
        ]
    )
    devices = await client(tokens, sleep).list_devices()
    assert [d.id for d in devices] == ["d1"]
    assert sleep.calls == [2.0]
    assert route.call_count == 2


@respx.mock
async def test_429_caps_retry_after_and_gives_up_after_three_tries(tokens, sleep):
    route = respx.get(f"{API}/v1/devices").mock(
        return_value=httpx.Response(429, headers={"Retry-After": "120"}, json={"error": "slow down"})
    )
    with pytest.raises(RingApiError) as info:
        await client(tokens, sleep).list_devices()
    assert info.value.status == 429
    assert route.call_count == 3
    assert sleep.calls == [30.0, 30.0]


def test_retry_after_parsing():
    assert retry_after_seconds(None) == 1.0
    assert retry_after_seconds("0") == 0.0
    assert retry_after_seconds("garbage") == 1.0
    assert retry_after_seconds("-5") == 0.0
    future = email.utils.formatdate(time.time() + 10, usegmt=True)
    assert 8.0 <= retry_after_seconds(future) <= 10.0


@respx.mock
async def test_503_means_device_offline(tokens, sleep):
    respx.get(f"{API}/v1/history/devices/d1/events").mock(return_value=httpx.Response(503, text="offline"))
    with pytest.raises(DeviceOffline) as info:
        await client(tokens, sleep).list_events("d1")
    assert info.value.status == 503


@respx.mock
async def test_other_errors_carry_status_and_snippet(tokens, sleep):
    respx.get(f"{API}/v1/devices/d1").mock(return_value=httpx.Response(500, text="boom" * 200))
    with pytest.raises(RingApiError) as info:
        await client(tokens, sleep).get_device("d1")
    assert info.value.status == 500
    assert info.value.body.startswith("boom") and len(info.value.body) <= 300


@respx.mock
async def test_binary_error_bodies_are_never_logged(tokens, sleep):
    respx.post(f"{API}/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(500, content=make_jpeg(), headers={"content-type": "image/jpeg"})
    )
    with pytest.raises(RingApiError) as info:
        await client(tokens, sleep).download_image("d1")
    assert info.value.body.startswith("<") and "image/jpeg" in info.value.body


@respx.mock
async def test_download_image_416_means_no_stored_image(tokens, sleep):
    respx.post(f"{API}/v1/devices/d1/media/image/download").mock(return_value=httpx.Response(416))
    assert await client(tokens, sleep).download_image("d1") is None


@respx.mock
async def test_download_image_returns_bytes(tokens, sleep):
    jpeg = make_jpeg()
    respx.post(f"{API}/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(200, content=jpeg, headers={"content-type": "image/jpeg"})
    )
    assert await client(tokens, sleep).download_image("d1") == jpeg


PRESIGNED = "https://media.api.amazonvision.com/v1/download?security_token=abc&X-Amz-Expires=60"


def jpeg_ok() -> httpx.Response:
    return httpx.Response(200, content=make_jpeg(), headers={"content-type": "image/jpeg"})


@respx.mock
async def test_download_image_sends_search_body_and_follows_303_without_bearer(tokens, sleep):
    jpeg = make_jpeg()
    post = respx.post(f"{API}/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(303, headers={"Location": PRESIGNED})
    )
    get = respx.get(PRESIGNED).mock(
        return_value=httpx.Response(
            200, content=jpeg, headers={"content-type": "image/jpeg", "X-Media-Origin": "recording"}
        )
    )
    before_ms = int(time.time() * 1000)
    assert await client(tokens, sleep).download_image("d1", window_s=600) == jpeg

    req = post.calls.last.request
    assert req.headers["content-type"] == "application/json"
    body = json.loads(req.content)
    assert body["type"] == "latest_in_range"
    assert before_ms - 600_000 - 5_000 <= body["start_timestamp"] <= before_ms - 600_000 + 5_000
    assert "end_timestamp" not in body
    assert body["image_options"] == {"format": "jpeg", "resolution": {"width": 1280, "height": 720}}
    assert "authorization" not in get.calls.last.request.headers


@respx.mock
async def test_download_image_at_timestamp(tokens, sleep):
    post = respx.post(f"{API}/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(303, headers={"Location": PRESIGNED})
    )
    respx.get(PRESIGNED).mock(return_value=jpeg_ok())
    when = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)
    await client(tokens, sleep).download_image("d1", at=when)
    body = json.loads(post.calls.last.request.content)
    assert body["type"] == "at_timestamp"
    assert body["timestamp"] == int(when.timestamp() * 1000)


@pytest.mark.parametrize("status", [416, 425])
@respx.mock
async def test_download_image_no_media_at_presigned_step_means_none(tokens, sleep, status):
    respx.post(f"{API}/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(303, headers={"Location": PRESIGNED})
    )
    respx.get(PRESIGNED).mock(return_value=httpx.Response(status, json={"errors": [{"code": "MEDIA_NOT_FOUND"}]}))
    assert await client(tokens, sleep).download_image("d1") is None


@respx.mock
async def test_download_image_accepts_the_real_playground_presigned_host(tokens, sleep):
    real = "https://download-ap-northeast-1.prod.phoenix.devices.amazon.dev/v1/download?security_token=abc"
    respx.post(f"{API}/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(303, headers={"Location": real})
    )
    get = respx.get(real).mock(return_value=jpeg_ok())
    assert await client(tokens, sleep).download_image("d1")
    assert "authorization" not in get.calls.last.request.headers


@respx.mock
async def test_download_image_refuses_untrusted_presigned_location(tokens, sleep):
    respx.post(f"{API}/v1/devices/d1/media/image/download").mock(
        return_value=httpx.Response(303, headers={"Location": "https://evil.example/x.jpg"})
    )
    with pytest.raises(RingApiError, match="untrusted"):
        await client(tokens, sleep).download_image("d1")


async def test_download_image_rejects_window_over_24_hours(tokens, sleep):
    with pytest.raises(ValueError):
        await client(tokens, sleep).download_image("d1", window_s=25 * 3600)


@respx.mock
async def test_whep_session_create_and_delete(tokens, sleep):
    create = respx.post(f"{API}/v1/devices/d%2F1/media/streaming/whep/sessions").mock(
        return_value=httpx.Response(
            201,
            text="v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n",
            headers={"Location": "/v1/whep/sessions/abc", "Content-Type": "application/sdp"},
        )
    )
    delete = respx.delete(f"{API}/v1/whep/sessions/abc").mock(return_value=httpx.Response(404))
    ring = client(tokens, sleep)
    answer, url = await ring.create_whep_session("d/1", "v=0\r\noffer\r\n")
    assert answer.startswith("v=0")
    assert url == f"{API}/v1/whep/sessions/abc"
    sent = create.calls.last.request
    assert sent.headers["content-type"] == "application/sdp"
    assert sent.content == b"v=0\r\noffer\r\n"
    await ring.delete_whep_session(url)  # 404 tolerated
    assert delete.call_count == 1


@respx.mock
async def test_whep_without_sdp_answer_is_an_error(tokens, sleep):
    respx.post(f"{API}/v1/devices/d1/media/streaming/whep/sessions").mock(
        return_value=httpx.Response(201, json={"unexpected": True})
    )
    with pytest.raises(RingApiError):
        await client(tokens, sleep).create_whep_session("d1", "v=0")


async def test_credentials_are_never_sent_to_untrusted_hosts(sleep):
    tokens = FakeTokens("secret-token")
    with respx.mock(assert_all_called=False) as mock:
        route = mock.delete("https://evil.example.com/s/1").mock(return_value=httpx.Response(200))
        with pytest.raises(RingApiError):
            await client(tokens, sleep).delete_whep_session("https://evil.example.com/s/1")
        assert route.call_count == 0


@respx.mock
async def test_ring_owned_hosts_are_trusted(tokens, sleep):
    route = respx.delete("https://media.amazonvision.com/whep/1").mock(return_value=httpx.Response(204))
    await client(tokens, sleep).delete_whep_session("https://media.amazonvision.com/whep/1")
    assert route.call_count == 1


@respx.mock
async def test_network_errors_become_ring_api_errors(tokens, sleep):
    respx.get(f"{API}/v1/devices").mock(side_effect=httpx.ConnectTimeout("timeout"))
    with pytest.raises(RingApiError) as info:
        await client(tokens, sleep).list_devices()
    assert info.value.status == 0


@respx.mock
async def test_list_events_filters_since(tokens, sleep):
    respx.get(f"{API}/v1/history/devices/d1/events").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"id": "e1", "event_type": "on_demand", "created_at": "2026-10-05T10:00:00Z"},
                    {"id": "e2", "event_type": "on_demand", "created_at": "2026-10-05T11:00:00Z"},
                ]
            },
        )
    )
    from datetime import UTC, datetime

    events = await client(tokens, sleep).list_events("d1", since=datetime(2026, 10, 5, 10, 30, tzinfo=UTC))
    assert [e.id for e in events] == ["e2"]
