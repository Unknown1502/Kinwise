from __future__ import annotations

import base64
import json
import logging
import os
from pathlib import Path

import httpx
import pytest
import respx

from kinwise_ring.config import ConfigError, Settings
from kinwise_ring.errors import RingAuthError
from kinwise_ring.tokens import (
    OAuthRefreshTokenProvider,
    PlaygroundTokenProvider,
    build_token_provider,
    clean_token,
    jwt_claims,
)

OAUTH = "https://oauth.ring.com/oauth/token"


class Clock:
    def __init__(self, now: float = 1_780_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def write_token(path: Path, token: str, mtime: float) -> None:
    path.write_text(token, encoding="utf-8")
    os.utime(path, (mtime, mtime))


def fake_jwt(claims: dict) -> str:
    def part(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return f"{part({'alg': 'none'})}.{part(claims)}.sig"


def test_clean_token():
    assert clean_token("  Bearer abc.def  \n") == "abc.def"
    assert clean_token('# comment\n"xyz"\n') == "xyz"
    assert clean_token("\n\n") == ""


def test_jwt_claims():
    assert jwt_claims(fake_jwt({"exp": 10, "iat": 5})) == {"exp": 10, "iat": 5}
    assert jwt_claims("opaque-token") == {}
    assert jwt_claims("a.!!!.c") == {}


async def test_playground_file_is_reread_when_it_changes(tmp_path):
    clock = Clock()
    path = tmp_path / "ring-token.txt"
    write_token(path, "Bearer first", clock.now)
    provider = PlaygroundTokenProvider(token_file=path, clock=clock)
    assert await provider.get() == "first"
    write_token(path, "second\n", clock.now + 60)
    assert await provider.get() == "second"


async def test_playground_invalidate_forces_reread(tmp_path):
    clock = Clock()
    path = tmp_path / "ring-token.txt"
    write_token(path, "first", clock.now)
    provider = PlaygroundTokenProvider(token_file=path, clock=clock)
    await provider.get()
    write_token(path, "pasted", clock.now)  # same mtime (coarse filesystem clock)
    await provider.invalidate()
    assert await provider.get() == "pasted"


async def test_playground_warns_when_token_is_old(tmp_path, caplog):
    clock = Clock()
    path = tmp_path / "ring-token.txt"
    write_token(path, "SECRET-PLAYGROUND-VALUE", clock.now)
    provider = PlaygroundTokenProvider(token_file=path, clock=clock)
    await provider.get()
    assert provider.expiry_hint() is None

    clock.now += 26 * 60
    with caplog.at_level(logging.WARNING, logger="kinwise_ring.tokens"):
        await provider.get()
        await provider.get()  # rate limited: one warning per minute
    warnings = [r for r in caplog.records if "expires in about 4 min" in r.getMessage()]
    assert len(warnings) == 1
    assert "SECRET-PLAYGROUND-VALUE" not in caplog.text  # the token itself is never logged

    clock.now += 10 * 60
    assert "expired" in provider.expiry_hint()


async def test_playground_uses_jwt_expiry(tmp_path):
    clock = Clock()
    token = fake_jwt({"iat": clock.now - 60, "exp": clock.now + 120})
    provider = PlaygroundTokenProvider(token=token, clock=clock)
    assert await provider.get() == token
    assert provider.seconds_remaining() == pytest.approx(120)
    assert "expires in about 2 min" in provider.expiry_hint()


async def test_playground_env_token_and_missing_file(tmp_path):
    provider = PlaygroundTokenProvider(token="env-token", token_file=tmp_path / "missing.txt")
    assert await provider.get() == "env-token"
    with pytest.raises(RingAuthError):
        await PlaygroundTokenProvider(token_file=tmp_path / "missing.txt").get()
    (tmp_path / "empty.txt").write_text("\n")
    with pytest.raises(RingAuthError):
        await PlaygroundTokenProvider(token_file=tmp_path / "empty.txt").get()
    with pytest.raises(ConfigError):
        PlaygroundTokenProvider()


@respx.mock
async def test_oauth_refresh_caches_and_rotates(tmp_path):
    route = respx.post(OAUTH).mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "a1", "expires_in": 3600, "refresh_token": "r2"}),
            httpx.Response(200, json={"access_token": "a2", "expires_in": 3600}),
        ]
    )
    clock = Clock()
    store = tmp_path / "state" / "ring-oauth.json"
    provider = OAuthRefreshTokenProvider("cid", "csecret", "r1", clock=clock, store_path=store)
    assert await provider.get() == "a1"
    assert await provider.get() == "a1"  # cached
    assert route.call_count == 1
    form = dict(x.split("=") for x in route.calls[0].request.content.decode().split("&"))
    assert form == {
        "grant_type": "refresh_token",
        "client_id": "cid",
        "client_secret": "csecret",
        "refresh_token": "r1",
    }
    assert provider.refresh_token == "r2"
    assert (tmp_path / "state" / ".gitignore").exists()

    clock.now += 3600 - 299  # inside the 5-minute safety margin
    assert await provider.get() == "a2"
    second = dict(x.split("=") for x in route.calls[1].request.content.decode().split("&"))
    assert second["refresh_token"] == "r2"

    # A restart with the same seed refresh token picks up the rotated one.
    assert OAuthRefreshTokenProvider("cid", "csecret", "r1", store_path=store).refresh_token == "r2"
    # A new seed (operator re-linked) ignores the stored one.
    assert OAuthRefreshTokenProvider("cid", "csecret", "fresh", store_path=store).refresh_token == "fresh"


@respx.mock
async def test_oauth_invalidate_and_failure():
    route = respx.post(OAUTH).mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "a1", "expires_in": 14400}),
            httpx.Response(400, json={"error": "invalid_grant"}),
        ]
    )
    provider = OAuthRefreshTokenProvider("cid", "csecret", "r1")
    assert await provider.get() == "a1"
    await provider.invalidate()
    with pytest.raises(RingAuthError) as info:
        await provider.get()
    assert info.value.status == 400
    assert route.call_count == 2


@respx.mock
async def test_oauth_response_without_access_token():
    respx.post(OAUTH).mock(return_value=httpx.Response(200, json={"token_type": "bearer"}))
    with pytest.raises(RingAuthError):
        await OAuthRefreshTokenProvider("cid", "csecret", "r1").get()


def test_build_token_provider_selection(tmp_path):
    oauth = Settings(ring_client_id="c", ring_client_secret="s", ring_refresh_token="r", ring_token="t")
    assert isinstance(build_token_provider(oauth), OAuthRefreshTokenProvider)
    assert isinstance(build_token_provider(Settings(ring_token="t")), PlaygroundTokenProvider)
    assert isinstance(build_token_provider(Settings(ring_token_file=tmp_path / "t.txt")), PlaygroundTokenProvider)
    with pytest.raises(ConfigError):
        build_token_provider(Settings())
