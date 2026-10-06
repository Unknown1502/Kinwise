"""Ring access-token providers.

Two sources, one interface (`await get()` / `await invalidate()`):

* `PlaygroundTokenProvider` – a short-lived (~30 min) token copied from the Ring
  Developer Playground, given in `RING_TOKEN` or a file (`RING_TOKEN_FILE`). The file
  is re-read whenever it changes, so an operator can paste a fresh token while the
  worker keeps running.
* `OAuthRefreshTokenProvider` – a linked device: exchanges the refresh token at
  `oauth.ring.com` (access ~4 h, refresh ~30 d) and caches the access token.

Tokens are never logged.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import math
import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol, runtime_checkable

import httpx

from . import USER_AGENT
from .config import DEFAULT_RING_OAUTH_URL, ConfigError, Settings, ensure_state_dir
from .errors import RingAuthError

log = logging.getLogger(__name__)

PLAYGROUND_TOKEN_LIFETIME_S = 30 * 60
PLAYGROUND_WARN_AFTER_S = 25 * 60


@runtime_checkable
class TokenProvider(Protocol):
    async def get(self) -> str: ...

    async def invalidate(self) -> None: ...

    def expiry_hint(self) -> str | None: ...


def clean_token(raw: str) -> str:
    """First meaningful line of `raw`, without a `Bearer ` prefix or quotes."""
    for line in raw.splitlines():
        line = line.strip().strip('"').strip("'").strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("bearer "):
            line = line[7:].strip()
        return line
    return ""


def jwt_claims(token: str) -> dict:
    """Unverified JWT payload (used only to show when a token expires). Empty if not a JWT."""
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, json.JSONDecodeError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


class PlaygroundTokenProvider:
    """Token pasted from the Ring Developer Playground (env var or file)."""

    def __init__(
        self,
        token: str | None = None,
        token_file: str | Path | None = None,
        *,
        clock: Callable[[], float] = time.time,
        lifetime_s: float = PLAYGROUND_TOKEN_LIFETIME_S,
        warn_after_s: float = PLAYGROUND_WARN_AFTER_S,
        warn_interval_s: float = 60.0,
    ) -> None:
        if not token and not token_file:
            raise ConfigError("PlaygroundTokenProvider needs RING_TOKEN or RING_TOKEN_FILE")
        self._env_token = clean_token(token) if token else None
        self._file = Path(token_file) if token_file else None
        self._clock = clock
        self._lifetime = lifetime_s
        self._warn_after = warn_after_s
        self._warn_interval = warn_interval_s
        self._token: str | None = None
        self._obtained_at = 0.0
        self._expires_at = 0.0
        self._file_mtime: float | None = None
        self._stale = False
        self._last_warn = -math.inf

    @property
    def source(self) -> str:
        return str(self._file) if self._file else "RING_TOKEN"

    def _adopt(self, token: str, obtained_at: float) -> None:
        if token == self._token:
            return
        claims = jwt_claims(token)
        iat, exp = _number(claims.get("iat")), _number(claims.get("exp"))
        self._token = token
        self._obtained_at = iat if iat is not None else obtained_at
        self._expires_at = exp if exp is not None else self._obtained_at + self._lifetime
        self._last_warn = -math.inf

    def _load(self) -> None:
        if self._file is not None:
            try:
                mtime = self._file.stat().st_mtime
            except FileNotFoundError:
                if not self._env_token:
                    raise RingAuthError(
                        0, f"Ring token file {self._file} not found; paste a Playground token into it"
                    ) from None
            else:
                if self._token is None or self._stale or mtime != self._file_mtime:
                    token = clean_token(self._file.read_text(encoding="utf-8-sig"))
                    if not token:
                        raise RingAuthError(0, f"Ring token file {self._file} is empty")
                    self._file_mtime = mtime
                    self._adopt(token, obtained_at=mtime)
                self._stale = False
                return
        if self._token is None and self._env_token:
            self._adopt(self._env_token, obtained_at=self._clock())
        self._stale = False

    async def get(self) -> str:
        self._load()
        assert self._token is not None
        hint = self.expiry_hint()
        now = self._clock()
        if hint and now - self._last_warn >= self._warn_interval:
            self._last_warn = now
            log.warning(hint)
        return self._token

    async def invalidate(self) -> None:
        # Force a re-read of the file on the next get(); an env token cannot be refreshed.
        self._stale = True

    def seconds_remaining(self) -> float | None:
        if self._token is None:
            return None
        return self._expires_at - self._clock()

    def expiry_hint(self) -> str | None:
        if self._token is None:
            return None
        now = self._clock()
        age = now - self._obtained_at
        remaining = self._expires_at - now
        where = f"the token file {self._file}" if self._file else "RING_TOKEN (then restart)"
        if remaining <= 0:
            return (
                f"Ring Playground token expired {int(-remaining // 60)} min ago; "
                f"get a fresh one from the Playground and paste it into {where}"
            )
        if age >= self._warn_after or remaining <= self._lifetime - self._warn_after:
            return (
                f"Ring Playground token is {int(age // 60)} min old and expires in about "
                f"{max(1, math.ceil(remaining / 60))} min; paste a fresh one into {where}"
            )
        return None


class OAuthRefreshTokenProvider:
    """Linked-device OAuth: refresh_token grant against oauth.ring.com, cached until expiry."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        *,
        token_url: str = DEFAULT_RING_OAUTH_URL,
        http: httpx.AsyncClient | None = None,
        clock: Callable[[], float] = time.time,
        margin_s: float = 300.0,
        store_path: Path | None = None,
        timeout_s: float = 15.0,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._seed = _fingerprint(refresh_token)
        self._store_path = store_path
        self._refresh_token = self._load_rotated() or refresh_token
        self._token_url = token_url
        self._http = http
        self._clock = clock
        self._margin = margin_s
        self._timeout = timeout_s
        self._access: str | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    @property
    def refresh_token(self) -> str:
        return self._refresh_token

    async def get(self) -> str:
        async with self._lock:
            if self._access and self._clock() < self._expires_at - self._margin:
                return self._access
            await self._refresh()
            assert self._access is not None
            return self._access

    async def invalidate(self) -> None:
        async with self._lock:
            self._access = None

    def expiry_hint(self) -> str | None:
        return None

    async def _refresh(self) -> None:
        form = {
            "grant_type": "refresh_token",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "refresh_token": self._refresh_token,
        }
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        http = self._http or httpx.AsyncClient(timeout=self._timeout)
        try:
            resp = await http.post(self._token_url, data=form, headers=headers)
        except httpx.HTTPError as exc:
            raise RingAuthError(0, f"token refresh failed ({exc.__class__.__name__})") from exc
        finally:
            if self._http is None:
                await http.aclose()
        if resp.status_code != 200:
            raise RingAuthError(resp.status_code, "token refresh failed", resp.text[:200])
        try:
            data = resp.json()
        except ValueError as exc:
            raise RingAuthError(resp.status_code, "token refresh returned non-JSON") from exc
        access = data.get("access_token") if isinstance(data, dict) else None
        if not isinstance(access, str) or not access:
            raise RingAuthError(resp.status_code, "token refresh response has no access_token")
        expires_in = _number(data.get("expires_in")) or 4 * 3600.0
        self._access = access
        self._expires_at = self._clock() + expires_in
        rotated = data.get("refresh_token")
        if isinstance(rotated, str) and rotated and rotated != self._refresh_token:
            self._refresh_token = rotated
            self._save_rotated(rotated)
            log.info("Ring refresh token rotated")
        log.info("Ring access token refreshed (valid for %d min)", int(expires_in // 60))

    def _load_rotated(self) -> str | None:
        if not self._store_path or not self._store_path.is_file():
            return None
        try:
            data = json.loads(self._store_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if isinstance(data, dict) and data.get("seed") == self._seed and isinstance(data.get("refresh_token"), str):
            return data["refresh_token"]
        return None

    def _save_rotated(self, token: str) -> None:
        if not self._store_path:
            return
        try:
            ensure_state_dir(self._store_path.parent)
            self._store_path.write_text(json.dumps({"seed": self._seed, "refresh_token": token}), encoding="utf-8")
        except OSError as exc:
            log.warning("could not persist the rotated refresh token: %s", exc.__class__.__name__)


def _fingerprint(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]


def build_token_provider(settings: Settings) -> TokenProvider:
    """Pick the token source from settings: linked-device OAuth wins over a Playground token."""
    if settings.uses_oauth:
        assert settings.ring_client_id and settings.ring_client_secret and settings.ring_refresh_token
        return OAuthRefreshTokenProvider(
            settings.ring_client_id,
            settings.ring_client_secret,
            settings.ring_refresh_token,
            token_url=settings.ring_oauth_url,
            store_path=settings.state_dir / "ring-oauth.json",
        )
    if settings.uses_playground_token:
        return PlaygroundTokenProvider(settings.ring_token, settings.ring_token_file)
    raise ConfigError(
        "No Ring credentials. Set RING_TOKEN or RING_TOKEN_FILE (Developer Playground), "
        "or RING_CLIENT_ID + RING_CLIENT_SECRET + RING_REFRESH_TOKEN (linked device)."
    )
