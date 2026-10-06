from __future__ import annotations

import email.utils
import time

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
