"""Exceptions shared by the Ring client, token providers and the hub client."""

from __future__ import annotations


class RingApiError(Exception):
    """A Ring Partner API call failed. `status` is 0 for network errors."""

    def __init__(self, status: int, message: str, body: str = "") -> None:
        self.status = status
        self.body = body
        detail = f" body={body!r}" if body else ""
        super().__init__(f"Ring API error {status}: {message}{detail}")


class RingAuthError(RingApiError):
    """The Ring access token was rejected or could not be refreshed."""


class DeviceOffline(RingApiError):
    """Ring answered 503: the device is offline or unreachable."""


class HubError(Exception):
    """The Kinwise hub rejected a visitor event or could not be reached."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        super().__init__(f"Hub error {status}: {message}")
